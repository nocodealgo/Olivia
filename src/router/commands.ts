/**
 * Slash Command Parser
 *
 * Channel-agnostic command handling. Messages starting with /
 * are intercepted before reaching the LLM.
 *
 * Commands:
 *   /status  — bot status (uptime, memory, channels, model)
 *   /new     — start a fresh conversation (clear session)
 *   /compact — compress conversation history to save tokens
 *   /model   — show or switch active LLM model
 *   /usage   — token usage and cost report
 */

import { config } from "../config.js";

// ── Command result type ──────────────────────────────

export interface CommandResult {
    /** true = command was handled (don't send to LLM) */
    handled: boolean;
    /** Response to send back to the user */
    reply?: string;
}

// ── Command registry ─────────────────────────────────

type CommandHandler = (args: string, chatId: number) => Promise<string>;

const commands = new Map<string, { handler: CommandHandler; description: string }>();

function register(name: string, description: string, handler: CommandHandler): void {
    commands.set(name, { handler, description });
}

// ── Parse & execute ──────────────────────────────────

export async function parseCommand(text: string, chatId: number): Promise<CommandResult> {
    const trimmed = text.trim();
    if (!trimmed.startsWith("/")) return { handled: false };

    const spaceIdx = trimmed.indexOf(" ");
    const cmd = (spaceIdx > 0 ? trimmed.slice(0, spaceIdx) : trimmed)
        .toLowerCase()
        .replace(/@\w+$/, ""); // Strip @botname suffix
    const args = spaceIdx > 0 ? trimmed.slice(spaceIdx + 1).trim() : "";

    const entry = commands.get(cmd);
    if (!entry) return { handled: false };

    try {
        const reply = await entry.handler(args, chatId);
        return { handled: true, reply };
    } catch (err) {
        return { handled: true, reply: `❌ Error: ${err instanceof Error ? err.message : String(err)}` };
    }
}

/** Get list of all registered commands (for /help) */
export function listCommands(): Array<{ command: string; description: string }> {
    return Array.from(commands.entries()).map(([cmd, { description }]) => ({
        command: cmd,
        description,
    }));
}

// ── /status ──────────────────────────────────────────

register("/status", "Show bot status", async () => {
    const { getActiveModel } = await import("../llm/models.js");
    const { activeTypingCount } = await import("./typing.js");

    const mem = process.memoryUsage();
    const uptime = process.uptime();
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const model = getActiveModel();

    return [
        `📊 *${config.botName} Status*`,
        ``,
        `⏱ Uptime: ${h}h ${m}m`,
        `🧠 Memory: ${Math.round(mem.heapUsed / 1024 / 1024)}MB heap`,
        `🤖 Model: \`${model.id}\` (${model.name})`,
        `🔧 Tools: ${model.tools ? "enabled" : "disabled"}`,
        `💬 Active chats: ${activeTypingCount()} processing`,
        `📱 WhatsApp: ${config.whatsappEnabled ? "✅" : "—"}`,
        `🕐 Timezone: ${config.timezone}`,
    ].join("\n");
});

// ── /new ─────────────────────────────────────────────

register("/new", "Start fresh conversation", async (_args, chatId) => {
    const { sessions } = await import("../agent.js");
    const prev = sessions.get(chatId);
    const msgCount = prev?.length || 0;
    sessions.delete(chatId);
    return `🗑️ Conversation cleared (${msgCount} messages removed). Fresh start!`;
});

// ── /compact ─────────────────────────────────────────

register("/compact", "Compress conversation history", async (_args, chatId) => {
    const { sessions } = await import("../agent.js");
    const { forceCompact } = await import("../memory/context-pruner.js");

    const session = sessions.get(chatId);
    if (!session || session.length === 0) {
        return "Session is empty — nothing to compact.";
    }

    return await forceCompact(session);
});

// ── /model ───────────────────────────────────────────

register("/model", "Show or switch LLM model", async (args) => {
    const { listModels, getActiveModel, setActiveModel } = await import("../llm/models.js");

    if (!args) {
        const active = getActiveModel();
        const all = listModels();
        const lines = all.map((m) => {
            const marker = m.id === active.id ? "→ " : "  ";
            const tools = m.tools ? "🔧" : "💬";
            return `${marker}\`${m.id}\` — ${m.name} ${tools}`;
        });
        return `*Active:* \`${active.id}\` (${active.name})\n\n${lines.join("\n")}\n\n\`/model <id>\` to switch`;
    }

    const model = setActiveModel(args);
    if (!model) {
        return `❌ Unknown model: \`${args}\`. Use /model to see options.`;
    }
    const tools = model.tools ? "with tools 🔧" : "text-only 💬";
    return `✅ Switched to *${model.name}* (${tools})`;
});

// ── /usage ───────────────────────────────────────────

register("/usage", "Show token usage & costs", async () => {
    const { getUsageReport } = await import("../usage/tracker.js");
    return getUsageReport();
});

// ── /help ────────────────────────────────────────────

register("/help", "Show available commands", async () => {
    const cmds = listCommands();
    const lines = cmds.map((c) => `  \`${c.command}\` — ${c.description}`);
    return `*Available commands:*\n\n${lines.join("\n")}`;
});

// ── /soul ────────────────────────────────────────────

register("/soul", "Set up or change agent personality", async () => {
    return "Starting soul wizard… (use the inline buttons above)";
});
