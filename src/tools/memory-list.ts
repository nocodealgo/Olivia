import type Anthropic from "@anthropic-ai/sdk";
import { listMemories } from "../memory/db.js";

export const memoryList = {
    definition: {
        name: "memory_list",
        description:
            "List recent memories, optionally filtered by category. Returns memories in reverse chronological order (newest first).",
        input_schema: {
            type: "object" as const,
            properties: {
                category: {
                    type: "string",
                    description:
                        "Filter by category (e.g. 'preference', 'fact', 'person'). Omit to list all.",
                },
                limit: {
                    type: "number",
                    description: "Max results to return (default: 20).",
                },
            },
            required: [],
        },
    } satisfies Anthropic.Tool,

    async execute(input: Record<string, unknown>): Promise<string> {
        const category = input.category as string | undefined;
        const limit = (input.limit as number) || 20;

        const results = listMemories(category, limit);

        if (results.length === 0) {
            return JSON.stringify({
                results: [],
                message: category
                    ? `No memories found in category "${category}".`
                    : "No memories saved yet.",
            });
        }

        return JSON.stringify({ results, count: results.length });
    },
};
