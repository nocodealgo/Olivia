/**
 * Canvas Manager
 *
 * Manages canvas state and broadcasts widget updates
 * to all connected WebSocket clients.
 *
 * Provides the A2UI API for the agent to push widgets.
 */

import type { Widget, WidgetType, ServerMessage, ChartData, TableData, FormData } from "./types.js";

// ── State ────────────────────────────────────────────

const widgets = new Map<string, Widget>();
const formCallbacks = new Map<string, (data: Record<string, unknown>) => void>();

/** Broadcast function — set by ws-server.ts */
let broadcastFn: (msg: ServerMessage) => void = () => { };

export function setBroadcast(fn: (msg: ServerMessage) => void): void {
    broadcastFn = fn;
}

// ── Widget CRUD ──────────────────────────────────────

function genId(): string {
    return `w-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function addWidget(
    type: WidgetType,
    opts: {
        id?: string;
        title?: string;
        content?: string;
        data?: unknown;
        style?: Record<string, string>;
        position?: Widget["position"];
    } = {},
): Widget {
    const widget: Widget = {
        id: opts.id || genId(),
        type,
        title: opts.title,
        content: opts.content,
        data: opts.data,
        style: opts.style,
        position: opts.position,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
    widgets.set(widget.id, widget);
    broadcastFn({ type: "widget:add", widget });
    return widget;
}

export function updateWidget(
    widgetId: string,
    updates: Partial<Pick<Widget, "title" | "content" | "data" | "style" | "position">>,
): Widget | null {
    const w = widgets.get(widgetId);
    if (!w) return null;
    Object.assign(w, updates, { updatedAt: Date.now() });
    broadcastFn({ type: "widget:update", widget: w });
    return w;
}

export function removeWidget(widgetId: string): boolean {
    const removed = widgets.delete(widgetId);
    if (removed) broadcastFn({ type: "widget:remove", widgetId });
    return removed;
}

export function clearCanvas(): void {
    widgets.clear();
    broadcastFn({ type: "canvas:clear" });
}

export function getCanvasState(): Widget[] {
    return Array.from(widgets.values());
}

// ── A2UI Convenience Methods ─────────────────────────

/** Push raw HTML/JS widget */
export function pushHtml(html: string, title?: string): Widget {
    return addWidget("html", { content: html, title });
}

/** Push a Chart.js chart */
export function pushChart(chart: ChartData, title?: string): Widget {
    return addWidget("chart", { data: chart, title });
}

/** Push an interactive table */
export function pushTable(table: TableData, title?: string): Widget {
    return addWidget("table", { data: table, title });
}

/** Push a form and wait for user response */
export function pushForm(
    form: Omit<FormData, "callbackId">,
    title?: string,
): { widget: Widget; response: Promise<Record<string, unknown>> } {
    const callbackId = `form-${Date.now()}`;
    const formData: FormData = { ...form, callbackId };
    const widget = addWidget("form", { data: formData, title });

    const response = new Promise<Record<string, unknown>>((resolve) => {
        formCallbacks.set(callbackId, resolve);
        // Auto-timeout after 5 minutes
        setTimeout(() => {
            if (formCallbacks.has(callbackId)) {
                formCallbacks.delete(callbackId);
                resolve({});
            }
        }, 300_000);
    });

    return { widget, response };
}

/** Push a markdown block */
export function pushMarkdown(markdown: string, title?: string): Widget {
    return addWidget("markdown", { content: markdown, title });
}

/** Push a code snippet */
export function pushCode(code: string, language?: string, title?: string): Widget {
    return addWidget("code", { content: code, data: { language }, title });
}

/** Push a progress bar */
export function pushProgress(value: number, max: number, label?: string): Widget {
    return addWidget("progress", { data: { value, max, label }, title: label });
}

/** Push a metric card */
export function pushMetric(label: string, value: string | number, trend?: "up" | "down" | "flat"): Widget {
    return addWidget("metric", { data: { label, value, trend }, title: label });
}

/** Push a toast notification */
export function pushToast(message: string, level: "info" | "success" | "warning" | "error" = "info"): void {
    broadcastFn({ type: "toast", message, level });
}

// ── Form callback handling ───────────────────────────

export function handleFormSubmission(callbackId: string, data: Record<string, unknown>): boolean {
    const cb = formCallbacks.get(callbackId);
    if (cb) {
        cb(data);
        formCallbacks.delete(callbackId);
        return true;
    }
    return false;
}
