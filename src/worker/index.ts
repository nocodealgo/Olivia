/**
 * Giorgio — Cloudflare Worker Entry Point
 *
 * Handles:
 * - Telegram webhook (POST /webhook/telegram)
 * - HTTP API (POST /api/message)
 * - Health check (GET /health)
 * - Cron triggers (scheduled tasks)
 */

export interface Env {
    // D1 Database
    DB: D1Database;
    // KV Namespace
    KV: KVNamespace;
    // Durable Objects
    AGENT: DurableObjectNamespace;
    // Secrets (set via wrangler secret put)
    ANTHROPIC_API_KEY: string;
    OPENROUTER_API_KEY: string;
    TELEGRAM_BOT_TOKEN: string;
    WEBHOOK_SECRET: string;
    // Config vars
    ENVIRONMENT: string;
    MAX_TOOL_ITERATIONS: string;
    TIMEZONE: string;
    BOT_NAME: string;
}

// ── Worker fetch handler ─────────────────────────────

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);

        // Health check
        if (url.pathname === "/health" && request.method === "GET") {
            return Response.json({ status: "ok", runtime: "cloudflare-workers" });
        }

        // Telegram webhook
        if (url.pathname === "/webhook/telegram" && request.method === "POST") {
            return handleTelegramWebhook(request, env, ctx);
        }

        // HTTP API
        if (url.pathname === "/api/message" && request.method === "POST") {
            return handleApiMessage(request, env, ctx);
        }

        // Session history
        if (url.pathname === "/api/sessions" && request.method === "GET") {
            return handleSessionList(env);
        }

        return Response.json({ error: "Not found" }, { status: 404 });
    },

    // Cron trigger handler
    async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
        ctx.waitUntil(handleScheduledTask(env));
    },
};

// ── Telegram Webhook ─────────────────────────────────

async function handleTelegramWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
        const update = await request.json() as any;
        const message = update.message;

        if (!message?.text || !message?.chat?.id) {
            return Response.json({ ok: true });
        }

        const chatId = message.chat.id;
        const text = message.text;

        // Process via Durable Object (maintains agent state per chat)
        const agentId = env.AGENT.idFromName(`chat-${chatId}`);
        const agent = env.AGENT.get(agentId);

        ctx.waitUntil(
            agent.fetch("http://internal/process", {
                method: "POST",
                body: JSON.stringify({ chatId, text, channel: "telegram" }),
            })
        );

        return Response.json({ ok: true });
    } catch (err) {
        console.error("Telegram webhook error:", err);
        return Response.json({ error: "Internal error" }, { status: 500 });
    }
}

// ── HTTP API ─────────────────────────────────────────

async function handleApiMessage(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Optional auth
    if (env.WEBHOOK_SECRET) {
        const auth = request.headers.get("Authorization");
        if (auth !== `Bearer ${env.WEBHOOK_SECRET}`) {
            return Response.json({ error: "Unauthorized" }, { status: 401 });
        }
    }

    const body = await request.json() as { chatId?: number; text?: string };

    if (!body.text) {
        return Response.json({ error: "Missing 'text' field" }, { status: 400 });
    }

    const chatId = body.chatId || 0;
    const agentId = env.AGENT.idFromName(`chat-${chatId}`);
    const agent = env.AGENT.get(agentId);

    const response = await agent.fetch("http://internal/process", {
        method: "POST",
        body: JSON.stringify({ chatId, text: body.text, channel: "api" }),
    });

    const result = await response.json();
    return Response.json(result);
}

// ── Session List ─────────────────────────────────────

async function handleSessionList(env: Env): Promise<Response> {
    const sessions = await env.KV.list({ prefix: "session:" });
    return Response.json({
        sessions: sessions.keys.map((k) => ({ name: k.name.replace("session:", "") })),
    });
}

// ── Scheduled Tasks ──────────────────────────────────

async function handleScheduledTask(env: Env): Promise<void> {
    console.log("Scheduled task triggered");
    // Morning briefing or other cron tasks
    // Use the agent DO to process
}

// ── Durable Object: Agent State ──────────────────────

export class AgentDurableObject {
    private state: DurableObjectState;
    private env: Env;
    private session: Array<{ role: string; content: any }> = [];

