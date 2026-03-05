import type Anthropic from "@anthropic-ai/sdk";
import { runSwarm, getAvailableRoles, type SwarmMode } from "../swarm/orchestrator.js";

// ── Tool ─────────────────────────────────────────────

export const swarmTask = {
    definition: {
        name: "swarm_task",
        description:
            `Spawn specialized sub-agents to collaborate on a complex task. Each agent has its own expertise and tool access.

Available agents:
- researcher: Searches web, reads files, gathers information
- coder: Writes and modifies code, runs builds/tests
- reviewer: Reviews code for bugs, security, and quality
- planner: Breaks down tasks into actionable steps

Execution modes:
- sequential: Agents run one after another, each seeing previous outputs
- parallel: All agents run simultaneously
- pipeline: Each agent's output feeds into the next agent`,
        input_schema: {
            type: "object" as const,
            properties: {
                task: {
                    type: "string",
                    description: "The task to assign to the swarm (be specific and detailed).",
                },
                agents: {
                    type: "array",
                    items: { type: "string" },
                    description: "Agent roles to spawn. Available: researcher, coder, reviewer, planner.",
                },
                mode: {
                    type: "string",
                    enum: ["sequential", "parallel", "pipeline"],
                    description: "How agents collaborate. Default: sequential.",
                },
                context: {
                    type: "string",
                    description: "Optional extra context or instructions for the agents.",
                },
            },
            required: ["task", "agents"],
        },
    } satisfies Anthropic.Tool,

    async execute(input: Record<string, unknown>): Promise<string> {
        const task = input.task as string;
        const agents = input.agents as string[];
        const mode = (input.mode as SwarmMode) || "sequential";
        const context = input.context as string | undefined;

        if (!task?.trim()) {
            return JSON.stringify({ error: "MISSING_TASK", message: "Task description is required." });
        }

        if (!agents || agents.length === 0) {
            return JSON.stringify({
                error: "MISSING_AGENTS",
                message: `No agents specified. Available: ${getAvailableRoles().join(", ")}`,
            });
        }

        // Validate agent names
        const valid = getAvailableRoles();
        const invalid = agents.filter((a) => !valid.includes(a));
        if (invalid.length > 0) {
            return JSON.stringify({
                error: "INVALID_AGENTS",
                message: `Unknown agents: ${invalid.join(", ")}. Available: ${valid.join(", ")}`,
            });
        }

        try {
            const result = await runSwarm({ mode, agents, task, context });
            return result;
        } catch (err) {
            return JSON.stringify({
                error: "SWARM_ERROR",
                message: err instanceof Error ? err.message : String(err),
            });
        }
    },
};
