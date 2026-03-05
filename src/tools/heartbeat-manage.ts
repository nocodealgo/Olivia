import type Anthropic from "@anthropic-ai/sdk";
import {
    listSchedules,
    addSchedule,
    removeSchedule,
    toggleSchedule,
} from "../heartbeat/schedules-db.js";
import { parseCronOrNatural, formatScheduleTime } from "../heartbeat/cron-parser.js";
import { config } from "../config.js";

export const heartbeatManage = {
    definition: {
        name: "heartbeat_manage",
        description:
            `Manage ${config.botName}'s scheduled tasks (cron jobs). Supports cron expressions ('30 9 * * 1-5'), natural language ('every day at 9am', 'weekdays at 8:30'), or explicit hour/minute/days params. Actions: list, add, remove, toggle (pause/resume).`,
        input_schema: {
            type: "object" as const,
            properties: {
                action: {
                    type: "string",
                    enum: ["list", "add", "remove", "toggle"],
                    description: "The action to perform.",
                },
                name: {
                    type: "string",
                    description: "Name for the schedule (required for 'add').",
                },
                schedule: {
                    type: "string",
                    description:
                        "Cron expression or natural language schedule. Examples: '0 9 * * *' (daily 9am), '30 8 * * 1-5' (weekdays 8:30am), 'every day at 9am', 'weekdays at 8:30'. Used with 'add'.",
                },
                hour: {
                    type: "number",
                    description: "Hour (0-23) — alternative to 'schedule' param (used with 'add').",
                },
                minute: {
                    type: "number",
                    description: "Minute (0-59, default 0) — used with 'hour' param.",
                },
                days: {
                    type: "string",
                    description:
                        "Comma-separated days: 1=Mon,2=Tue,...,7=Sun (default: '1,2,3,4,5,6,7'). Used with 'hour' param.",
                },
                prompt: {
                    type: "string",
                    description:
                        `The prompt/instruction ${config.botName} will use to generate the scheduled message (required for 'add').`,
                },
                id: {
                    type: "number",
                    description: "Schedule ID (required for 'remove' and 'toggle').",
                },
            },
            required: ["action"],
        },
    } satisfies Anthropic.Tool,

    async execute(input: Record<string, unknown>): Promise<string> {
        const action = input.action as string;

        switch (action) {
            case "list": {
                const schedules = listSchedules();
                if (schedules.length === 0) {
                    return JSON.stringify({ schedules: [], message: "No schedules configured." });
                }
                return JSON.stringify({
                    schedules: schedules.map((s) => ({
                        id: s.id,
                        name: s.name,
                        schedule: formatScheduleTime(s.cron_hour, s.cron_minute, s.days),
                        enabled: !!s.enabled,
                        prompt: s.prompt,
                        last_run: s.last_run,
                    })),
                });
            }

            case "add": {
                const name = input.name as string;
                const prompt = input.prompt as string;
                const scheduleStr = input.schedule as string | undefined;

                if (!name || !prompt) {
                    return JSON.stringify({ error: "Missing required fields: name, prompt." });
                }

                let hour: number;
                let minute: number;
                let days: string;

                if (scheduleStr) {
                    // Parse cron or natural language
                    const parsed = parseCronOrNatural(scheduleStr);
                    if (!parsed) {
                        return JSON.stringify({
                            error: `Could not parse schedule: "${scheduleStr}". Try a cron expression (e.g. "0 9 * * 1-5") or natural language (e.g. "weekdays at 9am").`,
                        });
                    }
                    hour = parsed.hour;
                    minute = parsed.minute;
                    days = parsed.days;
                } else {
                    // Use explicit params
                    hour = input.hour as number;
                    minute = (input.minute as number) ?? 0;
                    days = (input.days as string) ?? "1,2,3,4,5,6,7";

                    if (hour === undefined) {
                        return JSON.stringify({ error: "Provide 'schedule' (cron/natural language) or 'hour' param." });
                    }
                }

                const id = addSchedule(name, hour, minute, days, prompt);
                return JSON.stringify({
                    added: true,
                    id,
                    name,
                    schedule: formatScheduleTime(hour, minute, days),
                });
            }

            case "remove": {
                const id = input.id as number;
                if (!id) return JSON.stringify({ error: "Missing required field: id." });
                const removed = removeSchedule(id);
                return JSON.stringify({ removed, id });
            }

            case "toggle": {
                const id = input.id as number;
                if (!id) return JSON.stringify({ error: "Missing required field: id." });
                const toggled = toggleSchedule(id);
                return JSON.stringify({ toggled, id });
            }

            default:
                return JSON.stringify({ error: `Unknown action: "${action}". Use list, add, remove, or toggle.` });
        }
    },
};
