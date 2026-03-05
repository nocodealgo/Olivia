import { createServer, type IncomingMessage as HttpReq, type ServerResponse } from "node:http";
import { config } from "../config.js";
import { registerAdapter, routeMessage } from "../router/message-bus.js";
import type { ChannelAdapter } from "../router/types.js";
import { handleDeviceMessage, getConnectedDevices, devicePendingReplies, type DeviceMessage } from "../devices/esp32-handler.js";
import { handleDashboardRoute, resolveChatReply } from "../menubar/dashboard-routes.js";
import { handleMobileRoute } from "../mobile/gateway.js";
import { attachCanvasWs } from "../canvas/ws-server.js";
import { getAuthUrl, handleAuthCallback, isGmailReady } from "../gmail/auth.js";
import { handlePubSubNotification } from "../gmail/pubsub.js";
import { transcribeBuffer } from "../voice/transcribe.js";
import { synthesizeSpeech } from "../voice/synthesize.js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ───────────────────────────────────────────

const PORT = parseInt(process.env.WEBHOOK_PORT || "3100");
const SECRET = process.env.WEBHOOK_SECRET || "";
const BIND = process.env.WEBHOOK_BIND || "127.0.0.1";

// ── Pending responses (for sync webhook replies) ─────

const pendingResponses = new Map<string, ServerResponse>();

// ── Webhook adapter ──────────────────────────────────

const webhookAdapter: ChannelAdapter = {
    async send(chatId, text, replyContext) {
        const reqId = replyContext as string;

        // Check if this is a chat reply (from dashboard quick chat)
        if (resolveChatReply(reqId, text)) return;

        // Check if this is a device reply
        const deviceCb = devicePendingReplies.get(reqId);
        if (deviceCb) {
            deviceCb(text);
            devicePendingReplies.delete(reqId);
            return;
        }

        const res = pendingResponses.get(reqId);
        if (res && !res.writableEnded) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ reply: text }));
            pendingResponses.delete(reqId);
        }
    },
    async sendTyping() {
        // No typing indicator for webhooks
    },
};

registerAdapter("webhook", webhookAdapter);

// ── Webhook payload types ────────────────────────────

interface WebhookPayload {
    /** Message text to send to the agent */
    text: string;
    /** Sender name (optional, default: "webhook") */
    sender?: string;
    /** Source identifier for routing (optional, default: "webhook") */
    source?: string;
    /** Custom webhook type/event (optional) */
    event?: string;
}

// ── HTTP server ──────────────────────────────────────

let server: ReturnType<typeof createServer> | null = null;

// ── Auth helper ──────────────────────────────────────

function requireAuth(req: HttpReq, res: ServerResponse): boolean {
    if (!SECRET) return true; // No secret configured — skip auth
    const auth = req.headers.authorization;
    const token = req.headers.cookie?.match(/giorgio_token=([^;]+)/)?.[1];
    if (auth === `Bearer ${SECRET}` || token === SECRET) return true;
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return false;
}

