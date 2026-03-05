/**
 * Mesh Workflow Engine
 *
 * Decompose a high-level goal into subtasks, plan execution order,
 * run each step with the appropriate sub-agent, and report progress.
 *
 * Triggered by /mesh <goal> or via the mesh_workflow tool.
 */

import { chatWithFailover } from "../llm/failover.js";
import { runSwarm, type SwarmMode } from "./orchestrator.js";
import { sendToSession, createSession, getSessionHistory } from "./sessions.js";

// ── Types ────────────────────────────────────────────

export interface MeshStep {
    id: number;
    description: string;
    agent: string;          // researcher | coder | reviewer | planner
    dependsOn: number[];    // step IDs this depends on
    status: "pending" | "running" | "done" | "failed";
    output?: string;
}

export interface MeshWorkflow {
    id: string;
    goal: string;
    steps: MeshStep[];
    status: "planning" | "running" | "done" | "failed";
    sessionId: string;
    startedAt: number;
    completedAt?: number;
}

// ── State ────────────────────────────────────────────

const activeWorkflows = new Map<string, MeshWorkflow>();
let workflowCounter = 0;

// ── Decompose goal into steps ────────────────────────

const DECOMPOSE_PROMPT = `You are a task decomposition agent. Given a high-level goal, break it down into concrete, actionable steps.

For each step, specify:
- A clear description of what to do
- Which agent should handle it: researcher, coder, reviewer, or planner
- Which step IDs it depends on (empty array if none)

IMPORTANT: Respond ONLY with a JSON array, no markdown, no commentary. Example:
[
  {"id": 1, "description": "Research the current codebase structure", "agent": "researcher", "dependsOn": []},
  {"id": 2, "description": "Write the implementation", "agent": "coder", "dependsOn": [1]},
  {"id": 3, "description": "Review the code for bugs and issues", "agent": "reviewer", "dependsOn": [2]}
]

Keep it to 2-6 steps. Be specific, not vague.`;

async function decomposeGoal(goal: string): Promise<MeshStep[]> {
    const response = await chatWithFailover(
        DECOMPOSE_PROMPT,
        [{ role: "user", content: goal }],
    );

    const text = response.text.trim();

    // Extract JSON array from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
        throw new Error("Failed to decompose goal — LLM did not return valid JSON.");
    }

    const parsed = JSON.parse(jsonMatch[0]) as Array<{
        id: number;
        description: string;
        agent: string;
        dependsOn: number[];
    }>;

    return parsed.map((step) => ({
        id: step.id,
        description: step.description,
        agent: step.agent || "researcher",
        dependsOn: step.dependsOn || [],
        status: "pending" as const,
    }));
}

// ── Execute workflow ─────────────────────────────────

function getReadySteps(workflow: MeshWorkflow): MeshStep[] {
    return workflow.steps.filter((s) => {
        if (s.status !== "pending") return false;
        return s.dependsOn.every((depId) => {
            const dep = workflow.steps.find((d) => d.id === depId);
            return dep?.status === "done";
        });
    });
}

function formatProgress(workflow: MeshWorkflow): string {
    const total = workflow.steps.length;
    const done = workflow.steps.filter((s) => s.status === "done").length;
    const running = workflow.steps.filter((s) => s.status === "running").length;
    const failed = workflow.steps.filter((s) => s.status === "failed").length;

    const bar = workflow.steps.map((s) => {
        switch (s.status) {
            case "done": return "✅";
            case "running": return "⏳";
            case "failed": return "❌";
            default: return "⬜";
        }
    }).join("");

    return `${bar} (${done}/${total} done${running ? `, ${running} running` : ""}${failed ? `, ${failed} failed` : ""})`;
}

/**
 * Run a mesh workflow from start to finish.
 */
