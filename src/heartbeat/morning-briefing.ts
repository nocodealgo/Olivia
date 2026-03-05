import { config } from "../config.js";
import { isAirGapped } from "../security/airgap.js";

// ── Config ───────────────────────────────────────────

const DEFAULT_CITY = process.env.BRIEFING_CITY || "Querétaro";
const DEFAULT_COUNTRY = process.env.BRIEFING_COUNTRY || "Mexico";
const BRIEFING_LANG = process.env.BRIEFING_LANG || "es";

// ── IP Geolocation (city-level, no API key) ──────────

async function detectCity(): Promise<{ city: string; country: string }> {
    // Skip network call in air-gapped mode
    if (isAirGapped()) return { city: DEFAULT_CITY, country: DEFAULT_COUNTRY };

    try {
        const res = await fetch("http://ip-api.com/json/?fields=city,country", {
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { city?: string; country?: string };
        if (data.city) {
            return { city: data.city, country: data.country || DEFAULT_COUNTRY };
        }
    } catch {
        // Silently fall back to default
    }
    return { city: DEFAULT_CITY, country: DEFAULT_COUNTRY };
}

// ── Public API ───────────────────────────────────────

/**
 * Build the morning briefing prompt.
 * Auto-detects city from IP, checks memory for overrides,
 * then gathers weather + tasks via tools.
 */
export async function buildBriefingPrompt(): Promise<string> {
    const now = new Date();
    const dateStr = new Intl.DateTimeFormat("en-US", {
        timeZone: config.timezone,
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
    }).format(now);

    // Auto-detect city from IP, fall back to .env default
    const loc = await detectCity();

    return `You are generating a proactive morning briefing for ${dateStr}.
Your owner's detected location is ${loc.city}, ${loc.country} (timezone: ${config.timezone}).

**You MUST use your tools to gather real, current information.** Do NOT make up data. Follow these steps:

0. **📍 Location** — Use memory_search to look for the owner's current city/location (keywords: "location", "city", "estoy en", "moved to", "traveling"). If found, use that city instead of "${loc.city}". If not found, use the detected location above.

1. **🌤️ Weather (conditional)** — Use web_search to check today's weather for the resolved location. **Only include weather in the briefing if there's something extraordinary** (storms, extreme heat/cold, rain when it's unusual, weather alerts, or a drastic change from recent trends). If it's a normal day, skip weather entirely.

2. **📋 Tasks & Reminders** — Use memory_search to look for any saved tasks, reminders, deadlines, or events for today or this week. If none found, skip this section.

3. **💡 Daily Tip** — One brief, useful tip (productivity, tech, health — rotate topics).

**Format the briefing as a clean, well-organized message in ${BRIEFING_LANG === "es" ? "Spanish" : "English"}** using this structure:

☀️ **Buenos días / Good morning**

🌤️ **Clima** — [weather summary, only if extraordinary]
📋 **Pendientes** — [tasks/reminders or "Nada pendiente"]
💡 **Tip** — [one-liner tip]

Keep it concise — the whole briefing should fit in one Telegram message (under 800 chars). Be warm and personal.`;
}

/**
 * Get the default morning briefing schedule config.
 */
export function getDefaultBriefingConfig() {
    return {
        name: "Morning Briefing",
        hour: parseInt(process.env.BRIEFING_HOUR || "8"),
        minute: parseInt(process.env.BRIEFING_MINUTE || "0"),
        days: process.env.BRIEFING_DAYS || "1,2,3,4,5,6,7",
    };
}
