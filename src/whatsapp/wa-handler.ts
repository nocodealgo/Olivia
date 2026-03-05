import type makeWASocket from "@whiskeysockets/baileys";
import { downloadMediaMessage, getContentType } from "@whiskeysockets/baileys";
import { config } from "../config.js";
import { registerAdapter, routeMessage } from "../router/message-bus.js";
import type { ChannelAdapter } from "../router/types.js";

// ── Types ────────────────────────────────────────────

type WASocket = ReturnType<typeof makeWASocket>;

// ── WhatsApp adapter ─────────────────────────────────

let activeSock: WASocket | null = null;

const whatsappAdapter: ChannelAdapter = {
    async send(_chatId, text, replyContext) {
        const { jid, msg } = replyContext as { jid: string; msg: any };
        if (!activeSock) return;
        await activeSock.sendMessage(jid, { text }, { quoted: msg });
    },

    async sendTyping(_chatId, replyContext) {
        const { jid } = replyContext as { jid: string };
        if (!activeSock) return;
        await activeSock.presenceSubscribe(jid);
        await activeSock.sendPresenceUpdate("composing", jid);
    },
};

registerAdapter("whatsapp", whatsappAdapter);

// ── Handler registration ─────────────────────────────

export function registerWaHandlers(sock: WASocket): void {
    activeSock = sock;

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify") return;

        for (const msg of messages) {
            try {
                await processMessage(sock, msg);
            } catch (err) {
                console.error("  ❌ [whatsapp] Message error:", err instanceof Error ? err.message : err);
            }
        }
    });
}

// ── Message processing ───────────────────────────────

async function processMessage(sock: WASocket, msg: any): Promise<void> {
    // Skip if no message content or key
    if (!msg.message || !msg.key) return;
    if (msg.key.remoteJid === "status@broadcast") return;

    const jid: string = msg.key.remoteJid;
    if (!jid) return;

    // ── Permission gate (controlled by WA_MODE in .env) ──
    const isGroup = jid.endsWith("@g.us");
    const isNewsletter = jid.endsWith("@newsletter");

    // Always block newsletters
    if (isNewsletter) return;

    // ── Group handling ──
    if (isGroup) {
        if (!config.waAllowGroups) return;
        if (config.allowedWaGroups.size > 0 && !config.allowedWaGroups.has(jid)) return;
        // Groups: allow messages from anyone (not just fromMe)
    } else {
        // Private chats: ONLY respond to self-messages (messages you send)
        if (!msg.key.fromMe) return;

        // JID format: "524422089949@s.whatsapp.net" → extract "524422089949"
        const chatNumber = jid.split("@")[0];

        switch (config.waMode) {
            case "self_only":
            case "allowlist":
                if (!config.allowedWaNumbers.has(chatNumber)) {
                    console.log(`  🚫 [whatsapp] Blocked chat with ${chatNumber} (not in allowlist)`);
                    return;
                }
                break;
            case "everyone":
                break;
        }
    }

    // ── Extract text content ──
    const contentType = getContentType(msg.message);
    let text = "";
    const senderName: string = msg.pushName || (msg.key.fromMe ? "Me" : "Unknown");

    switch (contentType) {
        case "conversation":
            text = msg.message.conversation || "";
            break;

        case "extendedTextMessage":
            text = msg.message.extendedTextMessage?.text || "";
            break;

        case "imageMessage": {
            try {
                const { processImage } = await import("../memory/multimodal.js");
                const buffer = await downloadMediaMessage(msg, "buffer", {}) as Buffer;
                const caption = msg.message.imageMessage?.caption || undefined;
                const desc = await processImage(buffer, jidToChatId(jid), "wa-image", caption);
                text = caption ? `[Sent image: "${caption}"] ${desc}` : `[Sent image] ${desc}`;
            } catch (e) {
                text = msg.message.imageMessage?.caption || "[image received]";
                console.error("  ⚠️  [whatsapp] Image process error:", e);
            }
            break;
        }

        case "videoMessage": {
            try {
                const { processVideo } = await import("../memory/multimodal.js");
                const buffer = await downloadMediaMessage(msg, "buffer", {}) as Buffer;
                const caption = msg.message.videoMessage?.caption || undefined;
                const desc = await processVideo(buffer, jidToChatId(jid), "wa-video", caption);
                text = caption ? `[Sent video: "${caption}"] ${desc}` : `[Sent video] ${desc}`;
            } catch (e) {
                text = msg.message.videoMessage?.caption || "[video received]";
                console.error("  ⚠️  [whatsapp] Video process error:", e);
            }
            break;
        }

        case "documentMessage": {
            try {
                const { processDocument } = await import("../memory/multimodal.js");
                const buffer = await downloadMediaMessage(msg, "buffer", {}) as Buffer;
                const filename = msg.message.documentMessage?.fileName || "document";
                const mime = msg.message.documentMessage?.mimetype || undefined;
                const desc = await processDocument(buffer, jidToChatId(jid), filename, mime);
                text = `[Sent document: ${filename}] ${desc}`;
            } catch (e) {
                text = "[document received]";
                console.error("  ⚠️  [whatsapp] Document process error:", e);
            }
            break;
        }

        case "audioMessage": {
            try {
                const buffer = await downloadMediaMessage(msg, "buffer", {}) as Buffer;
                const transcription = await transcribeVoiceBuffer(buffer);
                text = transcription || "[voice message — could not transcribe]";
            } catch (e) {
                text = "[voice message received]";
                console.error("  ⚠️  [whatsapp] Voice transcribe error:", e);
            }
            break;
        }

        default:
            text = `[${contentType || "unknown"} message received]`;
            break;
    }

    if (!text.trim()) return;

    // ── Group mention gate — only respond when explicitly mentioned ──
    if (isGroup && !msg.key.fromMe) {
        const { isBotMentioned, stripMention } = await import("../groups/group-manager.js");
        if (!isBotMentioned(text)) {
            // Read but don't respond — silently skip
            return;
        }
        // Strip mention for clean LLM input
        text = stripMention(text);
    }

    // ── Route through the message bus ──
    await routeMessage({
        channel: "whatsapp",
        chatId: jidToChatId(jid),
        senderName,
        text,
        replyContext: { jid, msg },
    });
}

// ── Helpers ──────────────────────────────────────────

function jidToChatId(jid: string): number {
    let hash = 0;
    for (let i = 0; i < jid.length; i++) {
        const chr = jid.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0;
    }
    return Math.abs(hash) + 2_000_000_000;
}

async function transcribeVoiceBuffer(buffer: Buffer): Promise<string | null> {
    if (!config.groqApiKey) return null;

    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({
        apiKey: config.groqApiKey,
        baseURL: "https://api.groq.com/openai/v1",
    });

    const blob = new Blob([new Uint8Array(buffer)], { type: "audio/ogg" });
    const file = new File([blob], "voice.ogg", { type: "audio/ogg" });

    const transcription = await client.audio.transcriptions.create({
        model: "whisper-large-v3-turbo",
        file,
        response_format: "text",
    });

    return (transcription as unknown as string).trim();
}
