import type Anthropic from "@anthropic-ai/sdk";
import { getCurrentTime } from "./get-current-time.js";
import { memorySave } from "./memory-save.js";
import { memorySearch } from "./memory-search.js";
import { memoryList } from "./memory-list.js";
import { memoryDelete } from "./memory-delete.js";
import { shellExec } from "./shell-exec.js";
import { fileRead } from "./file-read.js";
import { fileWrite } from "./file-write.js";
import { fileList } from "./file-list.js";
import { fileDelete } from "./file-delete.js";
import { fileSearch } from "./file-search.js";
import { browserTool } from "./browser.js";
import { webSearch } from "./web-search.js";
import { heartbeatManage } from "./heartbeat-manage.js";
import { swarmTask } from "./swarm-task.js";
import { sessionsList, sessionsHistory, sessionsSend, sessionsManage } from "./sessions.js";
import { meshWorkflow } from "./mesh-workflow.js";
import { canvasToolDefinitions, handleCanvasTool } from "../canvas/canvas-tool.js";
import { gmailToolDefinitions, handleGmailTool } from "../gmail/gmail-tool.js";

// ── Tool type ────────────────────────────────────────

export interface ToolHandler {
    definition: Anthropic.Tool;
    execute: (input: Record<string, unknown>) => Promise<string>;
}

// ── Registry ─────────────────────────────────────────

const tools: Map<string, ToolHandler> = new Map();

/** Register a tool handler. Exported for MCP dynamic registration. */
export function registerTool(handler: ToolHandler) {
    tools.set(handler.definition.name, handler);
}

// Register built-in tools
registerTool(getCurrentTime);
registerTool(memorySave);
registerTool(memorySearch);
registerTool(memoryList);
registerTool(memoryDelete);
registerTool(shellExec);
registerTool(fileRead);
registerTool(fileWrite);
registerTool(fileList);
registerTool(fileDelete);
registerTool(fileSearch);
registerTool(browserTool);
registerTool(webSearch);
registerTool(heartbeatManage);
registerTool(swarmTask);
registerTool(sessionsList);
registerTool(sessionsHistory);
registerTool(sessionsSend);
registerTool(sessionsManage);
registerTool(meshWorkflow);

// Register canvas tools
for (const def of canvasToolDefinitions) {
    registerTool({
        definition: def as any,
        execute: (input) => handleCanvasTool(def.name, input),
    });
}

// Register Gmail tools
for (const def of gmailToolDefinitions) {
    registerTool({
        definition: def as any,
        execute: (input) => handleGmailTool(def.name, input),
    });
}

// ── Exports ──────────────────────────────────────────

/** Anthropic-compatible tool definitions array (dynamic — includes MCP tools) */
export function getToolDefinitions(): Anthropic.Tool[] {
    return Array.from(tools.values()).map((t) => t.definition);
}

/** Execute a tool by name */
export async function executeTool(
    name: string,
    input: Record<string, unknown>
): Promise<string> {
    const handler = tools.get(name);
    if (!handler) {
        return `Error: unknown tool "${name}"`;
    }

    try {
        return await handler.execute(input);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `Error executing ${name}: ${message}`;
    }
}