export function startWebhookServer(): void {
    const ALLOWED_ORIGINS = [
        `http://localhost:${PORT}`,
        `http://127.0.0.1:${PORT}`,
        `http://${BIND}:${PORT}`,
    ];

    server = createServer(async (req, res) => {
        // CORS headers — restricted to known origins
        const origin = req.headers.origin || "";
        if (ALLOWED_ORIGINS.includes(origin)) {
            res.setHeader("Access-Control-Allow-Origin", origin);
            res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
            res.setHeader("Access-Control-Allow-Credentials", "true");
        }

        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }

        const url = new URL(req.url || "/", `http://localhost:${PORT}`);

        // Health check (no auth — read-only)
        if (url.pathname === "/health" && req.method === "GET") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
            return;
        }

        // Webhook endpoint
        if (url.pathname === "/webhook" && req.method === "POST") {
            await handleWebhook(req, res);
            return;
        }

        // Generic webhook with source in path: /webhook/:source
        if (url.pathname.startsWith("/webhook/") && req.method === "POST") {
            const source = url.pathname.slice("/webhook/".length);
            await handleWebhook(req, res, source);
            return;
        }

        // Device API endpoint (for ESP32, IoT devices)
        if (url.pathname === "/api/message" && req.method === "POST") {
            await handleDeviceApi(req, res);
            return;
        }

        // Connected devices list
        if (url.pathname === "/api/devices" && req.method === "GET") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ devices: getConnectedDevices() }));
            return;
        }

        // Talk Mode API — audio in/out (auth required)
        if (url.pathname === "/api/talk" && req.method === "POST") {
            if (!requireAuth(req, res)) return;
            try {
                const chunks: Buffer[] = [];
                for await (const chunk of req) chunks.push(Buffer.from(chunk));
                const audioBuffer = Buffer.concat(chunks);

                // 1. Transcribe
                const text = await transcribeBuffer(audioBuffer);
                if (!text) {
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Transcription failed" }));
                    return;
                }

                // 2. Get LLM response via message bus
                const reply = await new Promise<string>((resolve) => {
                    const reqId = `talk-${Date.now()}`;
                    const timeout = setTimeout(() => resolve("Sorry, I couldn't process that."), 30000);

                    // Temporarily register a one-shot webhook reply handler
                    pendingResponses.set(reqId, {
                        writeHead() { },
                        writableEnded: false,
                        end(data: string) {
                            clearTimeout(timeout);
                            try {
                                const parsed = JSON.parse(data);
                                resolve(parsed.reply || text);
                            } catch { resolve(data); }
                        },
                    } as any);

                    routeMessage({
                        channel: "webhook",
                        chatId: 0,
                        senderName: "Talk Mode",
                        text,
                        replyContext: reqId,
                    });
                });

                // 3. Synthesize voice
                const voiceBuffer = await synthesizeSpeech(reply.slice(0, 2000));
                if (voiceBuffer) {
                    res.writeHead(200, {
                        "Content-Type": "audio/ogg",
                        "X-Transcription": encodeURIComponent(text),
                        "X-Reply-Text": encodeURIComponent(reply.slice(0, 500)),
                    });
                    res.end(voiceBuffer);
                } else {
                    // Fallback to text
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ transcription: text, reply }));
                }
            } catch (err) {
                console.error("  ❌ Talk API error:", err);
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Talk mode error" }));
            }
            return;
        }

        // Dashboard & menu bar routes (auth required)
        if (url.pathname.startsWith("/dashboard") || url.pathname.startsWith("/overlay")) {
            if (!requireAuth(req, res)) return;
            if (await handleDashboardRoute(req, res, url.pathname)) return;
        }

        // Mobile companion gateway (auth required)
        if (url.pathname.startsWith("/api/mobile")) {
            if (!requireAuth(req, res)) return;
            if (await handleMobileRoute(req, res, url.pathname)) return;
        }

        // Canvas page (auth required)
        if (url.pathname === "/canvas" && req.method === "GET") {
            if (!requireAuth(req, res)) return;
            const html = readFileSync(resolve(__dirname, "..", "canvas", "ui", "canvas.html"), "utf-8")
                .replace(/\{\{BOT_NAME\}\}/g, config.botName);
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(html);
            return;
        }

        // Gmail OAuth callback
        if (url.pathname === "/gmail/callback" && req.method === "GET") {
            const code = url.searchParams.get("code");
            if (code) {
                const ok = await handleAuthCallback(code);
                res.writeHead(200, { "Content-Type": "text/html" });
                res.end(ok
                    ? `<h1>✅ Gmail connected!</h1><p>You can close this tab. ${config.botName} can now read and send email.</p>`
                    : `<h1>❌ Auth failed</h1><p>Check console for details.</p>`);
            } else {
                res.writeHead(400, { "Content-Type": "text/plain" });
                res.end("Missing code parameter");
            }
            return;
        }

        // Gmail auth start
        if (url.pathname === "/gmail/auth" && req.method === "GET") {
            const authUrl = getAuthUrl();
            if (authUrl) {
                res.writeHead(302, { Location: authUrl });
                res.end();
            } else {
                res.writeHead(500, { "Content-Type": "text/plain" });
                res.end("Gmail not configured. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in .env");
            }
            return;
        }

        // Gmail Pub/Sub push notifications
        if (url.pathname === "/gmail/pubsub" && req.method === "POST") {
            const body = await readBody(req);
            try {
                const msg = JSON.parse(body);
                await handlePubSubNotification(msg);
                res.writeHead(200);
                res.end("ok");
            } catch {
                res.writeHead(400);
                res.end("Invalid payload");
            }
            return;
        }

        // 404
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found. Use POST /webhook or /api/message" }));
    });

    let retries = 0;
    const MAX_RETRIES = 3;

    server.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
            retries++;
            if (retries <= MAX_RETRIES) {
                console.log(`  ⚠️  Webhook port ${PORT} in use — retry ${retries}/${MAX_RETRIES} in 3s…`);
                setTimeout(() => {
                    server?.close();
                    server?.listen(PORT);
                }, 3000);
            } else {
                console.log(`  ⚠️  Webhook port ${PORT} still in use after ${MAX_RETRIES} retries — webhook disabled. ${config.botName} works fine without it.`);
            }
        } else {
            console.error("  ❌ Webhook server error:", err.message);
        }
    });

    server.listen(PORT, BIND, () => {
        console.log(`  🌐 Webhook server listening on http://${BIND}:${PORT}`);
        console.log(`     POST /webhook     — send messages to ${config.botName}`);
        console.log(`     POST /api/message — device API (ESP32, IoT)`);
        console.log(`     GET  /api/devices — connected devices`);
        console.log(`     GET  /canvas      — Live Canvas (A2UI)`);
        console.log(`     GET  /health      — health check`);
    });

    // Attach Canvas WebSocket to the HTTP server
    attachCanvasWs(server);
}

