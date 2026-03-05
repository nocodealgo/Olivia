import type Anthropic from "@anthropic-ai/sdk";

interface GetCurrentTimeInput {
    timezone?: string;
}

export const getCurrentTime = {
    definition: {
        name: "get_current_time",
        description:
            "Get the current date and time. Optionally specify a timezone in IANA format (e.g. 'America/New_York', 'Europe/London', 'Asia/Tokyo').",
        input_schema: {
            type: "object" as const,
            properties: {
                timezone: {
                    type: "string",
                    description:
                        "IANA timezone name (e.g. 'America/Chicago'). Defaults to the system timezone if not specified.",
                },
            },
            required: [],
        },
    } satisfies Anthropic.Tool,

    async execute(input: Record<string, unknown>): Promise<string> {
        const { timezone } = input as GetCurrentTimeInput;
        const now = new Date();

        try {
            const formatter = new Intl.DateTimeFormat("en-US", {
                timeZone: timezone || undefined,
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                timeZoneName: "long",
                hour12: true,
            });

            const formatted = formatter.format(now);
            const isoString = now.toISOString();

            return JSON.stringify({
                formatted,
                iso: isoString,
                timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
                unix: Math.floor(now.getTime() / 1000),
            });
        } catch {
            return JSON.stringify({
                error: `Invalid timezone: "${timezone}". Use IANA format like "America/New_York".`,
            });
        }
    },
};
