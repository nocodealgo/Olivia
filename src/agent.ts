import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { config } from "./config.js";
import { getToolDefinitions, executeTool } from "./tools/registry.js";
import { saveConversation } from "./memory/conversation-log.js";
import { embedAndStore, embeddingsAvailable } from "./memory/embeddings.js";
import { extractKnowledge } from "./memory/fact-extractor.js";
import { assembleContext } from "./memory/context-assembler.js";
import { autoPrune } from "./memory/context-pruner.js";
import { syncConversation, saveSession, supabaseAvailable } from "./memory/supabase-memory.js";
import { chatWithFailover } from "./llm/failover.js";
import { getActiveModel } from "./llm/models.js";
import { logUsage } from "./usage/tracker.js";
import { getSkillsPrompt } from "./skills/loader.js";
import { logInteraction } from "./heartbeat/recommendations.js";

// ── Load soul prompt ─────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const soulPath = join(__dirname, "..", "soul.md");

let soulPrompt = "";
try {
    soulPrompt = readFileSync(soulPath, "utf-8").trim();
} catch {
    console.warn("⚠️  soul.md not found — using default personality.");
}

// ── Types ────────────────────────────────────────────

type Message = Anthropic.MessageParam;

// ── System prompt ────────────────────────────────────

const SYSTEM_BASE = `${soulPrompt ? soulPrompt + "\n\n---\n\n" : ""}You are ${config.botName}, a personal AI assistant running on your owner's machine.

Key facts about you:
- You communicate via Telegram.
- You are lean, secure, and privacy-first — everything runs locally.
- You have access to tools. Use them when they'd help answer a question.
- Be concise but warm. You're a helpful companion, not a corporate chatbot.
- When using tools, explain what you found naturally — don't just dump raw output.
- You have persistent memory across restarts — conversations are saved and semantically searchable.

## Memory
You have a 3-layer persistent memory system:
1. **Conversation log** — every message is saved and persists across restarts.
2. **Semantic search** — you can recall relevant past conversations by meaning, not just keywords.
3. **Fact memory** — important facts are auto-extracted. You can also save manually with memory_save.

When answering questions:
- You automatically receive relevant context from past conversations — use it naturally.
- Use memory_save for explicit "remember this" requests or important pinned notes.
- Don't announce auto-saved facts — the system handles it quietly.

## Tools
- get_current_time: Look up the current date and time in any timezone.
- memory_save / memory_search / memory_list / memory_delete: Persistent memory CRUD.
- shell_exec: Run shell commands. Dangerous commands (rm -rf, sudo) are blocked.
- file_read / file_write / file_list / file_delete / file_search: File system operations (home directory only).
- web_search: Search the web (Brave + Google + DuckDuckGo).
- browser: Navigate websites, click, type, screenshot, extract content.
- heartbeat_manage: Manage cron-scheduled messages. Supports cron expressions and natural language.
- swarm_task: Spawn specialized sub-agents (researcher, coder, reviewer, planner) to collaborate on complex tasks. Use for multi-step work.
- sessions_list / sessions_history / sessions_send / sessions_manage: Multi-session agent communication. Create named sessions, send messages between agents, and read conversation history.
- mesh_workflow: Decompose a complex goal into ordered subtasks, execute each with the right agent, and compile results. Trigger with /mesh <goal>.
- Any tools prefixed with mcp_ are from connected MCP servers — use them as documented.

When the user sends a message starting with /mesh, use the mesh_workflow tool with the rest of the message as the goal.`;

/** Build the full system prompt with dynamically-loaded skills. */
function getSystemPrompt(): string {
    return SYSTEM_BASE + getSkillsPrompt();
}

// ── Per-chat session history (in-memory for tool loop) ──

export const sessions = new Map<number, Message[]>();

function getSession(chatId: number): Message[] {
    if (!sessions.has(chatId)) {
        sessions.set(chatId, []);
    }
    return sessions.get(chatId)!;
}

// ── Agent loop ───────────────────────────────────────