    constructor(state: DurableObjectState, env: Env) {
        this.state = state;
        this.env = env;
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);

        if (url.pathname === "/process" && request.method === "POST") {
            return this.processMessage(request);
        }

        if (url.pathname === "/history") {
            return Response.json({ session: this.session.slice(-20) });
        }

        return Response.json({ error: "Not found" }, { status: 404 });
    }

    private async processMessage(request: Request): Promise<Response> {
        const { chatId, text, channel } = await request.json() as {
            chatId: number;
            text: string;
            channel: string;
        };

        // Restore session from storage
        const stored = await this.state.storage.get<typeof this.session>("session");
        if (stored) this.session = stored;

        // Save user message to D1
        await this.saveToD1(chatId, "user", text);

        // Add to session
        this.session.push({ role: "user", content: text });

        // Keep session bounded
        if (this.session.length > 40) {
            this.session = this.session.slice(-30);
        }

        // Call LLM
        const reply = await this.callLLM(text);

        // Save assistant reply
        this.session.push({ role: "assistant", content: reply });
        await this.state.storage.put("session", this.session);
        await this.saveToD1(chatId, "assistant", reply);

        // Send reply via channel
        if (channel === "telegram") {
            await this.sendTelegram(chatId, reply);
        }

        // Save to KV for quick access
        await this.env.KV.put(
            `last-reply:${chatId}`,
            JSON.stringify({ reply, timestamp: Date.now() }),
            { expirationTtl: 86400 }
        );

        return Response.json({ reply, chatId });
    }

    private async callLLM(userText: string): Promise<string> {
        const botName = this.env.BOT_NAME || "Giorgio";
        const systemPrompt = `You are ${botName}, a personal AI assistant. Be helpful, concise, and friendly.`;

        try {
            // Use Anthropic API (or OpenRouter as fallback)
            const apiKey = this.env.ANTHROPIC_API_KEY || this.env.OPENROUTER_API_KEY;
            const baseUrl = this.env.ANTHROPIC_API_KEY
                ? "https://api.anthropic.com/v1/messages"
                : "https://openrouter.ai/api/v1/chat/completions";

            if (this.env.ANTHROPIC_API_KEY) {
                return this.callAnthropic(systemPrompt, userText, apiKey);
            } else {
                return this.callOpenRouter(systemPrompt, userText, apiKey);
            }
        } catch (err) {
            console.error("LLM error:", err);
            return "Sorry, I encountered an error processing your message.";
        }
    }

    private async callAnthropic(system: string, userText: string, apiKey: string): Promise<string> {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
                model: "claude-sonnet-4-20250514",
                max_tokens: 4096,
                system,
                messages: this.session.slice(-20),
            }),
        });

        const data = await res.json() as any;
        return data.content?.[0]?.text || "(no response)";
    }

    private async callOpenRouter(system: string, userText: string, apiKey: string): Promise<string> {
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: "anthropic/claude-sonnet-4-20250514",
                messages: [
                    { role: "system", content: system },
                    ...this.session.slice(-20),
                ],
            }),
        });

        const data = await res.json() as any;
        return data.choices?.[0]?.message?.content || "(no response)";
    }

    private async saveToD1(chatId: number, role: string, content: string): Promise<void> {
        try {
            await this.env.DB.prepare(
                "INSERT INTO conversations (chat_id, role, content, created_at) VALUES (?, ?, ?, ?)"
            ).bind(chatId, role, content, new Date().toISOString()).run();
        } catch {
            // Table might not exist yet — create it
            await this.env.DB.exec(`
                CREATE TABLE IF NOT EXISTS conversations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    chat_id INTEGER NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_chat ON conversations(chat_id, created_at);
            `);
            await this.env.DB.prepare(
                "INSERT INTO conversations (chat_id, role, content, created_at) VALUES (?, ?, ?, ?)"
            ).bind(chatId, role, content, new Date().toISOString()).run();
        }
    }

    private async sendTelegram(chatId: number, text: string): Promise<void> {
        if (!this.env.TELEGRAM_BOT_TOKEN) return;

        await fetch(`https://api.telegram.org/bot${this.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId,
                text,
                parse_mode: "Markdown",
            }),
        });
    }
}