export async function executeMesh(goal: string, notify?: (msg: string) => void): Promise<string> {
    workflowCounter++;
    const wfId = `mesh-${workflowCounter}`;
    const sessionId = `mesh-${workflowCounter}-log`;

    const log = (msg: string) => {
        sendToSession(sessionId, "mesh-engine", msg);
        if (notify) notify(msg);
        console.log(`  🕸️  [${wfId}] ${msg}`);
    };

    // Step 1: Decompose
    log(`📋 Decomposing goal: "${goal.slice(0, 100)}"`);

    let steps: MeshStep[];
    try {
        steps = await decomposeGoal(goal);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `❌ Failed to decompose goal: ${msg}`;
    }

    const workflow: MeshWorkflow = {
        id: wfId,
        goal,
        steps,
        status: "running",
        sessionId,
        startedAt: Date.now(),
    };

    activeWorkflows.set(wfId, workflow);
    createSession(sessionId, `Mesh: ${goal.slice(0, 50)}`, ["mesh-engine"]);

    log(`📊 Plan created: ${steps.length} step(s)`);
    for (const s of steps) {
        const deps = s.dependsOn.length > 0 ? ` (after step ${s.dependsOn.join(", ")})` : "";
        log(`   ${s.id}. [${s.agent}] ${s.description}${deps}`);
    }

    // Step 2: Execute steps respecting dependencies
    while (true) {
        const ready = getReadySteps(workflow);
        if (ready.length === 0) {
            // Check if we're actually done or stuck
            const pending = workflow.steps.filter((s) => s.status === "pending");
            if (pending.length === 0) break; // All done

            // Stuck — dependencies can't be resolved
            log("⚠️  Workflow stuck — unresolvable dependencies.");
            workflow.status = "failed";
            break;
        }

        // Run ready steps in parallel
        log(`\n${formatProgress(workflow)}`);

        const promises = ready.map(async (step) => {
            step.status = "running";
            log(`⏳ Step ${step.id}: ${step.description}`);

            // Gather context from completed dependencies
            const depContext = step.dependsOn
                .map((depId) => {
                    const dep = workflow.steps.find((d) => d.id === depId);
                    return dep?.output ? `## Step ${depId} (${dep.description}) output:\n${dep.output}` : "";
                })
                .filter(Boolean)
                .join("\n\n");

            try {
                const result = await runSwarm({
                    mode: "sequential" as SwarmMode,
                    agents: [step.agent],
                    task: `${step.description}\n\nOriginal goal: ${goal}`,
                    context: depContext || undefined,
                });

                step.status = "done";
                step.output = result;
                log(`✅ Step ${step.id} done.`);
            } catch (err) {
                step.status = "failed";
                step.output = err instanceof Error ? err.message : String(err);
                log(`❌ Step ${step.id} failed: ${step.output}`);
            }
        });

        await Promise.all(promises);
    }

    // Step 3: Compile final report
    workflow.completedAt = Date.now();
    const elapsed = ((workflow.completedAt - workflow.startedAt) / 1000).toFixed(1);

    const allDone = workflow.steps.every((s) => s.status === "done");
    workflow.status = allDone ? "done" : "failed";

    log(`\n${formatProgress(workflow)} — ${elapsed}s elapsed`);

    const report = [
        `## 🕸️ Mesh Workflow: ${goal}`,
        `**Status:** ${allDone ? "✅ Complete" : "⚠️ Partial"} (${elapsed}s)`,
        "",
        ...workflow.steps.map((s) => {
            const icon = s.status === "done" ? "✅" : s.status === "failed" ? "❌" : "⬜";
            return [
                `### ${icon} Step ${s.id}: ${s.description}`,
                `**Agent:** ${s.agent}`,
                s.output ? s.output.slice(0, 1500) : "(no output)",
                "",
            ].join("\n");
        }),
    ].join("\n");

    return report;
}

// ── Query workflows ──────────────────────────────────

export function getActiveWorkflows(): MeshWorkflow[] {
    return Array.from(activeWorkflows.values());
}

export function getWorkflow(id: string): MeshWorkflow | undefined {
    return activeWorkflows.get(id);
}
