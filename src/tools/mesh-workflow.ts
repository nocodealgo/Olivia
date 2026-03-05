import type Anthropic from "@anthropic-ai/sdk";
import { executeMesh, getActiveWorkflows } from "../swarm/mesh.js";

// ── Tool ─────────────────────────────────────────────

export const meshWorkflow = {
    definition: {
        name: "mesh_workflow",
        description:
            `Run a mesh workflow: decompose a complex goal into ordered subtasks, execute each with the right agent, and compile results.

Use this when the user sends /mesh <goal> or when a task is too complex for a single agent.

The engine will:
1. Decompose the goal into 2-6 concrete steps
2. Assign each step to the right specialist (researcher, coder, reviewer, planner)
3. Plan execution order based on dependencies
4. Run steps in parallel when possible
5. Compile a structured progress report`,
        input_schema: {
            type: "object" as const,
            properties: {
                goal: {
                    type: "string",
                    description: "The high-level goal to achieve (be specific and detailed).",
                },
                action: {
                    type: "string",
                    enum: ["run", "status"],
                    description: "Action: 'run' to start a workflow, 'status' to check active ones. Default: run.",
                },
            },
            required: ["goal"],
        },
    } satisfies Anthropic.Tool,

    async execute(input: Record<string, unknown>): Promise<string> {
        const action = (input.action as string) || "run";
        const goal = input.goal as string;

        if (action === "status") {
            const workflows = getActiveWorkflows();
            if (workflows.length === 0) {
                return JSON.stringify({ message: "No active mesh workflows." });
            }
            return JSON.stringify({
                workflows: workflows.map((w) => ({
                    id: w.id,
                    goal: w.goal.slice(0, 100),
                    status: w.status,
                    steps: w.steps.length,
                    done: w.steps.filter((s) => s.status === "done").length,
                })),
            });
        }

        if (!goal?.trim()) {
            return JSON.stringify({ error: "MISSING_GOAL", message: "A goal description is required. Example: /mesh Build a REST API for todo items" });
        }

        try {
            const result = await executeMesh(goal);
            return result;
        } catch (err) {
            return JSON.stringify({
                error: "MESH_ERROR",
                message: err instanceof Error ? err.message : String(err),
            });
        }
    },
};