export async function handleMessage(
    chatId: number,
    userText: string
): Promise<string> {
    // ── Persist user message ──
    const convId = saveConversation(chatId, "user", userText);

    // Sync to Supabase (background)
    if (supabaseAvailable()) {
        syncConversation(chatId, "user", userText).catch(() => { });
    }

    // ── Embed user message (background, don't await inline) ──
    if (embeddingsAvailable()) {
        embedAndStore(convId, userText, chatId).catch((e) =>
            console.error("  ⚠️  Embed error:", e)
        );
    }

    // ── Assemble context from all 3 memory layers ──
    const memoryContext = await assembleContext(chatId, userText);

    // ── Build system prompt with memory context ──
    const fullSystemPrompt = memoryContext
        ? `${getSystemPrompt()}\n\n---\n\n# Your Memory Context\n${memoryContext}`
        : getSystemPrompt();

    // ── Session history for this tool loop ──
    const session = getSession(chatId);
    session.push({ role: "user", content: userText });

    // Keep session manageable — auto-summarize if too long
    await autoPrune(session).catch((e) =>
        console.error("  ⚠️  Auto-prune error:", e)
    );

    let iterations = 0;
    const toolsUsedInLoop: string[] = [];

    while (iterations < config.maxToolIterations) {
        iterations++;

        const callStart = Date.now();
        const response = await chatWithFailover(
            fullSystemPrompt,
            session,
            getToolDefinitions(),
        );

        if (response.stopReason === "tool_use" && response.toolCalls.length > 0) {
            session.push({
                role: "assistant",
                content: response.rawContent,
            });

            const toolResults: Anthropic.ToolResultBlockParam[] = [];
            for (const tc of response.toolCalls) {
                console.log(`  🔧 Tool call: ${tc.name}(${JSON.stringify(tc.input)})`);
                toolsUsedInLoop.push(tc.name);
                const result = await executeTool(
                    tc.name,
                    tc.input,
                );
                console.log(`  ✅ Result: ${result}`);
                toolResults.push({
                    type: "tool_result",
                    tool_use_id: tc.id,
                    content: result,
                });
            }

            session.push({
                role: "user",
                content: toolResults,
            });

            continue;
        }

        // LLM is done — extract text
        session.push({
            role: "assistant",
            content: response.rawContent,
        });

        const reply = response.text || "(no response)";

        // ── Log interaction for recommendations ──
        logInteraction(userText, toolsUsedInLoop);

        // ── Persist assistant reply ──
        const replyConvId = saveConversation(chatId, "assistant", reply);

        // Sync to Supabase (background)
        if (supabaseAvailable()) {
            syncConversation(chatId, "assistant", reply).catch(() => { });
            saveSession(chatId, session).catch(() => { });
        }

        // ── Embed assistant reply (background) ──
        if (embeddingsAvailable()) {
            embedAndStore(replyConvId, reply, chatId).catch((e) =>
                console.error("  ⚠️  Embed error:", e)
            );
        }

        // ── Auto-extract facts + graph (background) ──
        extractKnowledge(userText, reply).catch((e) =>
            console.error("  ⚠️  Knowledge extraction error:", e)
        );

        return reply;
    }

    return "⚠️ I hit my tool-call safety limit for this message. Please try again or simplify your request.";
}

// ── Proactive message generation (for heartbeat) ─────

export async function generateProactiveMessage(prompt: string): Promise<string> {
    const response = await chatWithFailover(
        getSystemPrompt(),
        [{ role: "user", content: prompt }],
        getToolDefinitions(),
    );

    if (response.toolCalls.length > 0) {
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const tc of response.toolCalls) {
            const result = await executeTool(tc.name, tc.input);
            toolResults.push({
                type: "tool_result",
                tool_use_id: tc.id,
                content: result,
            });
        }

        const follow = await chatWithFailover(
            getSystemPrompt(),
            [
                { role: "user", content: prompt },
                { role: "assistant", content: response.rawContent },
                { role: "user", content: toolResults },
            ],
        );

        return follow.text || "(no response)";
    }

    return response.text || "(no response)";
}
