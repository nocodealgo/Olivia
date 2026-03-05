/**
 * Gmail API Client
 *
 * Read, send, draft, and search emails using the Gmail API.
 */

import { google, type gmail_v1 } from "googleapis";
import { getOAuth2Client, isGmailReady } from "./auth.js";

// ── Gmail service getter ─────────────────────────────

function getGmail(): gmail_v1.Gmail | null {
    const auth = getOAuth2Client();
    if (!auth || !isGmailReady()) return null;
    return google.gmail({ version: "v1", auth });
}

// ── Types ────────────────────────────────────────────

export interface EmailSummary {
    id: string;
    threadId: string;
    from: string;
    to: string;
    subject: string;
    snippet: string;
    date: string;
    labels: string[];
    unread: boolean;
}

export interface EmailFull extends EmailSummary {
    body: string;
    attachments: Array<{ filename: string; mimeType: string; size: number }>;
}

export interface ComposeOptions {
    to: string;
    subject: string;
    body: string;
    cc?: string;
    bcc?: string;
    inReplyTo?: string;
    threadId?: string;
}

// ── Helpers ──────────────────────────────────────────

function decodeBase64Url(data: string): string {
    return Buffer.from(data, "base64url").toString("utf-8");
}

function encodeMessage(opts: ComposeOptions): string {
    const headers = [
        `To: ${opts.to}`,
        `Subject: ${opts.subject}`,
        `Content-Type: text/plain; charset=utf-8`,
    ];
    if (opts.cc) headers.push(`Cc: ${opts.cc}`);
    if (opts.bcc) headers.push(`Bcc: ${opts.bcc}`);
    if (opts.inReplyTo) {
        headers.push(`In-Reply-To: ${opts.inReplyTo}`);
        headers.push(`References: ${opts.inReplyTo}`);
    }

    const raw = `${headers.join("\r\n")}\r\n\r\n${opts.body}`;
    return Buffer.from(raw).toString("base64url");
}

function extractHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
    return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
}

function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
    if (!payload) return "";

    // Direct body
    if (payload.body?.data) {
        return decodeBase64Url(payload.body.data);
    }

    // Multipart — prefer text/plain
    if (payload.parts) {
        const textPart = payload.parts.find((p) => p.mimeType === "text/plain");
        if (textPart?.body?.data) return decodeBase64Url(textPart.body.data);

        const htmlPart = payload.parts.find((p) => p.mimeType === "text/html");
        if (htmlPart?.body?.data) {
            const html = decodeBase64Url(htmlPart.body.data);
            // Strip HTML tags for plain text
            return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
        }

        // Recurse into nested parts
        for (const part of payload.parts) {
            const text = extractBody(part);
            if (text) return text;
        }
    }

    return "";
}

function extractAttachments(payload: gmail_v1.Schema$MessagePart | undefined): EmailFull["attachments"] {
    const attachments: EmailFull["attachments"] = [];
    if (!payload?.parts) return attachments;

    for (const part of payload.parts) {
        if (part.filename && part.body?.attachmentId) {
            attachments.push({
                filename: part.filename,
                mimeType: part.mimeType || "application/octet-stream",
                size: part.body.size || 0,
            });
        }
    }
    return attachments;
}

function parseMessage(msg: gmail_v1.Schema$Message, full = false): EmailSummary | EmailFull {
    const headers = msg.payload?.headers;
    const base: EmailSummary = {
        id: msg.id || "",
        threadId: msg.threadId || "",
        from: extractHeader(headers, "From"),
        to: extractHeader(headers, "To"),
        subject: extractHeader(headers, "Subject"),
        snippet: msg.snippet || "",
        date: extractHeader(headers, "Date"),
        labels: msg.labelIds || [],
        unread: msg.labelIds?.includes("UNREAD") || false,
    };

    if (full) {
        return {
            ...base,
            body: extractBody(msg.payload),
            attachments: extractAttachments(msg.payload),
        } as EmailFull;
    }
    return base;
}

// ── Public API ───────────────────────────────────────

/**
 * List recent emails.
 */
export async function listEmails(opts: {
    maxResults?: number;
    query?: string;
    labelIds?: string[];
} = {}): Promise<EmailSummary[]> {
    const gmail = getGmail();
    if (!gmail) throw new Error("Gmail not authenticated. Run /gmail auth first.");

    const res = await gmail.users.messages.list({
        userId: "me",
        maxResults: opts.maxResults || 10,
        q: opts.query,
        labelIds: opts.labelIds,
    });

    if (!res.data.messages) return [];

    const summaries: EmailSummary[] = [];
    for (const m of res.data.messages) {
        const full = await gmail.users.messages.get({
            userId: "me",
            id: m.id!,
            format: "metadata",
            metadataHeaders: ["From", "To", "Subject", "Date"],
        });
        summaries.push(parseMessage(full.data) as EmailSummary);
    }
    return summaries;
}

/**
 * Read a specific email by ID.
 */
export async function readEmail(messageId: string): Promise<EmailFull> {
    const gmail = getGmail();
    if (!gmail) throw new Error("Gmail not authenticated.");

    const res = await gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "full",
    });

    return parseMessage(res.data, true) as EmailFull;
}

/**
 * Send an email.
 */
export async function sendEmail(opts: ComposeOptions): Promise<string> {
    const gmail = getGmail();
    if (!gmail) throw new Error("Gmail not authenticated.");

    const res = await gmail.users.messages.send({
        userId: "me",
        requestBody: {
            raw: encodeMessage(opts),
            threadId: opts.threadId,
        },
    });

    return res.data.id || "sent";
}

/**
 * Create a draft.
 */
export async function createDraft(opts: ComposeOptions): Promise<string> {
    const gmail = getGmail();
    if (!gmail) throw new Error("Gmail not authenticated.");

    const res = await gmail.users.drafts.create({
        userId: "me",
        requestBody: {
            message: {
                raw: encodeMessage(opts),
                threadId: opts.threadId,
            },
        },
    });

    return res.data.id || "drafted";
}

/**
 * Mark a message as read.
 */
export async function markAsRead(messageId: string): Promise<void> {
    const gmail = getGmail();
    if (!gmail) throw new Error("Gmail not authenticated.");

    await gmail.users.messages.modify({
        userId: "me",
        id: messageId,
        requestBody: { removeLabelIds: ["UNREAD"] },
    });
}

/**
 * Trash a message.
 */
export async function trashEmail(messageId: string): Promise<void> {
    const gmail = getGmail();
    if (!gmail) throw new Error("Gmail not authenticated.");

    await gmail.users.messages.trash({ userId: "me", id: messageId });
}

/**
 * Get unread count.
 */
export async function getUnreadCount(): Promise<number> {
    const gmail = getGmail();
    if (!gmail) throw new Error("Gmail not authenticated.");

    const res = await gmail.users.labels.get({
        userId: "me",
        id: "INBOX",
    });

    return res.data.messagesUnread || 0;
}

/**
 * Watch for new emails via Pub/Sub (required for real-time notifications).
 */
export async function watchInbox(topicName: string): Promise<{ historyId: string; expiration: string }> {
    const gmail = getGmail();
    if (!gmail) throw new Error("Gmail not authenticated.");

    const res = await gmail.users.watch({
        userId: "me",
        requestBody: {
            topicName,
            labelIds: ["INBOX"],
            labelFilterBehavior: "INCLUDE",
        },
    });

    return {
        historyId: res.data.historyId || "",
        expiration: res.data.expiration || "",
    };
}
