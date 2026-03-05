import Anthropic from "@anthropic-ai/sdk";
import { chatWithFailover } from "../llm/failover.js";
import { getToolDefinitions, executeTool } from "../tools/registry.js";

// ── Sub-Agent Roles ──────────────────────────────────

export interface SubAgentRole {
    name: string;
    emoji: string;
    systemPrompt: string;
    /** Tool name patterns this agent can use (empty = text-only) */
    allowedTools: string[];
    /** Max iterations for this agent's tool loop */
    maxIterations: number;
}

const ROLES: Record<string, SubAgentRole> = {
    researcher: {
        name: "Researcher",
        emoji: "🔍",
        systemPrompt: `You are a Research Agent. Your job is to gather information, search the web, read files, and compile findings into a clear, structured report.

Rules:
- Focus on FINDING and ORGANIZING information
- Use web_search, file_read, file_search, file_list, memory_search tools
- Present findings as bullet points with sources
- Be thorough but concise
- Don't make up information — only report what you found`,
        allowedTools: ["web_search", "file_read", "file_search", "file_list", "memory_search", "shell_exec", "browser"],
        maxIterations: 5,
    },

    coder: {
        name: "Coder",
        emoji: "💻",
        systemPrompt: `You are a Coding Agent. Your job is to write, modify, and analyze code based on the task given to you.

Rules:
- Write clean, well-documented code
- Use file_read to understand existing code before modifying
- Use file_write to create or update files
- Use shell_exec to run commands (build, test, lint)
- Explain what you changed and why
- Follow the project's existing patterns and conventions`,
        allowedTools: ["file_read", "file_write", "file_list", "file_search", "shell_exec"],
        maxIterations: 8,
    },

    reviewer: {
        name: "Reviewer",
        emoji: "🔎",
        systemPrompt: `You are a Code Review Agent. Your job is to review code, find bugs, suggest improvements, and verify correctness.

Rules:
- Read the code carefully before commenting
- Check for: bugs, security issues, performance problems, readability
- Provide specific, actionable feedback with line references
- Rate severity: 🔴 critical, 🟡 suggestion, 🟢 looks good
- Be constructive — explain WHY something is an issue
- If everything looks good, say so clearly`,
        allowedTools: ["file_read", "file_list", "file_search", "shell_exec"],
        maxIterations: 3,
    },

    planner: {
        name: "Planner",
        emoji: "📋",
        systemPrompt: `You are a Planning Agent. Your job is to break down complex tasks into clear, actionable steps.

Rules:
- Analyze the task and identify sub-problems
- Create a numbered plan with clear, specific steps
- Identify dependencies between steps
- Estimate complexity for each step (simple/medium/complex)
- Flag any risks or unknowns
- Keep the plan practical and achievable`,
        allowedTools: ["file_read", "file_list", "memory_search"],
        maxIterations: 2,
    },
};

// ── Sub-Agent Execution ──────────────────────────────

interface SubAgentResult {
    role: string;
    output: string;
    toolsUsed: string[];
    iterations: number;
}

/**
 * Run a single sub-agent with its own tool loop.
 */
