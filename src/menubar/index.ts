/**
 * Menu Bar Module
 *
 * Initializes:
 * - Dashboard web UI routes (status, chat, voice)
 * - Voice wake word service (optional)
 * - macOS native tray helper (optional)
 */

import { config } from "../config.js";
import { startVoiceWake, stopVoiceWake } from "./voice-wake.js";

export { handleDashboardRoute, resolveChatReply } from "./dashboard-routes.js";

// ── Tray helper ──────────────────────────────────────

let trayStarted = false;

export function startMenuBar(): void {
    console.log(`  🖥️  Dashboard: http://localhost:${process.env.WEBHOOK_PORT || 3100}/dashboard`);

    // Start voice wake if configured
    startVoiceWake();

    // Launch native macOS tray helper (non-blocking)
    if (process.env.MENUBAR_TRAY !== "false") {
        launchTray();
    }
}

export function stopMenuBar(): void {
    stopVoiceWake();
}

async function launchTray(): Promise<void> {
    if (trayStarted) return;
    trayStarted = true;

    const port = process.env.WEBHOOK_PORT || "3100";
    const botName = config.botName;

    // Use osascript to create a macOS notification at startup
    const { spawn } = await import("node:child_process");
    spawn("osascript", [
        "-e",
        `display notification "Dashboard: http://localhost:${port}/dashboard" with title "${botName} is running" subtitle "Click to open dashboard"`,
    ]);
}
