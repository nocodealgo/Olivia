import type Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { checkFilePath } from "../security/policy.js";

export const fileRead = {
    definition: {
        name: "file_read",
        description:
            "Read the contents of a file. For safety, only files within allowed directories are accessible (protected paths like .ssh, .aws are blocked). Supports max_lines to limit output for large files.",
        input_schema: {
            type: "object" as const,
            properties: {
                path: {
                    type: "string",
                    description: "Absolute or ~-relative path to the file (e.g. '~/notes.md', '/Users/pablo/file.txt').",
                },
                max_lines: {
                    type: "number",
                    description: "Max lines to return from the start of the file (default: 500).",
                },
            },
            required: ["path"],
        },
    } satisfies Anthropic.Tool,

    async execute(input: Record<string, unknown>): Promise<string> {
        const rawPath = input.path as string;
        const maxLines = (input.max_lines as number) || 500;

        // Expand ~ to home directory
        const expandedPath = rawPath.startsWith("~")
            ? rawPath.replace("~", homedir())
            : rawPath;
        const fullPath = resolve(expandedPath);

        // Security policy check (blocks .ssh, .aws, .env, etc.)
        const check = checkFilePath(fullPath, "read");
        if (!check.allowed) {
            return JSON.stringify({
                error: "ACCESS_DENIED",
                message: check.reason,
            });
        }

        try {
            const content = await readFile(fullPath, "utf-8");
            const lines = content.split("\n");
            const truncated = lines.length > maxLines;
            const output = truncated ? lines.slice(0, maxLines).join("\n") : content;

            return JSON.stringify({
                path: fullPath,
                content: output.slice(0, 8000),
                lines: lines.length,
                truncated,
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return JSON.stringify({ error: "READ_ERROR", message });
        }
    },
};
