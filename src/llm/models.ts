// ── Model registry & hot-swap ────────────────────────

export interface ModelInfo {
    id: string;
    name: string;
    provider: "anthropic" | "openrouter" | "ollama";
    /** The model ID to pass to the API */
    apiModel: string;
    /** Supports tool calling */
    tools: boolean;
    /** Max output tokens */
    maxTokens: number;
    /** Cost per 1M input tokens (USD) */
    inputCost: number;
    /** Cost per 1M output tokens (USD) */
    outputCost: number;
}

// ── Available models ─────────────────────────────────

export const MODELS: Record<string, ModelInfo> = {
    // ── Anthropic (direct) ──
    "claude-sonnet": {
        id: "claude-sonnet",
        name: "Claude 4 Sonnet",
        provider: "anthropic",
        apiModel: "claude-sonnet-4-20250514",
        tools: true,
        maxTokens: 4096,
        inputCost: 3.0,
        outputCost: 15.0,
    },
    "claude-haiku": {
        id: "claude-haiku",
        name: "Claude 4.5 Haiku",
        provider: "anthropic",
        apiModel: "claude-haiku-4-5-20251001",
        tools: true,
        maxTokens: 4096,
        inputCost: 0.80,
        outputCost: 4.0,
    },
    "claude-opus": {
        id: "claude-opus",
        name: "Claude 4 Opus",
        provider: "anthropic",
        apiModel: "claude-4-opus-20250514",
        tools: true,
        maxTokens: 4096,
        inputCost: 15.0,
        outputCost: 75.0,
    },

    // ── OpenRouter (OpenAI-compatible) ──
    "gpt-4o": {
        id: "gpt-4o",
        name: "GPT-4o",
        provider: "openrouter",
        apiModel: "openai/gpt-4o",
        tools: true,
        maxTokens: 4096,
        inputCost: 2.5,
        outputCost: 10.0,
    },
    "gpt-4o-mini": {
        id: "gpt-4o-mini",
        name: "GPT-4o Mini",
        provider: "openrouter",
        apiModel: "openai/gpt-4o-mini",
        tools: true,
        maxTokens: 4096,
        inputCost: 0.15,
        outputCost: 0.60,
    },
    "gemini-pro": {
        id: "gemini-pro",
        name: "Gemini 2.0 Flash",
        provider: "openrouter",
        apiModel: "google/gemini-2.0-flash-001",
        tools: true,
        maxTokens: 4096,
        inputCost: 0.10,
        outputCost: 0.40,
    },
    "deepseek": {
        id: "deepseek",
        name: "DeepSeek V3",
        provider: "openrouter",
        apiModel: "deepseek/deepseek-chat",
        tools: true,
        maxTokens: 4096,
        inputCost: 0.27,
        outputCost: 1.10,
    },
    "llama-70b": {
        id: "llama-70b",
        name: "Llama 3.1 70B (Groq)",
        provider: "openrouter",
        apiModel: "meta-llama/llama-3.1-70b-instruct",
        tools: false,
        maxTokens: 4096,
        inputCost: 0.59,
        outputCost: 0.79,
    },
    "kimi-k2.5": {
        id: "kimi-k2.5",
        name: "Kimi K2.5 (Multimodal)",
        provider: "openrouter",
        apiModel: "moonshotai/kimi-k2.5",
        tools: true,
        maxTokens: 4096,
        inputCost: 0.20,
        outputCost: 0.80,
    },
    "kimi-k2-thinking": {
        id: "kimi-k2-thinking",
        name: "Kimi K2 Thinking (MoE)",
        provider: "openrouter",
        apiModel: "moonshotai/kimi-k2-instruct",
        tools: true,
        maxTokens: 4096,
        inputCost: 0.40,
        outputCost: 1.60,
    },
};

// ── Active model state ───────────────────────────────

let activeModelId = "claude-sonnet";

export function getActiveModel(): ModelInfo {
    return MODELS[activeModelId] || MODELS["claude-sonnet"];
}

export function setActiveModel(modelId: string): ModelInfo | null {
    if (!MODELS[modelId]) return null;
    activeModelId = modelId;
    return MODELS[modelId];
}

export function listModels(): ModelInfo[] {
    return Object.values(MODELS);
}
