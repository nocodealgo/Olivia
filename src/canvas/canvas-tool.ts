/**
 * Canvas Tool
 *
 * Gives the AI agent the ability to push interactive widgets
 * to the Live Canvas (A2UI — Agent-to-UI).
 */

import { config } from "../config.js";
import {
    pushHtml, pushChart, pushTable, pushForm,
    pushMarkdown, pushCode, pushProgress, pushMetric,
    pushToast, clearCanvas, removeWidget, updateWidget,
    getCanvasState,
} from "./canvas-manager.js";
import type { ChartData, TableData } from "./types.js";

export const canvasToolDefinitions = [
    {
        name: "canvas_push",
        description: `Push an interactive widget to ${config.botName}'s Live Canvas. Supports: html (raw HTML/JS), chart (Chart.js), table, form, markdown, code, progress, metric. The widget appears instantly in the user's browser.`,
        input_schema: {
            type: "object" as const,
            properties: {
                widget_type: {
                    type: "string",
                    enum: ["html", "chart", "table", "form", "markdown", "code", "progress", "metric"],
                    description: "Type of widget to push",
                },
                title: { type: "string", description: "Widget title" },
                content: { type: "string", description: "HTML content (for html/markdown/code types)" },
                data: {
                    type: "object",
                    description: "Structured data. For chart: {type,labels,datasets}. For table: {columns,rows}. For form: {fields,submitLabel}. For progress: {value,max,label}. For metric: {label,value,trend}.",
                },
            },
            required: ["widget_type"],
        },
    },
    {
        name: "canvas_clear",
        description: "Clear all widgets from the Live Canvas.",
        input_schema: {
            type: "object" as const,
            properties: {},
        },
    },
    {
        name: "canvas_toast",
        description: "Show a toast notification on the Live Canvas.",
        input_schema: {
            type: "object" as const,
            properties: {
                message: { type: "string", description: "Notification text" },
                level: { type: "string", enum: ["info", "success", "warning", "error"] },
            },
            required: ["message"],
        },
    },
];

export async function handleCanvasTool(
    name: string,
    input: Record<string, unknown>,
): Promise<string> {
    switch (name) {
        case "canvas_push": {
            const wtype = input.widget_type as string;
            const title = input.title as string | undefined;
            const content = input.content as string | undefined;
            const data = input.data as Record<string, unknown> | undefined;

            let widget;
            switch (wtype) {
                case "chart":
                    widget = pushChart(data as unknown as ChartData, title);
                    break;
                case "table":
                    widget = pushTable(data as unknown as TableData, title);
                    break;
                case "form": {
                    const { widget: w, response } = pushForm(data as any, title);
                    widget = w;
                    // Don't await — the form response comes asynchronously
                    response.then((formData) => {
                        if (Object.keys(formData).length > 0) {
                            console.log(`  🎨 Form "${title}" submitted:`, formData);
                        }
                    });
                    break;
                }
                case "markdown":
                    widget = pushMarkdown(content || "", title);
                    break;
                case "code":
                    widget = pushCode(content || "", (data as any)?.language, title);
                    break;
                case "progress":
                    widget = pushProgress(
                        (data as any)?.value ?? 0,
                        (data as any)?.max ?? 100,
                        (data as any)?.label,
                    );
                    break;
                case "metric":
                    widget = pushMetric(
                        (data as any)?.label ?? title ?? "Metric",
                        (data as any)?.value ?? 0,
                        (data as any)?.trend,
                    );
                    break;
                default:
                    widget = pushHtml(content || "", title);
            }
            return `Widget "${widget.id}" (${wtype}) pushed to canvas.`;
        }

        case "canvas_clear":
            clearCanvas();
            return "Canvas cleared.";

        case "canvas_toast":
            pushToast(input.message as string, (input.level as any) || "info");
            return `Toast sent: ${input.message}`;

        default:
            return `Unknown canvas tool: ${name}`;
    }
}
