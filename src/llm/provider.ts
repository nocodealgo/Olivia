import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { config } from "../config.js";
import { getActiveModel, type ModelInfo } from "./models.js";
import { chatOllama } from "./ollama.js";
import { getThinkingConfig } from "./thinking.js";
import { logUsage } from "../usage/tracker.js";
import { isAirGapped } from "../security/airgap.js";

// ── Clients ──────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });

const openrouter = config.openRouterApiKey
    ? new OpenAI({
        apiKey: config.openRouterApiKey,
        baseURL: "https://openrouter.ai/api/v1",
    })
    : null;

// ── Unified types ────────────────────────────────────

export interface LLMResponse {
    text: string;
    toolCalls: Array<{
        id: string;
        name: string;
        input: Record<string, unknown>;
    }>;
    stopReason: "end_turn" | "tool_use" | "max_tokens" | string;
    inputTokens: number;
    outputTokens: number;
    model: string;
    /** Raw response content for Anthropic session history */
    rawContent: any;
}

export interface LLMMessage {
    role: "user" | "assistant";
    content: any; // string | Anthropic blocks | OpenAI messages
}

// ── Unified chat ─────────────────────────────────────

/**
 * Send a chat completion to the active model.
 * Handles both Anthropic and OpenRouter transparently.
 */
export async function chatCompletion(
    system: string,
    messages: LLMMessage[],
    tools?: any[],
    modelOverride?: ModelInfo
): Promise<LLMResponse> {
    const model = modelOverride || getActiveModel();

    // Air-gapped: force Ollama
    if (isAirGapped() && model.provider !== "ollama") {
        console.log("  ✈️  Air-gapped: routing to Ollama instead of", model.provider);
        return chatOllama(system, messages, {
            id: "ollama/llama3", provider: "ollama", name: "llama3",
            apiModel: "llama3", tools: false, maxTokens: 4096,
            inputCost: 0, outputCost: 0,
        });
    }

    if (model.provider === "anthropic") {
        return chatAnthropic(system, messages, tools, model);
    } else if (model.provider === "ollama") {
        return chatOllama(system, messages, model);
    } else {
        return chatOpenRouter(system, messages, tools, model);
    }
}

// ── Anthropic provider ───────────────────────────────

async function chatAnthropic(
    system: string,
    messages: LLMMessage[],
    tools: any[] | undefined,
    model: ModelInfo
): Promise<LLMResponse> {
    const start = Date.now();

    const params: any = {
        model: model.apiModel,
        max_tokens: model.maxTokens,
        system,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
    };

    if (tools && tools.length > 0 && model.tools) {
        params.tools = tools;
    }

    // Apply extended thinking if enabled
    const thinking = getThinkingConfig();
    if (thinking.anthropicBudget > 0) {
        params.thinking = {
            type: "enabled",
            budget_tokens: thinking.anthropicBudget,
        };
        // Extended thinking requires higher max_tokens
        params.max_tokens = Math.max(model.maxTokens, thinking.anthropicBudget + 4096);
    }

    const response = await anthropic.messages.create(params);
    const latency = Date.now() - start;

    logUsage(model.apiModel, response.usage.input_tokens, response.usage.output_tokens, latency, "chat");

    // Extract text and tool calls
    const text = response.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("");

    const toolCalls = response.content
        .filter((b: any) => b.type === "tool_use")
        .map((b: any) => ({
            id: b.id,
            name: b.name,
            input: b.input as Record<string, unknown>,
        }));

    return {
        text,
        toolCalls,
        stopReason: response.stop_reason === "tool_use" ? "tool_use" : "end_turn",
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        model: response.model,
        rawContent: response.content,
    };
}

// ── OpenRouter provider (OpenAI-compatible) ──────────

async function chatOpenRouter(
    system: string,
    messages: LLMMessage[],
    tools: any[] | undefined,
    model: ModelInfo
): Promise<LLMResponse> {
    if (!openrouter) {
        throw new Error("OpenRouter API key not configured — set OPENROUTER_API_KEY in .env");
    }

    const start = Date.now();

    // Apply thinking prompt suffix for non-Anthropic models
    const thinking = getThinkingConfig();
    const effectiveSystem = system + thinking.promptSuffix;

    // Convert Anthropic-style messages to OpenAI format
    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [
        { role: "system" as const, content: effectiveSystem },
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

    // Convert Anthropic tool format to OpenAI format
    const openaiTools: OpenAI.ChatCompletionTool[] | undefined =
        tools && tools.length > 0 && model.tools
            ? tools.map((t: any) => ({
                type: "function" as const,
                function: {
                    name: t.name,
                    description: t.description || "",
                    parameters: t.input_schema || {},
                },
            }))
            : undefined;

    const params: OpenAI.ChatCompletionCreateParams = {
        model: model.apiModel,
        max_tokens: model.maxTokens,
        messages: openaiMessages,
    };

    if (openaiTools) {
        params.tools = openaiTools;
    }

    const response = await openrouter.chat.completions.create(params);
    const latency = Date.now() - start;
    const choice = response.choices[0];

    const inputTokens = response.usage?.prompt_tokens || 0;
    const outputTokens = response.usage?.completion_tokens || 0;

    logUsage(model.apiModel, inputTokens, outputTokens, latency, "chat");

    // Extract tool calls
    const rawToolCalls = (choice.message.tool_calls || []) as Array<{
        id: string;
        function: { name: string; arguments: string };
    }>;
    const toolCalls = rawToolCalls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        input: JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>,
    }));

    const text = choice.message.content || "";
    const stopReason = choice.finish_reason === "tool_calls" ? "tool_use" : "end_turn";

    // Build Anthropic-compatible rawContent for session history
    const rawContent: any[] = [];
    if (text) rawContent.push({ type: "text", text });
    for (const tc of toolCalls) {
        rawContent.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: tc.input,
        });
    }

    return {
        text,
        toolCalls,
        stopReason,
        inputTokens,
        outputTokens,
        model: model.apiModel,
        rawContent: rawContent.length > 0 ? rawContent : text,
    };
}
