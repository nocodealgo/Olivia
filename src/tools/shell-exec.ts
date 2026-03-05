import type Anthropic from "@anthropic-ai/sdk";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isSandboxEnabled, runSandboxed } from "../sandbox/docker.js";
import { checkCommand } from "../security/policy.js";

const execFileAsync = promisify(execFile);

// ── Tool ─────────────────────────────────────────────

export const shellExec = {
    definition: {
        name: "shell_exec",
        description:
            "Execute a shell command on the host machine. Returns stdout and stderr. Dangerous commands (rm -rf, sudo, etc.) are blocked by security policy. When Docker sandboxing is enabled, commands run in an isolated container.",
        input_schema: {
            type: "object" as const,
            properties: {
                command: {
                    type: "string",
                    description: "The shell command to execute (e.g. 'ls -la ~', 'git status', 'brew list').",
                },
                timeout_ms: {
                    type: "number",
                    description: "Timeout in milliseconds (default: 30000 = 30s).",
                },
                allow_network: {
                    type: "boolean",
                    description: "Allow network access in sandboxed mode (default: false).",
                },
            },
            required: ["command"],
        },
    } satisfies Anthropic.Tool,

    async execute(input: Record<string, unknown>): Promise<string> {
        const command = input.command as string;
        const timeoutMs = (input.timeout_ms as number) || 30000;
        const allowNetwork = (input.allow_network as boolean) || false;

        // Security policy check
        const check = checkCommand(command);
        if (!check.allowed) {
            return JSON.stringify({
                error: "BLOCKED",
                message: check.reason,
            });
        }

        // Route through Docker sandbox if enabled
        if (isSandboxEnabled()) {
            return executeSandboxed(command, timeoutMs, allowNetwork);
        }

        // Direct execution (default)
        return executeDirect(command, timeoutMs);
    },
};

// ── Direct execution (no sandbox) ────────────────────

async function executeDirect(command: string, timeoutMs: number): Promise<string> {
    try {
        const { stdout, stderr } = await execFileAsync("/bin/sh", ["-c", command], {
            timeout: timeoutMs,
            maxBuffer: 1024 * 1024,
            env: { ...process.env, PATH: process.env.PATH },
        });

        const result: Record<string, string> = {};
        if (stdout.trim()) result.stdout = stdout.trim().slice(0, 4000);
        if (stderr.trim()) result.stderr = stderr.trim().slice(0, 2000);

        if (!result.stdout && !result.stderr) {
            result.stdout = "(command completed with no output)";
        }

        return JSON.stringify(result);
    } catch (err: unknown) {
        const error = err as { code?: string; killed?: boolean; stderr?: string; message?: string };

        if (error.killed) {
            return JSON.stringify({ error: "TIMEOUT", message: `Command timed out after ${timeoutMs}ms.` });
        }

        return JSON.stringify({
            error: "EXEC_ERROR",
            message: error.stderr?.slice(0, 2000) || error.message || "Unknown error",
        });
    }
}

// ── Sandboxed execution (Docker) ─────────────────────

async function executeSandboxed(command: string, timeoutMs: number, allowNetwork: boolean): Promise<string> {
    try {
        const { stdout, stderr } = await runSandboxed(command, {
            timeoutMs,
            allowNetwork,
        });

        const result: Record<string, string> = { mode: "sandboxed" };
        if (stdout.trim()) result.stdout = stdout.trim().slice(0, 4000);
        if (stderr.trim()) result.stderr = stderr.trim().slice(0, 2000);

        if (!result.stdout && !result.stderr) {
            result.stdout = "(command completed with no output)";
        }

        return JSON.stringify(result);
    } catch (err: unknown) {
        const error = err as { code?: string; killed?: boolean; stderr?: string; message?: string };

        if (error.killed) {
            return JSON.stringify({ error: "TIMEOUT", message: `Sandboxed command timed out after ${timeoutMs}ms.` });
        }

        return JSON.stringify({
            error: "SANDBOX_ERROR",
            message: error.stderr?.slice(0, 2000) || error.message || "Docker sandbox error",
        });
    }
}
