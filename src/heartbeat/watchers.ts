import { exec } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config.js";

const execAsync = promisify(exec);

// ── Disk space watcher ───────────────────────────────
// Alerts if disk usage exceeds 90%

const DISK_THRESHOLD = parseInt(process.env.DISK_ALERT_THRESHOLD || "90");

export async function watchDiskSpace(): Promise<string | null> {
    try {
        const { stdout } = await execAsync("df -h / | tail -1 | awk '{print $5}'");
        const usage = parseInt(stdout.trim().replace("%", ""));
        if (usage >= DISK_THRESHOLD) {
            return `⚠️ Disk usage is at ${usage}% (threshold: ${DISK_THRESHOLD}%). Consider freeing up space.`;
        }
    } catch {
        // Silently skip
    }
    return null;
}

// ── High memory watcher ──────────────────────────────
// Alerts if memory pressure is high

export async function watchMemory(): Promise<string | null> {
    try {
        const used = process.memoryUsage();
        const heapMB = Math.round(used.heapUsed / 1024 / 1024);
        // Alert if the bot itself is using > 500MB heap
        if (heapMB > 500) {
            return `⚠️ ${config.botName}'s memory usage is high: ${heapMB}MB heap. Consider restarting.`;
        }
    } catch {
        // Silently skip
    }
    return null;
}

// ── Pending tasks watcher ────────────────────────────
// Checks memory for overdue tasks/reminders

export async function watchPendingTasks(): Promise<string | null> {
    // This is handled by the agent via memory_search during briefings
    // Kept as a placeholder for future calendar/task integrations
    return null;
}

// ── Security health watcher ──────────────────────────
// Checks Gmail token, port binding, DB sizes, failed auth attempts

import { stat } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { readFileSync, existsSync } from "node:fs";

const DB_SIZE_ALERT_MB = 100;
const FAILED_AUTH_THRESHOLD = 10; // per 30min window

export async function watchSecurity(): Promise<string | null> {
    const alerts: string[] = [];

    // 1. Gmail token expiry — try auto-refresh instead of just alerting
    try {
        const tokenPath = resolvePath(process.cwd(), ".gmail-token.json");
        if (existsSync(tokenPath)) {
            const token = JSON.parse(readFileSync(tokenPath, "utf-8"));
            if (token.expiry_date) {
                const hoursLeft = (token.expiry_date - Date.now()) / 3_600_000;
                if (hoursLeft < 1) {
                    // Try to refresh the token proactively
                    try {
                        const { getOAuth2Client } = await import("../gmail/auth.js");
                        const client = getOAuth2Client();
                        if (client && token.refresh_token) {
                            const { credentials } = await client.refreshAccessToken();
                            const merged = { ...token, ...credentials };
                            const { writeFileSync: writeSync } = await import("node:fs");
                            writeSync(tokenPath, JSON.stringify(merged, null, 2));
                            // Successfully refreshed — no alert needed
                        } else {
                            const port = process.env.WEBHOOK_PORT || "3100";
                            alerts.push(`🔑 Gmail token expires in ${Math.max(0, Math.round(hoursLeft * 60))}min. Re-authenticate: http://localhost:${port}/gmail/auth`);
                        }
                    } catch {
                        const port = process.env.WEBHOOK_PORT || "3100";
                        alerts.push(`🔑 Gmail token refresh failed. Re-authenticate: http://localhost:${port}/gmail/auth`);
                    }
                }
            }
        }
    } catch { /* skip */ }

    // 2. Port binding — check if webhook is exposed beyond localhost
    try {
        const bind = process.env.WEBHOOK_BIND || "127.0.0.1";
        if (bind === "0.0.0.0" || bind === "::") {
            alerts.push(`🌐 Webhook bound to \`${bind}\` — exposed to network. Consider 127.0.0.1 for local-only.`);
        }
    } catch { /* skip */ }

    // 3. No webhook secret configured
    if (!process.env.WEBHOOK_SECRET) {
        alerts.push("🔓 WEBHOOK_SECRET not set — webhook, dashboard, and mobile API have no auth.");
    }

    // 4. Database file sizes
    try {
        const dbFiles = ["./olivia.db", "./heartbeat.db"];
        for (const dbFile of dbFiles) {
            try {
                const s = await stat(resolvePath(process.cwd(), dbFile));
                const sizeMB = Math.round(s.size / 1_048_576);
                if (sizeMB > DB_SIZE_ALERT_MB) {
                    alerts.push(`💾 \`${dbFile}\` is ${sizeMB}MB (threshold: ${DB_SIZE_ALERT_MB}MB). Consider compacting.`);
                }
            } catch { /* file doesn't exist, that's fine */ }
        }
    } catch { /* skip */ }

    // 5. Failed auth attempts (check audit log for recent BLOCKED entries)
    try {
        const logPath = resolvePath(process.cwd(), "logs", "security-audit.log");
        if (existsSync(logPath)) {
            const content = readFileSync(logPath, "utf-8");
            const lines = content.split("\n").filter(Boolean);
            const cutoff = Date.now() - 30 * 60_000; // last 30 minutes
            let recentBlocks = 0;
            for (let i = lines.length - 1; i >= 0 && i >= lines.length - 200; i--) {
                const match = lines[i].match(/^\[(.+?)\] BLOCKED/);
                if (match) {
                    const ts = new Date(match[1]).getTime();
                    if (ts > cutoff) recentBlocks++;
                    else break; // logs are chronological
                }
            }
            if (recentBlocks >= FAILED_AUTH_THRESHOLD) {
                alerts.push(`🚨 ${recentBlocks} blocked security actions in the last 30 minutes — possible probing.`);
            }
        }
    } catch { /* skip */ }

    if (alerts.length === 0) return null;
    return `🔐 Security Health Check:\n${alerts.join("\n")}`;
}

