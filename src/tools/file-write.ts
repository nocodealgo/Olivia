import type Anthropic from "@anthropic-ai/sdk";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { checkFilePath } from "../security/policy.js";

export const fileWrite = {
    definition: {
        name: "file_write",
        description:
            "Write content to a file (creates it if it doesn't exist, overwrites if it does). For safety, only files within the home directory can be written. Parent directories are created automatically.",
        input_schema: {
            type: "object" as const,
            properties: {
                path: {
                    type: "string",
                    description: "Absolute or ~-relative path to the file (e.g. '~/notes.md').",
                },
                content: {
                    type: "string",
                    description: "Content to write to the file.",
                },
            },
            required: ["path", "content"],
        },
    } satisfies Anthropic.Tool,

    async execute(input: Record<string, unknown>): Promise<string> {
        const rawPath = input.path as string;
        const content = input.content as string;

        // Expand ~ to home directory
        const expandedPath = rawPath.startsWith("~")
            ? rawPath.replace("~", homedir())
            : rawPath;
        const fullPath = resolve(expandedPath);

        // Security policy check
        const check = checkFilePath(fullPath, "write");
        if (!check.allowed) {
            return JSON.stringify({
                error: "ACCESS_DENIED",
                message: check.reason,
            });
        }

        try {
            // Create parent directories if needed
            await mkdir(dirname(fullPath), { recursive: true });
            await writeFile(fullPath, content, "utf-8");

            return JSON.stringify({
                written: true,
                path: fullPath,
                bytes: Buffer.byteLength(content, "utf-8"),
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return JSON.stringify({ error: "WRITE_ERROR", message });
        }
    },
};
