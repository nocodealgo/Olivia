import type Anthropic from "@anthropic-ai/sdk";
import { readdir, readFile } from "node:fs/promises";
import { resolve, join, extname } from "node:path";
import { homedir } from "node:os";
import { checkFilePath } from "../security/policy.js";

// Searchable text file extensions
const TEXT_EXTENSIONS = new Set([
    ".txt", ".md", ".json", ".ts", ".js", ".py", ".sh", ".yaml", ".yml",
    ".toml", ".csv", ".html", ".css", ".xml", ".env", ".cfg", ".conf",
    ".log", ".sql", ".jsx", ".tsx", ".vue", ".svelte", ".rs", ".go",
]);

export const fileSearch = {
    definition: {
        name: "file_search",
        description:
            "Search for files by name pattern or search within file contents for a text query. Only searches within allowed directories (protected paths like .ssh, .aws are blocked). Returns matching file paths and content snippets.",
        input_schema: {
            type: "object" as const,
            properties: {
                directory: {
                    type: "string",
                    description: "Directory to search in (e.g. '~/projects'). Defaults to home directory.",
                },
                name_pattern: {
                    type: "string",
                    description: "Filename pattern to match (case-insensitive substring, e.g. '.env', 'config').",
                },
                content_query: {
                    type: "string",
                    description: "Text to search for inside files (case-insensitive). Only searches text files.",
                },
                max_results: {
                    type: "number",
                    description: "Max results to return (default: 20).",
                },
            },
            required: ["directory"],
        },
    } satisfies Anthropic.Tool,

    async execute(input: Record<string, unknown>): Promise<string> {
        const rawDir = (input.directory as string) || "~";
        const namePattern = (input.name_pattern as string)?.toLowerCase();
        const contentQuery = (input.content_query as string)?.toLowerCase();
        const maxResults = (input.max_results as number) || 20;

        if (!namePattern && !contentQuery) {
            return JSON.stringify({ error: "MISSING_QUERY", message: "Provide name_pattern and/or content_query." });
        }

        const expandedDir = rawDir.startsWith("~") ? rawDir.replace("~", homedir()) : rawDir;
        const fullDir = resolve(expandedDir);

        // Security policy check (blocks .ssh, .aws, .env, etc.)
        const check = checkFilePath(fullDir, "read");
        if (!check.allowed) {
            return JSON.stringify({ error: "ACCESS_DENIED", message: check.reason });
        }

        try {
            const results: Array<{ path: string; match?: string }> = [];
            await searchDir(fullDir, namePattern, contentQuery, results, maxResults, 0, 5);

            return JSON.stringify({
                directory: fullDir,
                results,
                total: results.length,
                truncated: results.length >= maxResults,
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return JSON.stringify({ error: "SEARCH_ERROR", message });
        }
    },
};

async function searchDir(
    dirPath: string,
    namePattern: string | undefined,
    contentQuery: string | undefined,
    results: Array<{ path: string; match?: string }>,
    maxResults: number,
    depth: number,
    maxDepth: number
): Promise<void> {
    if (results.length >= maxResults || depth > maxDepth) return;

    let items;
    try {
        items = await readdir(dirPath, { withFileTypes: true });
    } catch {
        return;
    }

    for (const item of items) {
        if (results.length >= maxResults) return;
        if (item.name.startsWith(".") || item.name === "node_modules") continue;

        const fullItemPath = join(dirPath, item.name);
        const relativePath = fullItemPath.replace(homedir(), "~");

        if (item.isFile()) {
            // Name pattern match
            if (namePattern && item.name.toLowerCase().includes(namePattern)) {
                results.push({ path: relativePath });
            }

            // Content search (text files only)
            if (contentQuery && TEXT_EXTENSIONS.has(extname(item.name).toLowerCase())) {
                try {
                    const content = await readFile(fullItemPath, "utf-8");
                    const lowerContent = content.toLowerCase();
                    const idx = lowerContent.indexOf(contentQuery);
                    if (idx !== -1) {
                        const start = Math.max(0, idx - 40);
                        const end = Math.min(content.length, idx + contentQuery.length + 40);
                        const snippet = content.slice(start, end).replace(/\n/g, " ");
                        results.push({
                            path: relativePath,
                            match: `…${snippet}…`,
                        });
                    }
                } catch { /* skip unreadable files */ }
            }
        } else if (item.isDirectory()) {
            // Check dir name
            if (namePattern && item.name.toLowerCase().includes(namePattern)) {
                results.push({ path: relativePath + "/" });
            }
            // Recurse
            await searchDir(fullItemPath, namePattern, contentQuery, results, maxResults, depth + 1, maxDepth);
        }
    }
}
