import OpenAI from "openai";
import { MODELS, type ModelInfo } from "./models.js";
import { logUsage } from "../usage/tracker.js";
import type { LLMResponse, LLMMessage } from "./provider.js";

// ── Ollama client (OpenAI-compatible API) ────────────

const OLLAMA_BASE_URL = process.env.OLLAMA_URL || "http://localhost:11434";

const ollamaClient = new OpenAI({
    apiKey: "ollama", // Ollama doesn't need a real key
    baseURL: `${OLLAMA_BASE_URL}/v1`,
});

// ── Auto-detect Ollama models ────────────────────────

interface OllamaModel {
    name: string;
    size: number;
    details?: { parameter_size?: string; family?: string };
}

/**
 * Detect running Ollama instance and register available models.
 * Returns the number of models found.
 */
export async function detectOllamaModels(): Promise<number> {
    try {
        const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
            signal: AbortSignal.timeout(3000), // 3s timeout
        });

        if (!response.ok) return 0;

        const data = (await response.json()) as { models: OllamaModel[] };
        let count = 0;

        for (const model of data.models) {
            const shortName = model.name.replace(/:latest$/, "");
            const id = `local/${shortName}`;

            // Skip if already registered
            if (MODELS[id]) continue;

            const sizeGB = model.size / (1024 * 1024 * 1024);
            const sizeLabel = sizeGB > 1 ? `${sizeGB.toFixed(1)}GB` : `${(model.size / (1024 * 1024)).toFixed(0)}MB`;

            MODELS[id] = {
                id,
                name: `${shortName} (local, ${sizeLabel})`,
                provider: "ollama",
                apiModel: model.name,
                tools: false, // Most local models don't support tool calling reliably
                maxTokens: 4096,
                inputCost: 0,
                outputCost: 0,
            };
            count++;
        }

        if (count > 0) {
            console.log(`  🏠 Ollama: ${count} local model(s) detected`);
        }

        return count;
    } catch {
        // Ollama not running — that's fine
        return 0;
    }
}

// ── Chat with Ollama ─────────────────────────────────

export async function chatOllama(
    system: string,
    messages: LLMMessage[],
    model: ModelInfo
): Promise<LLMResponse> {
    const start = Date.now();

    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [
        { role: "system" as const, content: system },
        ...messages.map((m) => ({
            role: m.role as "user" | "assistant",
            content: typeof m.content === "string"
                ? m.content
                : Array.isArray(m.content)
                    ? m.content
                        .filter((b: any) => b.type === "text" || b.type === "tool_result")
                        .map((b: any) => b.text || b.content || JSON.stringify(b))
                        .join("\n")
                    : String(m.content),
        })),
    ];

    const response = await ollamaClient.chat.completions.create({
        model: model.apiModel,
        messages: openaiMessages,
        max_tokens: model.maxTokens,
    });

    const latency = Date.now() - start;
    const choice = response.choices[0];
    const text = choice.message.content || "";

    logUsage(
        model.apiModel,
        response.usage?.prompt_tokens || 0,
        response.usage?.completion_tokens || 0,
        latency,
        "chat"
    );

    return {
        text,
        toolCalls: [],
        stopReason: "end_turn",
        inputTokens: response.usage?.prompt_tokens || 0,
        outputTokens: response.usage?.completion_tokens || 0,
        model: model.apiModel,
        rawContent: text,
    };
}
