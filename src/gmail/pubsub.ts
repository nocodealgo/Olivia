/**
 * Gmail Pub/Sub Notification Handler
 *
 * Handles push notifications from Google Cloud Pub/Sub
 * for real-time email alerts.
 *
 * Setup:
 * 1. Create a GCP project with Gmail API + Pub/Sub enabled
 * 2. Create a Pub/Sub topic: projects/{project}/topics/gmail-notifications
 * 3. Grant gmail-api-push@system.gserviceaccount.com "Pub/Sub Publisher" on the topic
 * 4. Create a push subscription pointing to: https://your-server/gmail/pubsub
 * 5. Set GMAIL_PUBSUB_TOPIC in .env
 */

import { google } from "googleapis";
import { getOAuth2Client, isGmailReady } from "./auth.js";
import { listEmails, readEmail, type EmailSummary } from "./client.js";
import { config } from "../config.js";
import { routeMessage } from "../router/message-bus.js";

// ── State ────────────────────────────────────────────

let lastHistoryId: string | null = null;
let watchExpiration: number = 0;

// ── Pub/Sub notification handler ─────────────────────

interface PubSubMessage {
    message: {
        data: string;    // base64-encoded JSON
        messageId: string;
        publishTime: string;
    };
    subscription: string;
}

interface GmailNotification {
    emailAddress: string;
    historyId: string;
}

/**
 * Handle incoming Pub/Sub push notification.
 * Called from the webhook server on POST /gmail/pubsub.
 */
export async function handlePubSubNotification(body: PubSubMessage): Promise<void> {
    try {
        const decoded = Buffer.from(body.message.data, "base64").toString("utf-8");
        const notification: GmailNotification = JSON.parse(decoded);

        console.log(`  📧 Gmail notification: historyId=${notification.historyId}`);

        if (!isGmailReady()) {
            console.warn("  ⚠️  Gmail: notification received but not authenticated");
            return;
        }

        // Fetch new messages since last check
        const newEmails = await fetchNewEmails(notification.historyId);

        if (newEmails.length === 0) return;

        // Notify the user via their primary channel
        const summary = newEmails.map((e) =>
            `📩 *${e.from}*\n   ${e.subject}\n   _${e.snippet.slice(0, 80)}…_`
        ).join("\n\n");

        const chatId = [...config.allowedUserIds][0];
        if (chatId) {
            await routeMessage({
                channel: "telegram",
                chatId,
                senderName: "Gmail",
                text: `📧 ${newEmails.length} new email(s):\n\n${summary}`,
                replyContext: null,
            });
        }

        lastHistoryId = notification.historyId;
    } catch (err) {
        console.error("  ❌ Gmail Pub/Sub error:", err);
    }
}

/**
 * Fetch new messages since a history ID.
 */
async function fetchNewEmails(sinceHistoryId: string): Promise<EmailSummary[]> {
    const auth = getOAuth2Client();
    if (!auth) return [];

    const gmail = google.gmail({ version: "v1", auth });

    try {
        const res = await gmail.users.history.list({
            userId: "me",
            startHistoryId: lastHistoryId || sinceHistoryId,
            historyTypes: ["messageAdded"],
            labelId: "INBOX",
        });

        const messageIds = new Set<string>();
        for (const h of res.data.history || []) {
            for (const m of h.messagesAdded || []) {
                if (m.message?.id && m.message.labelIds?.includes("INBOX")) {
                    messageIds.add(m.message.id);
                }
            }
        }

        const emails: EmailSummary[] = [];
        for (const id of messageIds) {
            try {
                const full = await gmail.users.messages.get({
                    userId: "me",
                    id,
                    format: "metadata",
                    metadataHeaders: ["From", "To", "Subject", "Date"],
                });

                const headers = full.data.payload?.headers;
                emails.push({
                    id: full.data.id || "",
                    threadId: full.data.threadId || "",
                    from: headers?.find((h) => h.name === "From")?.value || "",
                    to: headers?.find((h) => h.name === "To")?.value || "",
                    subject: headers?.find((h) => h.name === "Subject")?.value || "",
                    snippet: full.data.snippet || "",
                    date: headers?.find((h) => h.name === "Date")?.value || "",
                    labels: full.data.labelIds || [],
                    unread: full.data.labelIds?.includes("UNREAD") || false,
                });
            } catch {
                // Message may have been deleted
            }
        }

        return emails;
    } catch {
        // History ID may be too old — fall back to listing
        return [];
    }
}

/**
 * Start or renew the Gmail watch (call on startup and every 6 days).
 */
export async function startGmailWatch(): Promise<void> {
    const topic = process.env.GMAIL_PUBSUB_TOPIC;
    if (!topic || !isGmailReady()) return;

    try {
        const { watchInbox } = await import("./client.js");
        const result = await watchInbox(topic);
        lastHistoryId = result.historyId;
        watchExpiration = parseInt(result.expiration) || 0;

        console.log(`  📧 Gmail: watching inbox (expires ${new Date(watchExpiration).toLocaleString()})`);

        // Re-watch before expiration (every 6 days)
        const renewIn = Math.min(6 * 24 * 60 * 60 * 1000, watchExpiration - Date.now() - 60_000);
        if (renewIn > 0) {
            setTimeout(() => startGmailWatch(), renewIn);
        }
    } catch (err) {
        console.error("  ⚠️  Gmail: watch failed:", err instanceof Error ? err.message : err);
    }
}
