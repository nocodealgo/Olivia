import type Anthropic from "@anthropic-ai/sdk";
import { unlink, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { checkFilePath } from "../security/policy.js";

export const fileDelete = {
    definition: {
        name: "file_delete",
        description:
            "Delete a file or empty directory. Protected system directories cannot be deleted. Only paths within the home directory are accessible. Directories must be empty unless force is true.",
        input_schema: {
            type: "object" as const,
            properties: {
                path: {
                    type: "string",
                    description: "Absolute or ~-relative path to the file or directory to delete.",
                },
                force: {
                    type: "boolean",
                    description: "If true, recursively delete non-empty directories (DANGEROUS). Default: false.",
                },
            },
            required: ["path"],
        },
    } satisfies Anthropic.Tool,

    async execute(input: Record<string, unknown>): Promise<string> {
        const rawPath = input.path as string;
        const force = (input.force as boolean) || false;

        const expandedPath = rawPath.startsWith("~") ? rawPath.replace("~", homedir()) : rawPath;
        const fullPath = resolve(expandedPath);

        // Security policy check
        const check = checkFilePath(fullPath, "delete");
        if (!check.allowed) {
            return JSON.stringify({ error: "ACCESS_DENIED", message: check.reason });
        }

        try {
            const s = await stat(fullPath);

            if (s.isDirectory()) {
                if (!force) {
                    return JSON.stringify({
                        error: "IS_DIRECTORY",
                        message: "Path is a directory. Set force=true to delete recursively, but be careful!",
                    });
                }
                // Extra safety: don't delete directories with too many items
                await rm(fullPath, { recursive: true, maxRetries: 2 });
            } else {
                await unlink(fullPath);
            }

            return JSON.stringify({ deleted: true, path: fullPath });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return JSON.stringify({ error: "DELETE_ERROR", message });
        }
    },
};
