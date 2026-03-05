import { config } from "../config.js";
import { MODELS, type ModelInfo } from "./models.js";

// ── Curated model IDs to track from OpenRouter ──────
// These are the non-Anthropic models we want to keep updated.
// Add any OpenRouter model ID here to auto-track it.

const TRACKED_OPENROUTER_MODELS: Record<string, { shortId: string; tools: boolean }> = {
    "openai/gpt-4o": { shortId: "gpt-4o", tools: true },
    "openai/gpt-4o-mini": { shortId: "gpt-4o-mini", tools: true },
    "openai/o3-mini": { shortId: "o3-mini", tools: true },
    "google/gemini-2.0-flash-001": { shortId: "gemini-flash", tools: true },
    "google/gemini-2.5-pro-preview": { shortId: "gemini-pro", tools: true },
    "deepseek/deepseek-chat": { shortId: "deepseek", tools: true },
    "deepseek/deepseek-reasoner": { shortId: "deepseek-r1", tools: false },
    "meta-llama/llama-3.1-70b-instruct": { shortId: "llama-70b", tools: false },
    "meta-llama/llama-4-maverick": { shortId: "llama-maverick", tools: true },
    "moonshotai/kimi-k2.5": { shortId: "kimi-k2.5", tools: true },
    "moonshotai/kimi-k2-instruct": { shortId: "kimi-k2-thinking", tools: true },
    "qwen/qwen-2.5-72b-instruct": { shortId: "qwen-72b", tools: true },
    "mistralai/mistral-large-2411": { shortId: "mistral-large", tools: true },
};

interface OpenRouterModel {
    id: string;
    name: string;
    pricing: { prompt: string; completion: string };
    context_length: number;
    top_provider?: { max_completion_tokens: number };
}

/**
 * Fetch latest model info from OpenRouter and update the registry.
 * Called on startup and can be triggered via /models refresh.
 */
export async function refreshModels(): Promise<number> {
    if (!config.openRouterApiKey) return 0;

    try {
        const response = await fetch("https://openrouter.ai/api/v1/models", {
            headers: { Authorization: `Bearer ${config.openRouterApiKey}` },
        });

        if (!response.ok) {
            console.error(`  ⚠️  OpenRouter models API: ${response.status}`);
            return 0;
        }

        const data = (await response.json()) as { data: OpenRouterModel[] };
        let updated = 0;

        for (const model of data.data) {
            const tracked = TRACKED_OPENROUTER_MODELS[model.id];
            if (!tracked) continue;

            const inputCost = parseFloat(model.pricing.prompt) * 1_000_000;
            const outputCost = parseFloat(model.pricing.completion) * 1_000_000;
            const maxTokens = model.top_provider?.max_completion_tokens || 4096;

            const existing = MODELS[tracked.shortId];
            if (existing) {
                // Update pricing and name if changed
                existing.name = model.name;
                existing.inputCost = Math.round(inputCost * 100) / 100;
                existing.outputCost = Math.round(outputCost * 100) / 100;
                existing.maxTokens = Math.min(maxTokens, 8192);
            } else {
                // Add new model
                MODELS[tracked.shortId] = {
                    id: tracked.shortId,
                    name: model.name,
                    provider: "openrouter",
                    apiModel: model.id,
                    tools: tracked.tools,
                    maxTokens: Math.min(maxTokens, 8192),
                    inputCost: Math.round(inputCost * 100) / 100,
                    outputCost: Math.round(outputCost * 100) / 100,
                };
            }
            updated++;
        }

        if (updated > 0) {
            console.log(`  🔄 Models refreshed: ${updated} updated from OpenRouter`);
        }
        return updated;
    } catch (err) {
        console.error("  ⚠️  Model refresh error:", err instanceof Error ? err.message : err);
        return 0;
    }
}