export function stopWebhookServer(): void {
    if (server) {
        server.close();
        server = null;
    }
}

// ── Request handler ──────────────────────────────────

async function handleWebhook(req: HttpReq, res: ServerResponse, pathSource?: string): Promise<void> {
    // Auth check
    if (SECRET) {
        const auth = req.headers.authorization;
        if (!auth || auth !== `Bearer ${SECRET}`) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Unauthorized. Provide Authorization: Bearer <secret>" }));
            return;
        }
    }

    // Parse body
    let body: string;
    try {
        body = await readBody(req);
    } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Could not read request body" }));
        return;
    }

    // Parse JSON
    let payload: WebhookPayload;
    try {
        payload = JSON.parse(body);
    } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
    }

    // Validate
    const text = payload.text?.trim();
    if (!text) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing 'text' field" }));
        return;
    }

    const source = pathSource || payload.source || "webhook";
    const sender = payload.sender || source;
    const reqId = `wh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Build the full text (include event context if provided)
    const fullText = payload.event
        ? `[Webhook: ${source} — event: ${payload.event}] ${text}`
        : `[Webhook: ${source}] ${text}`;

    console.log(`  🌐 [webhook/${source}] ${sender}: ${text.slice(0, 100)}`);

    // Store response for async reply
    pendingResponses.set(reqId, res);

    // Set timeout — if agent takes too long, send 202 accepted
    const timeout = setTimeout(() => {
        if (pendingResponses.has(reqId) && !res.writableEnded) {
            res.writeHead(202, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "accepted", message: "Processing — reply will be sent via configured channel." }));
            pendingResponses.delete(reqId);
        }
    }, 25000);

    try {
        // Route through the message bus
        await routeMessage({
            channel: "webhook",
            chatId: config.ownerChatId,
            senderName: sender,
            text: fullText,
            replyContext: reqId,
        });
    } catch (err) {
        clearTimeout(timeout);
        if (pendingResponses.has(reqId) && !res.writableEnded) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Internal error processing webhook" }));
            pendingResponses.delete(reqId);
        }
    } finally {
        clearTimeout(timeout);
    }
}

// ── Device API handler ──────────────────────────────

async function handleDeviceApi(req: HttpReq, res: ServerResponse): Promise<void> {
    // Auth check (same as webhook)
    if (SECRET) {
        const auth = req.headers.authorization;
        if (auth && auth !== `Bearer ${SECRET}`) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Unauthorized" }));
            return;
        }
    }

    let body: string;
    try {
        body = await readBody(req);
    } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Could not read request body" }));
        return;
    }

    let msg: DeviceMessage;
    try {
        msg = JSON.parse(body);
    } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
    }

    if (!msg.text?.trim()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing 'text' field" }));
        return;
    }

    const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0] || req.socket.remoteAddress;

    try {
        const result = await handleDeviceMessage(msg, clientIp);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
    } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal error" }));
    }
}

// ── Helpers ──────────────────────────────────────────

function readBody(req: HttpReq): Promise<string> {
    return new Promise((resolve, reject) => {
        let data = "";
        req.on("data", (chunk) => { data += chunk; });
        req.on("end", () => resolve(data));
        req.on("error", reject);

        // 1MB limit
        req.on("data", () => {
            if (data.length > 1024 * 1024) {
                req.destroy();
                reject(new Error("Body too large"));
            }
        });
    });
}
