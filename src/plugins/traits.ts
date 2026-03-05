/**
 * Trait-based Plugin System
 *
 * Defines interfaces (traits) for the four core extension points:
 * - Provider: LLM backends (Anthropic, OpenRouter, Ollama, etc.)
 * - Channel: Message transports (Telegram, WhatsApp, Webhook, etc.)
 * - Tool: Agent capabilities (shell, file, browser, etc.)
 * - Memory: Storage backends (SQLite, Supabase, etc.)
 *
 * Plugins implement these traits and register themselves.
 * The active implementation for each trait is selected via config.
 */

// ── Provider Trait ───────────────────────────────────

export interface ProviderTrait {
    /** Unique identifier (e.g. "anthropic", "openrouter", "ollama") */
    id: string;
    name: string;

    /** Check if this provider is available (has API key, server running, etc.) */
    isAvailable(): boolean;

    /** Send a chat completion */
    chat(options: {
        system: string;
        messages: Array<{ role: string; content: any }>;
        tools?: any[];
        model?: string;
        maxTokens?: number;
    }): Promise<{
        text: string;
        toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>;
        stopReason: string;
        inputTokens: number;
        outputTokens: number;
        model: string;
        rawContent: any;
    }>;
}

// ── Channel Trait ────────────────────────────────────

export interface ChannelTrait {
    /** Unique identifier (e.g. "telegram", "whatsapp", "webhook") */
    id: string;
    name: string;

    /** Start receiving messages */
    start(): Promise<void>;

    /** Stop receiving messages */
    stop(): Promise<void>;

    /** Send a message to a user/chat */
    send(chatId: string | number, message: string, options?: {
        parseMode?: string;
        replyTo?: number;
    }): Promise<void>;

    /** Check if this channel is available/configured */
    isAvailable(): boolean;
}

// ── Tool Trait ───────────────────────────────────────

export interface ToolTrait {
    /** Unique identifier (e.g. "shell_exec", "file_read") */
    id: string;
    name: string;
    description: string;

    /** JSON Schema for tool input */
    inputSchema: Record<string, unknown>;

    /** Execute the tool */
    execute(input: Record<string, unknown>): Promise<string>;

    /** Check if this tool is available (optional — default true) */
    isAvailable?(): boolean;
}

// ── Memory Trait ─────────────────────────────────────

export interface MemoryTrait {
    /** Unique identifier (e.g. "sqlite", "supabase", "postgres") */
    id: string;
    name: string;

    /** Initialize the memory backend */
    init(): Promise<void>;

    /** Store a conversation message */
    saveMessage(chatId: number, role: string, content: string): Promise<string>;

    /** Retrieve conversation history */
    getHistory(chatId: number, limit?: number): Promise<Array<{
        id: string;
        role: string;
        content: string;
        timestamp: number;
    }>>;

    /** Store a key-value fact/memory */
    saveFact(chatId: number, key: string, value: string): Promise<void>;

    /** Search facts/memories */
    searchFacts(chatId: number, query: string, limit?: number): Promise<Array<{
        key: string;
        value: string;
        score?: number;
    }>>;

    /** Close connections */
    close(): Promise<void>;

    /** Check if this backend is available */
    isAvailable(): boolean;
}

// ── Plugin Metadata ──────────────────────────────────

export interface PluginMetadata {
    /** Plugin package name */
    name: string;
    version: string;
    description: string;
    author?: string;

    /** What traits this plugin provides */
    provides: {
        providers?: ProviderTrait[];
        channels?: ChannelTrait[];
        tools?: ToolTrait[];
        memory?: MemoryTrait[];
    };
}
