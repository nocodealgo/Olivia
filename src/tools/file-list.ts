import type Anthropic from "@anthropic-ai/sdk";
import { readdir, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { homedir } from "node:os";

export const fileList = {
    definition: {
        name: "file_list",
        description:
            "List files and directories at a given path. Returns name, type (file/directory), and size. Only paths within the home directory are accessible.",
        input_schema: {
            type: "object" as const,
            properties: {
                path: {
                    type: "string",
                    description: "Absolute or ~-relative path to the directory (e.g. '~/Documents').",
                },
                recursive: {
                    type: "boolean",
                    description: "If true, list recursively up to 3 levels deep (default: false).",
                },
                max_entries: {
                    type: "number",
                    description: "Max entries to return (default: 100).",
                },
            },
            required: ["path"],
        },
    } satisfies Anthropic.Tool,

    async execute(input: Record<string, unknown>): Promise<string> {
        const rawPath = input.path as string;
        const recursive = (input.recursive as boolean) || false;
        const maxEntries = (input.max_entries as number) || 100;

        const expandedPath = rawPath.startsWith("~") ? rawPath.replace("~", homedir()) : rawPath;
        const fullPath = resolve(expandedPath);

        const home = homedir();
        if (!fullPath.startsWith(home)) {
            return JSON.stringify({ error: "ACCESS_DENIED", message: `Can only list within home directory (${home}).` });
        }

        try {
            const entries = await listDir(fullPath, recursive, 0, 3, maxEntries);
            return JSON.stringify({ path: fullPath, entries: entries.slice(0, maxEntries), total: entries.length });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return JSON.stringify({ error: "LIST_ERROR", message });
        }
    },
};

interface DirEntry {
    name: string;
    type: "file" | "directory";
    size?: number;
}

async function listDir(dirPath: string, recursive: boolean, depth: number, maxDepth: number, limit: number): Promise<DirEntry[]> {
    const items = await readdir(dirPath, { withFileTypes: true });
    const entries: DirEntry[] = [];

    for (const item of items) {
        if (entries.length >= limit) break;
        if (item.name.startsWith(".")) continue; // Skip hidden files by default

        const fullItemPath = join(dirPath, item.name);

        if (item.isDirectory()) {
            entries.push({ name: item.name + "/", type: "directory" });
            if (recursive && depth < maxDepth) {
                try {
                    const sub = await listDir(fullItemPath, true, depth + 1, maxDepth, limit - entries.length);
                    entries.push(...sub.map((e) => ({ ...e, name: item.name + "/" + e.name })));
                } catch { /* skip unreadable dirs */ }
            }
        } else if (item.isFile()) {
            try {
                const s = await stat(fullItemPath);
                entries.push({ name: item.name, type: "file", size: s.size });
            } catch {
                entries.push({ name: item.name, type: "file" });
            }
        }
    }

    return entries;
}
