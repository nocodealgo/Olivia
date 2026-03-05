import type Anthropic from "@anthropic-ai/sdk";
import { searchMemories } from "../memory/db.js";

export const memorySearch = {
    definition: {
        name: "memory_search",
        description:
            "Search your persistent memory using full-text search. Use this to recall previously saved facts, preferences, or notes. Returns results ranked by relevance.",
        input_schema: {
            type: "object" as const,
            properties: {
                query: {
                    type: "string",
                    description:
                        "Search query — keywords or a natural phrase (e.g. 'dog name', 'favorite color').",
                },
                limit: {
                    type: "number",
                    description: "Max results to return (default: 10).",
                },
            },
            required: ["query"],
        },
    } satisfies Anthropic.Tool,

    async execute(input: Record<string, unknown>): Promise<string> {
        const query = input.query as string;
        const limit = (input.limit as number) || 10;

        const results = searchMemories(query, limit);

        if (results.length === 0) {
            return JSON.stringify({ results: [], message: "No memories found matching that query." });
        }

        return JSON.stringify({ results, count: results.length });
    },
};
