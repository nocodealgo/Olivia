import { bot } from "../bot.js";
import { config } from "../config.js";
import { listSchedules, markScheduleRun, type Schedule } from "./schedules-db.js";
import { buildBriefingPrompt } from "./morning-briefing.js";
import { generateProactiveMessage } from "../agent.js";

// ── State ────────────────────────────────────────────

let intervalId: ReturnType<typeof setInterval> | null = null;

// ── Public API ───────────────────────────────────────

/**
 * Start the heartbeat scheduler. Checks every 60 seconds
 * if any schedule should fire based on current time.
 */
export function startScheduler(): void {
    console.log("  ⏰ Heartbeat scheduler started (checking every 60s).");

    // Check immediately on startup, then every 60s
    checkSchedules();
    intervalId = setInterval(checkSchedules, 60_000);
}

/**
 * Stop the heartbeat scheduler.
 */
export function stopScheduler(): void {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }
}

// ── Internal ─────────────────────────────────────────

async function checkSchedules(): Promise<void> {
    const now = new Date();

    // Get current time in configured timezone
    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: config.timezone,
        hour: "numeric",
        minute: "numeric",
        weekday: "short",
        hour12: false,
    });

    const parts = formatter.formatToParts(now);
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0");
    const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0");
    const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";

    // Map weekday to number (1=Mon, 7=Sun)
    const dayMap: Record<string, number> = {
        Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
    };
    const dayNum = dayMap[weekday] ?? 0;

    const schedules = listSchedules(true); // enabled only

    for (const schedule of schedules) {
        if (shouldFire(schedule, hour, minute, dayNum)) {
            await fireSchedule(schedule);
        }
    }
}

function shouldFire(schedule: Schedule, hour: number, minute: number, dayNum: number): boolean {
    // Check time match
    if (schedule.cron_hour !== hour || schedule.cron_minute !== minute) return false;

    // Check day match
    const allowedDays = schedule.days.split(",").map(Number);
    if (!allowedDays.includes(dayNum)) return false;

    // Check if already fired this minute (prevent double-fire)
    if (schedule.last_run) {
        const lastRun = new Date(schedule.last_run + "Z");
        const diffMs = Date.now() - lastRun.getTime();
        if (diffMs < 90_000) return false; // Less than 90 seconds ago
    }

    return true;
}

async function fireSchedule(schedule: Schedule): Promise<void> {
    console.log(`  💓 Heartbeat: firing "${schedule.name}" (#${schedule.id})`);

    try {
        // Mark as run immediately to prevent double-fire
        markScheduleRun(schedule.id);

        // Resolve prompt — if it's the morning briefing marker, build dynamically
        const prompt = schedule.prompt === "__MORNING_BRIEFING__"
            ? await buildBriefingPrompt()
            : schedule.prompt;

        // Generate a proactive message using the agent
        const message = await generateProactiveMessage(prompt);

        // Send to the owner's chat
        await bot.api.sendMessage(config.ownerChatId, message, {
            parse_mode: "Markdown",
        }).catch(() =>
            // Fallback to plain text if Markdown fails
            bot.api.sendMessage(config.ownerChatId, message)
        );

        console.log(`  ✅ Heartbeat sent: "${schedule.name}"`);
    } catch (err) {
        console.error(`  ❌ Heartbeat error for "${schedule.name}":`, err);
    }
}
