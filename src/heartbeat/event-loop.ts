import { bot } from "../bot.js";
import { config } from "../config.js";
import { generateProactiveMessage } from "../agent.js";

// ── Config ───────────────────────────────────────────

/** How often to check for events (default: 30 minutes) */
const CHECK_INTERVAL_MS = parseInt(process.env.HEARTBEAT_INTERVAL_MIN || "30") * 60_000;

/** Watchers are pluggable functions that return an alert string or null */
type Watcher = () => Promise<string | null>;

// ── State ────────────────────────────────────────────

let intervalId: ReturnType<typeof setInterval> | null = null;
const watchers: Array<{ name: string; fn: Watcher }> = [];

// ── Public API ───────────────────────────────────────

/**
 * Register a watcher function. It will be called on each heartbeat tick.
 * Return a descriptive string to trigger a notification, or null to skip.
 */
export function registerWatcher(name: string, fn: Watcher): void {
    watchers.push({ name, fn });
}

/**
 * Start the event loop. Runs all registered watchers on each tick.
 */
export function startEventLoop(): void {
    if (watchers.length === 0) {
        console.log("  🔄 Event loop: no watchers registered, skipping.");
        return;
    }

    const mins = CHECK_INTERVAL_MS / 60_000;
    console.log(`  🔄 Event loop started — ${watchers.length} watcher(s), checking every ${mins}min.`);

    // First check after a short delay (don't flood on startup)
    setTimeout(runWatchers, 60_000);
    intervalId = setInterval(runWatchers, CHECK_INTERVAL_MS);
}

/**
 * Stop the event loop.
 */
export function stopEventLoop(): void {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }
}

// ── Internal ─────────────────────────────────────────

async function runWatchers(): Promise<void> {
    const alerts: string[] = [];

    for (const watcher of watchers) {
        try {
            const result = await watcher.fn();
            if (result) {
                alerts.push(`[${watcher.name}] ${result}`);
            }
        } catch (err) {
            console.error(`  ⚠️  Watcher "${watcher.name}" error:`, err instanceof Error ? err.message : err);
        }
    }

    if (alerts.length === 0) return;

    console.log(`  🔔 Event loop: ${alerts.length} alert(s) detected.`);

    try {
        // Ask the agent to compose a natural notification from the raw alerts
        const prompt = `You detected the following noteworthy events. Compose a brief, helpful notification for your owner. Be concise — this is an unsolicited alert, so keep it short and only mention what's important.\n\n${alerts.join("\n\n")}`;

        const message = await generateProactiveMessage(prompt);

        await bot.api.sendMessage(config.ownerChatId, message, {
            parse_mode: "Markdown",
        }).catch(() =>
            bot.api.sendMessage(config.ownerChatId, message)
        );
    } catch (err) {
        console.error("  ❌ Event loop notification error:", err instanceof Error ? err.message : err);
    }
}
