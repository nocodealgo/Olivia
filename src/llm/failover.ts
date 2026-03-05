import { chatCompletion, type LLMResponse, type LLMMessage } from "./provider.js";
import { MODELS, getActiveModel, type ModelInfo } from "./models.js";

// ── Failover chain ───────────────────────────────────
// If the primary model fails, try these in order.

const FAILOVER_CHAINS: Record<string, string[]> = {
    // Anthropic models fail over to each other, then to OpenRouter
    "claude-sonnet": ["claude-haiku", "gpt-4o", "gemini-pro", "deepseek"],
    "claude-haiku": ["claude-sonnet", "gpt-4o-mini", "gemini-pro"],
    "claude-opus": ["claude-sonnet", "gpt-4o", "gemini-pro"],
    // OpenRouter models fail over to Anthropic, then other OpenRouter
    "gpt-4o": ["claude-sonnet", "gemini-pro", "deepseek"],
    "gpt-4o-mini": ["claude-haiku", "gemini-pro", "deepseek"],
    "gemini-pro": ["claude-sonnet", "gpt-4o", "deepseek"],
    "deepseek": ["claude-sonnet", "gemini-pro", "gpt-4o"],
    "llama-70b": ["deepseek", "gemini-pro", "claude-haiku"],
    "kimi-k2.5": ["claude-sonnet", "gemini-pro", "gpt-4o"],
    "kimi-k2-thinking": ["claude-sonnet", "deepseek", "gemini-pro"],
};

// Default chain for any model not explicitly listed
const DEFAULT_CHAIN = ["claude-sonnet", "gpt-4o", "gemini-pro", "deepseek"];

const TIMEOUT_MS = 60_000; // 60s timeout per attempt

// ── Retriable errors ─────────────────────────────────

function isRetriable(err: any): boolean {
    if (!err) return false;

    const msg = err?.message?.toLowerCase() || "";
    const status = err?.status || err?.statusCode || err?.error?.status || 0;

    // Rate limits
    if (status === 429) return true;
    // Server errors
    if (status >= 500 && status < 600) return true;
    // Overloaded
    if (msg.includes("overloaded") || msg.includes("capacity")) return true;
    // Timeout
    if (msg.includes("timeout") || msg.includes("timed out") || err.code === "ETIMEDOUT") return true;
    // Network errors
    if (msg.includes("econnreset") || msg.includes("econnrefused") || msg.includes("fetch failed")) return true;

    return false;
}

// ── Public API ───────────────────────────────────────

/**
 * Chat with failover: tries the active model first, then falls through
 * the priority chain on retriable errors.
 */
export async function chatWithFailover(
    system: string,
    messages: LLMMessage[],
    tools?: any[]
): Promise<LLMResponse> {
    const primary = getActiveModel();
    const chain = getFailoverChain(primary.id);

    // Try primary first
    const allModels = [primary, ...chain.map((id) => MODELS[id]).filter(Boolean)];

    for (let i = 0; i < allModels.length; i++) {
        const model = allModels[i];
        const isPrimary = i === 0;

        try {
            const response = await withTimeout(
                chatCompletion(system, messages, tools, model),
                TIMEOUT_MS
            );

            if (!isPrimary) {
                console.log(`  🔀 Failover: responded via ${model.name} (${model.id})`);
            }

            return response;
        } catch (err: any) {
            const modelLabel = `${model.name} (${model.id})`;

            if (isRetriable(err) && i < allModels.length - 1) {
                const next = allModels[i + 1];
                console.log(`  ⚠️  ${modelLabel} failed: ${err.message || err}. Falling over to ${next.name}…`);
                continue;
            }

            // Last in chain or non-retriable — throw
            if (i === allModels.length - 1) {
                console.error(`  ❌ All models exhausted. Last error from ${modelLabel}: ${err.message || err}`);
            }
            throw err;
        }
    }

    // Should never reach here, but TypeScript needs it
    throw new Error("No models available for failover");
}

// ── Helpers ──────────────────────────────────────────

function getFailoverChain(modelId: string): string[] {
    return FAILOVER_CHAINS[modelId] || DEFAULT_CHAIN.filter((id) => id !== modelId);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Request timed out after ${ms / 1000}s`)), ms);
        promise.then(
            (val) => { clearTimeout(timer); resolve(val); },
            (err) => { clearTimeout(timer); reject(err); }
        );
    });
}
