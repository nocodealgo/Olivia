/**
 * Live Canvas Types
 *
 * Types for the WebSocket-based canvas system.
 * Supports A2UI (Agent-to-UI) interactive widgets.
 */

// ── Widget types ─────────────────────────────────────

export type WidgetType =
    | "html"           // Raw HTML/JS
    | "chart"          // Chart.js chart
    | "table"          // Interactive table
    | "form"           // Input form
    | "markdown"       // Rendered markdown
    | "code"           // Syntax-highlighted code
    | "image"          // Image display
    | "progress"       // Progress bar
    | "metric"         // Key-value metric card
    | "list";          // Interactive list

export interface Widget {
    id: string;
    type: WidgetType;
    title?: string;
    /** Raw HTML content (for type: "html") */
    content?: string;
    /** Structured data (for chart, table, form, etc.) */
    data?: unknown;
    /** CSS styles override */
    style?: Record<string, string>;
    /** Grid position (row, col, span) */
    position?: { row?: number; col?: number; colSpan?: number; rowSpan?: number };
    /** Timestamp */
    createdAt: number;
    updatedAt: number;
}

// ── Chart data ───────────────────────────────────────

export interface ChartData {
    type: "bar" | "line" | "pie" | "doughnut" | "radar";
    labels: string[];
    datasets: Array<{
        label: string;
        data: number[];
        backgroundColor?: string | string[];
        borderColor?: string | string[];
    }>;
    options?: Record<string, unknown>;
}

// ── Table data ───────────────────────────────────────

export interface TableData {
    columns: Array<{ key: string; label: string; width?: string }>;
    rows: Array<Record<string, unknown>>;
    sortable?: boolean;
    filterable?: boolean;
}

// ── Form data ────────────────────────────────────────

export interface FormData {
    fields: Array<{
        name: string;
        label: string;
        type: "text" | "number" | "select" | "checkbox" | "textarea" | "range";
        value?: unknown;
        options?: Array<{ label: string; value: string }>;
        placeholder?: string;
        required?: boolean;
    }>;
    submitLabel?: string;
    /** Callback ID for form submission */
    callbackId: string;
}

// ── WebSocket messages ───────────────────────────────

/** Server → Client */
export type ServerMessage =
    | { type: "canvas:state"; widgets: Widget[] }
    | { type: "widget:add"; widget: Widget }
    | { type: "widget:update"; widget: Widget }
    | { type: "widget:remove"; widgetId: string }
    | { type: "canvas:clear" }
    | { type: "toast"; message: string; level?: "info" | "success" | "warning" | "error" };

/** Client → Server */
export type ClientMessage =
    | { type: "canvas:subscribe" }
    | { type: "form:submit"; widgetId: string; callbackId: string; data: Record<string, unknown> }
    | { type: "widget:action"; widgetId: string; action: string; payload?: unknown };
