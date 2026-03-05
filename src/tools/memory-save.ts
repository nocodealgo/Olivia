import type Anthropic from "@anthropic-ai/sdk";
import { saveMemory } from "../memory/db.js";

export const memorySave = {
    definition: {
        name: "memory_save",
        description:
            "Save a piece of information to persistent memory. Use this to remember facts, preferences, names, dates, or anything the user might want recalled later. Memories survive restarts.",
        input_schema: {
            type: "object" as const,
            properties: {
                content: {
                    type: "string",
                    description:
                        "The information to remember. Be specific and self-contained (e.g. \"User's dog is named Luna, a golden retriever\").",
                },
                category: {
                    type: "string",
                    description:
                        "Optional category for organization (e.g. 'preference', 'fact', 'person', 'task', 'note'). Defaults to 'general'.",
                },
            },
            required: ["content"],
        },
    } satisfies Anthropic.Tool,

    async execute(input: Record<string, unknown>): Promise<string> {
        const content = input.content as string;
        const category = (input.category as string) || "general";

        const id = saveMemory(content, category);
        return JSON.stringify({
            saved: true,
            id,
            content,
            category,
        });
    },
};