async function runSubAgent(
    role: SubAgentRole,
    task: string,
    context?: string,
): Promise<SubAgentResult> {
    console.log(`  ${role.emoji} Sub-agent [${role.name}] starting: ${task.slice(0, 80)}…`);

    // Filter tools to only what this agent is allowed
    const allTools = getToolDefinitions();
    const agentTools = role.allowedTools.length > 0
        ? allTools.filter((t: any) => role.allowedTools.some((a) => t.name.startsWith(a)))
        : [];

    const systemPrompt = context
        ? `${role.systemPrompt}\n\n## Context from other agents:\n${context}`
        : role.systemPrompt;

    const session: Array<{ role: string; content: any }> = [
        { role: "user", content: task },
    ];

    const toolsUsed: string[] = [];
    let iterations = 0;

    while (iterations < role.maxIterations) {
        iterations++;

        const response = await chatWithFailover(
            systemPrompt,
            session as any,
            agentTools.length > 0 ? agentTools : undefined,
        );

        if (response.stopReason === "tool_use" && response.toolCalls.length > 0) {
            session.push({ role: "assistant", content: response.rawContent });

            const toolResults: Anthropic.ToolResultBlockParam[] = [];
            for (const tc of response.toolCalls) {
                // Verify tool is allowed for this agent
                if (!role.allowedTools.some((a) => tc.name.startsWith(a))) {
                    console.log(`  ⚠️  [${role.name}] blocked tool: ${tc.name}`);
                    toolResults.push({
                        type: "tool_result",
                        tool_use_id: tc.id,
                        content: `Tool "${tc.name}" is not available to the ${role.name} agent.`,
                    });
                    continue;
                }

                console.log(`  ${role.emoji} [${role.name}] tool: ${tc.name}`);
                toolsUsed.push(tc.name);
                const result = await executeTool(tc.name, tc.input);
                toolResults.push({
                    type: "tool_result",
                    tool_use_id: tc.id,
                    content: result,
                });
            }

            session.push({ role: "user", content: toolResults });
            continue;
        }

        // Done
        const output = response.text || "(no output)";
        console.log(`  ${role.emoji} [${role.name}] done (${iterations} iteration(s), ${toolsUsed.length} tool calls).`);

        return { role: role.name, output, toolsUsed, iterations };
    }

    // Max iterations reached
    return { role: role.name, output: "(max iterations reached)", toolsUsed, iterations };
}

// ── Swarm Orchestrator ───────────────────────────────

export type SwarmMode = "sequential" | "parallel" | "pipeline";

interface SwarmConfig {
    mode: SwarmMode;
    agents: string[];   // role names
    task: string;
    /** Extra context or instructions */
    context?: string;
}

/**
 * Execute a swarm of agents on a task.
 *
 * Modes:
 * - sequential: agents run one after another, each seeing previous outputs
 * - parallel: all agents run simultaneously, outputs merged at the end
 * - pipeline: agent 1's output becomes agent 2's input, and so on
 */
export async function runSwarm(cfg: SwarmConfig): Promise<string> {
    const roles = cfg.agents
        .map((name) => ROLES[name])
        .filter((r): r is SubAgentRole => !!r);

    if (roles.length === 0) {
        return `No valid agents specified. Available: ${Object.keys(ROLES).join(", ")}`;
    }

    console.log(`\n  🐝 Swarm starting [${cfg.mode}]: ${roles.map((r) => `${r.emoji}${r.name}`).join(" → ")}`);
    console.log(`  📝 Task: ${cfg.task.slice(0, 100)}`);

    const results: SubAgentResult[] = [];

    if (cfg.mode === "parallel") {
        // All agents run at the same time
        const promises = roles.map((role) => runSubAgent(role, cfg.task, cfg.context));
        results.push(...await Promise.all(promises));
    } else if (cfg.mode === "pipeline") {
        // Each agent's output becomes the next agent's context
        let pipelineContext = cfg.context || "";
        for (const role of roles) {
            const result = await runSubAgent(role, cfg.task, pipelineContext);
            results.push(result);
            pipelineContext += `\n\n## ${role.name} Output:\n${result.output}`;
        }
    } else {
        // Sequential: each agent sees all previous outputs
        for (const role of roles) {
            const prevContext = results.length > 0
                ? results.map((r) => `## ${r.role} Output:\n${r.output}`).join("\n\n")
                : cfg.context;
            const result = await runSubAgent(role, cfg.task, prevContext);
            results.push(result);
        }
    }

    // Compile final report
    const report = results
        .map((r) => `### ${r.role}\n${r.output}`)
        .join("\n\n---\n\n");

    const summary = `🐝 Swarm complete: ${results.length} agent(s), ${results.reduce((a, r) => a + r.toolsUsed.length, 0)} total tool calls.`;

    console.log(`  ${summary}`);

    return `${summary}\n\n${report}`;
}

/**
 * Get list of available agent roles.
 */
export function getAvailableRoles(): string[] {
    return Object.keys(ROLES);
}

/**
 * Get detailed info about a role.
 */
export function getRoleInfo(name: string): SubAgentRole | undefined {
    return ROLES[name];
}
