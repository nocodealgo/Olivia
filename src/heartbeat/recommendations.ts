import { generateProactiveMessage } from "../agent.js";
import { bot } from "../bot.js";
import { config } from "../config.js";

// ── Config ───────────────────────────────────────────

/** How often to analyze patterns (default: 6 hours) */
const ANALYSIS_INTERVAL_MS = parseInt(process.env.RECOMMEND_INTERVAL_HOURS || "6") * 3_600_000;

// ── State ────────────────────────────────────────────

let intervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Track interaction patterns — logged per message for the agent to analyze.
 */
interface InteractionLog {
    timestamp: number;
    hour: number;
    dayOfWeek: number;
    topic: string;
    toolsUsed: string[];
}

const interactionLog: InteractionLog[] = [];
const MAX_LOG_SIZE = 200;

// ── Public API ───────────────────────────────────────

/**
 * Log an interaction for pattern analysis.
 * Call this after each user message is processed.
 */
export function logInteraction(text: string, toolsUsed: string[] = []): void {
    const now = new Date();
    const hour = now.getHours();
    const dayOfWeek = now.getDay(); // 0=Sun

    // Extract topic keywords (simple heuristic)
    const topic = extractTopicKeywords(text);

    interactionLog.push({ timestamp: now.getTime(), hour, dayOfWeek, topic, toolsUsed });

    // Keep log bounded
    if (interactionLog.length > MAX_LOG_SIZE) {
        interactionLog.splice(0, interactionLog.length - MAX_LOG_SIZE);
    }
}

/**
 * Start the proactive recommendation loop.
 */
export function startRecommendations(): void {
    console.log(`  💡 Recommendation engine started (analyzing every ${ANALYSIS_INTERVAL_MS / 3_600_000}h).`);
    // First analysis after 1 hour (need some data first)
    setTimeout(analyzeAndRecommend, Math.min(ANALYSIS_INTERVAL_MS, 3_600_000));
    intervalId = setInterval(analyzeAndRecommend, ANALYSIS_INTERVAL_MS);
}

/**
 * Stop the recommendation loop.
 */
export function stopRecommendations(): void {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }
}

/**
 * Get current interaction stats (for the agent to use).
 */
export function getInteractionStats(): string {
    if (interactionLog.length < 5) return "Not enough data yet for pattern analysis.";

    const now = Date.now();
    const last24h = interactionLog.filter((l) => now - l.timestamp < 86_400_000);
    const last7d = interactionLog.filter((l) => now - l.timestamp < 7 * 86_400_000);

    // Hour distribution
    const hourCounts: Record<number, number> = {};
    for (const log of last7d) {
        hourCounts[log.hour] = (hourCounts[log.hour] || 0) + 1;
    }
    const peakHour = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0];

    // Topic frequency
    const topicCounts: Record<string, number> = {};
    for (const log of last7d) {
        if (log.topic) topicCounts[log.topic] = (topicCounts[log.topic] || 0) + 1;
    }
    const topTopics = Object.entries(topicCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

    // Tool usage
    const toolCounts: Record<string, number> = {};
    for (const log of last7d) {
        for (const tool of log.toolsUsed) {
            toolCounts[tool] = (toolCounts[tool] || 0) + 1;
        }
    }
    const topTools = Object.entries(toolCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

    return [
        `📊 Interaction patterns (last 7 days):`,
        `- Total messages: ${last7d.length} (${last24h.length} today)`,
        `- Peak activity hour: ${peakHour ? `${peakHour[0]}:00 (${peakHour[1]} msgs)` : "N/A"}`,
        `- Top topics: ${topTopics.map(([t, n]) => `${t} (${n})`).join(", ") || "N/A"}`,
        `- Top tools: ${topTools.map(([t, n]) => `${t} (${n})`).join(", ") || "N/A"}`,
    ].join("\n");
}

// ── Internal ─────────────────────────────────────────

async function analyzeAndRecommend(): Promise<void> {
    if (interactionLog.length < 10) return; // Need minimum data

    const stats = getInteractionStats();

    try {
        const prompt = `You are analyzing your owner's interaction patterns to provide one proactive suggestion. Here are the stats:

${stats}

Based on these patterns, generate ONE brief, helpful suggestion. Examples of good suggestions:
- "I notice you often ask about X around Y time — want me to schedule a daily check?"
- "You've been using tool Z frequently — did you know it can also do W?"
- "I see a pattern of activity late at night — remember to take breaks!"

Rules:
- Only suggest if you genuinely see something useful. If nothing stands out, respond with exactly: __NO_RECOMMENDATION__
- Keep it to 1-2 sentences max.
- Be warm and natural, not robotic.
- Don't repeat suggestions you've made before.`;

        const message = await generateProactiveMessage(prompt);

        if (message.includes("__NO_RECOMMENDATION__")) return;

        await bot.api.sendMessage(config.ownerChatId, `💡 ${message}`, {
            parse_mode: "Markdown",
        }).catch(() =>
            bot.api.sendMessage(config.ownerChatId, `💡 ${message}`)
        );

        console.log("  💡 Proactive recommendation sent.");
    } catch (err) {
        console.error("  ⚠️  Recommendation error:", err instanceof Error ? err.message : err);
    }
}

function extractTopicKeywords(text: string): string {
    const lower = text.toLowerCase();
    const topics = [
        "weather", "clima", "code", "código", "schedule", "reminder", "recordatorio",
        "search", "buscar", "file", "archivo", "memory", "task", "tarea",
        "music", "música", "voice", "voz", "translate", "traducir",
        "news", "noticias", "email", "help", "ayuda", "debug", "error",
    ];

    const matched = topics.filter((t) => lower.includes(t));
    return matched[0] || "";
}
