import type Anthropic from "@anthropic-ai/sdk";
import { deleteMemory } from "../memory/db.js";

export const memoryDelete = {
    definition: {
        name: "memory_delete",
        description:
            "Delete a specific memory by its ID. Use memory_list or memory_search first to find the ID.",
        input_schema: {
            type: "object" as const,
            properties: {
                id: {
                    type: "number",
                    description: "The memory ID to delete.",
                },
            },
            required: ["id"],
        },
    } satisfies Anthropic.Tool,

    async execute(input: Record<string, unknown>): Promise<string> {
        const id = input.id as number;
        const deleted = deleteMemory(id);

        return JSON.stringify({
            deleted,
            id,
            message: deleted
                ? `Memory #${id} deleted.`
                : `Memory #${id} not found.`,
        });
    },
};