// ── Security audit reminder ──────────────────────────
// Reminds owner when it's time to run security tests

const AUDIT_MARKER_PATH = resolvePath(process.cwd(), ".last-security-audit");
const AUDIT_INTERVAL_DAYS = 30;
const COMMIT_THRESHOLD = 20;

export async function watchSecurityAuditDue(): Promise<string | null> {
    const alerts: string[] = [];
    const now = Date.now();

    // 1. Check time since last audit
    let daysSinceAudit = Infinity;
    try {
        if (existsSync(AUDIT_MARKER_PATH)) {
            const marker = readFileSync(AUDIT_MARKER_PATH, "utf-8").trim();
            const lastAudit = new Date(marker).getTime();
            daysSinceAudit = Math.floor((now - lastAudit) / 86_400_000);
            if (daysSinceAudit >= AUDIT_INTERVAL_DAYS) {
                alerts.push(`📅 Last security audit was ${daysSinceAudit} days ago (threshold: ${AUDIT_INTERVAL_DAYS}d).`);
            }
        } else {
            alerts.push("📅 No security audit on record — consider running one soon.");
        }
    } catch { /* skip */ }

    // 2. Check git commits since last audit
    try {
        const lastAuditDate = existsSync(AUDIT_MARKER_PATH)
            ? readFileSync(AUDIT_MARKER_PATH, "utf-8").trim()
            : null;

        if (lastAuditDate) {
            const { stdout } = await execAsync(
                `git -C "${process.cwd()}" rev-list --count --since="${lastAuditDate}" HEAD 2>/dev/null`
            );
            const commitCount = parseInt(stdout.trim()) || 0;
            if (commitCount >= COMMIT_THRESHOLD) {
                alerts.push(`📝 ${commitCount} commits since last audit — significant code changes.`);
            }
        }
    } catch { /* no git or error — skip */ }

    // 3. Check npm audit (lightweight — just count)
    try {
        const { stdout } = await execAsync("npm audit --json 2>/dev/null", { timeout: 15000 });
        const audit = JSON.parse(stdout);
        const vulns = audit?.metadata?.vulnerabilities;
        if (vulns) {
            const total = (vulns.high || 0) + (vulns.critical || 0);
            if (total > 0) {
                alerts.push(`📦 npm audit: ${total} high/critical dependency vulnerabilities found.`);
            }
        }
    } catch { /* skip */ }

    if (alerts.length === 0) return null;
    return `🛡️ Security Audit Reminder:\n${alerts.join("\n")}\n\nSuggested actions: hardcoded secret scan, code review, penetration test, \`npm audit fix\`.`;
}

/**
 * Mark that a security audit was completed (call after running tests).
 */
export function markSecurityAuditComplete(): void {
    const { writeFileSync: writeSync } = require("node:fs");
    writeSync(AUDIT_MARKER_PATH, new Date().toISOString(), "utf-8");
}

