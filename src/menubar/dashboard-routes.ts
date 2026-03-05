/**
 * Menu Bar Dashboard Routes
 *
 * Adds HTTP endpoints to the webhook server for the menu bar app:
 *   GET  /dashboard        — serves the dashboard UI
 *   GET  /api/status       — bot status (uptime, connections, memory)
 *   POST /api/chat         — quick chat (send message, get reply)
 *   GET  /api/voice/status — voice wake status
 *   POST /api/voice/toggle — toggle voice wake on/off
 */

import { type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { routeMessage } from "../router/message-bus.js";
import { getVoiceWakeStatus, toggleVoiceWake } from "./voice-wake.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Dashboard HTML cache ─────────────────────────────

let dashboardHtml: string | null = null;
let overlayHtml: string | null = null;

function getDashboardHtml(): string {
    if (!dashboardHtml) {
        dashboardHtml = readFileSync(resolve(__dirname, "ui", "dashboard.html"), "utf-8")
            .replace(/\{\{BOT_NAME\}\}/g, config.botName);
    }
    return dashboardHtml;
}

function getOverlayHtml(): string {
    if (!overlayHtml) {
        overlayHtml = readFileSync(resolve(__dirname, "ui", "overlay.html"), "utf-8")
            .replace(/\{\{BOT_NAME\}\}/g, config.botName);
    }
    return overlayHtml;
}

// ── Status endpoint ──────────────────────────────────

function getStatus() {
    const mem = process.memoryUsage();
    return {
        botName: config.botName,
        uptime: Math.round(process.uptime()),
        memory: {
            heapMB: Math.round(mem.heapUsed / 1024 / 1024),
            rssMB: Math.round(mem.rss / 1024 / 1024),
        },
        channels: {
            telegram: true,
            whatsapp: config.whatsappEnabled,
        },
        voiceWake: getVoiceWakeStatus(),
        timezone: config.timezone,
    };
}

// ── Quick Chat ───────────────────────────────────────

const chatPendingReplies = new Map<string, (reply: string) => void>();

async function handleQuickChat(text: string): Promise<string> {
    return new Promise<string>((resolve) => {
        let resolved = false;
        const reqId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        chatPendingReplies.set(reqId, (reply: string) => {
            if (!resolved) {
                resolved = true;
                resolve(reply);
            }
        });

        // Timeout
        setTimeout(() => {
            if (!resolved) {
                resolved = true;
                chatPendingReplies.delete(reqId);
                resolve("⏳ Response took too long. Check Telegram for the reply.");
            }
        }, 30000);

        routeMessage({
            channel: "webhook",
            chatId: config.ownerChatId,
            senderName: "menubar",
            text,
            replyContext: reqId,
        }).catch(() => {
            if (!resolved) {
                resolved = true;
                chatPendingReplies.delete(reqId);
                resolve("❌ Error processing message.");
            }
        });
    });
}

/** Called by the webhook adapter when a reply is ready */
export function resolveChatReply(reqId: string, reply: string): boolean {
    const cb = chatPendingReplies.get(reqId);
    if (cb) {
        cb(reply);
        chatPendingReplies.delete(reqId);
        return true;
    }
    return false;
}

// ── Route handler ────────────────────────────────────

export async function handleDashboardRoute(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
): Promise<boolean> {
    // Dashboard UI
    if (pathname === "/dashboard" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(getDashboardHtml());
        return true;
    }

    // Talk mode overlay
    if (pathname === "/overlay" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(getOverlayHtml());
        return true;
    }

    // Status API
    if (pathname === "/api/status" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(getStatus()));
        return true;
    }

    // Quick chat API
    if (pathname === "/api/chat" && req.method === "POST") {
        const body = await readBody(req);
        const { text } = JSON.parse(body);
        if (!text?.trim()) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing 'text'" }));
            return true;
        }
        const reply = await handleQuickChat(text.trim());
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ reply }));
        return true;
    }

    // Voice wake status
    if (pathname === "/api/voice/status" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(getVoiceWakeStatus()));
        return true;
    }

    // Voice wake toggle
    if (pathname === "/api/voice/toggle" && req.method === "POST") {
        const status = toggleVoiceWake();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(status));
        return true;
    }

    return false;
}

// ── Helpers ──────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let data = "";
        req.on("data", (chunk) => { data += chunk; });
        req.on("end", () => resolve(data));
        req.on("error", reject);
    });
}
