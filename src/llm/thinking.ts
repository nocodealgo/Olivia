// ── Thinking level control ───────────────────────────
// Controls reasoning depth for LLM responses.
// Maps to Anthropic extended thinking + prompt engineering for other models.

export type ThinkingLevel = "off" | "low" | "medium" | "high";

interface ThinkingConfig {
    label: string;
    /** Budget tokens for Anthropic extended thinking (0 = disabled) */
    anthropicBudget: number;
    /** System prompt suffix for non-Anthropic models */
    promptSuffix: string;
}

const THINKING_CONFIGS: Record<ThinkingLevel, ThinkingConfig> = {
    off: {
        label: "Off — fast, direct answers",
        anthropicBudget: 0,
        promptSuffix: "",
    },
    low: {
        label: "Low — brief reasoning",
        anthropicBudget: 2048,
        promptSuffix: "\n\nThink briefly before answering. Keep your reasoning concise.",
    },
    medium: {
        label: "Medium — thorough reasoning",
        anthropicBudget: 8192,
        promptSuffix: "\n\nThink step by step before answering. Show your reasoning process.",
    },
    high: {
        label: "High — deep analysis",
        anthropicBudget: 16384,
        promptSuffix: "\n\nThink deeply and thoroughly before answering. Analyze from multiple angles. Consider edge cases and alternatives. Show your full reasoning process.",
    },
};

// ── State ────────────────────────────────────────────

let currentLevel: ThinkingLevel = "off";

export function getThinkingLevel(): ThinkingLevel {
    return currentLevel;
}

export function setThinkingLevel(level: ThinkingLevel): ThinkingConfig | null {
    if (!THINKING_CONFIGS[level]) return null;
    currentLevel = level;
    return THINKING_CONFIGS[level];
}

export function getThinkingConfig(): ThinkingConfig {
    return THINKING_CONFIGS[currentLevel];
}

export function getThinkingLabel(): string {
    return THINKING_CONFIGS[currentLevel].label;
}

export const VALID_LEVELS: ThinkingLevel[] = ["off", "low", "medium", "high"];
