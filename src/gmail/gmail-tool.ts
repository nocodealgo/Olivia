/**
 * Gmail Agent Tool
 *
 * Gives the AI agent full email capabilities:
 * list, read, send, draft, search, trash, unread count.
 */

import { config } from "../config.js";
import {
    listEmails, readEmail, createDraft,
    markAsRead, trashEmail, getUnreadCount,
} from "./client.js";
import { isGmailReady, getAuthUrl } from "./auth.js";

export const gmailToolDefinitions = [
    {
        name: "gmail",
        description: `Manage ${config.botName}'s email. Actions: list, read, draft, search, trash, mark_read, unread_count, auth_status. Sending is disabled — always create a draft so the user can review and send manually from Gmail.`,
        input_schema: {
            type: "object" as const,
            properties: {
                action: {
                    type: "string",
                    enum: ["list", "read", "draft", "search", "trash", "mark_read", "unread_count", "auth_status"],
                    description: "Email action to perform",
                },
                message_id: { type: "string", description: "Email message ID (for read, trash, mark_read)" },
                to: { type: "string", description: "Recipient email (for send, draft)" },
                subject: { type: "string", description: "Email subject (for send, draft)" },
                body: { type: "string", description: "Email body text (for send, draft)" },
                cc: { type: "string", description: "CC recipients (for send, draft)" },
                bcc: { type: "string", description: "BCC recipients (for send, draft)" },
                query: { type: "string", description: "Gmail search query (for search, list)" },
                max_results: { type: "number", description: "Max emails to return (default 10)" },
                thread_id: { type: "string", description: "Thread ID for replies" },
                in_reply_to: { type: "string", description: "Message-ID header for threading" },
            },
            required: ["action"],
        },
    },
];

export async function handleGmailTool(
    _name: string,
    input: Record<string, unknown>,
): Promise<string> {
    const action = input.action as string;

    // Auth status check
    if (action === "auth_status") {
        if (isGmailReady()) return "✅ Gmail is authenticated and ready.";
        const url = getAuthUrl();
        if (url) return `❌ Gmail not authenticated. Visit this URL to authorize:\n${url}`;
        return "❌ Gmail not configured. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in .env";
    }

    // All other actions require auth
    if (!isGmailReady()) {
        return "❌ Gmail not authenticated. Use action 'auth_status' to get the auth URL.";
    }

    try {
        switch (action) {
            case "list": {
                const emails = await listEmails({
                    maxResults: (input.max_results as number) || 10,
                    query: input.query as string,
                });
                if (emails.length === 0) return "No emails found.";
                return emails.map((e, i) =>
                    `${i + 1}. ${e.unread ? "🔵" : "⚪"} **${e.from}**\n   ${e.subject}\n   _${e.snippet.slice(0, 100)}_\n   ID: ${e.id}`
                ).join("\n\n");
            }

            case "search": {
                const query = input.query as string;
                if (!query) return "Error: 'query' is required for search.";
                const emails = await listEmails({
                    maxResults: (input.max_results as number) || 10,
                    query,
                });
                if (emails.length === 0) return `No emails matching "${query}".`;
                return `Found ${emails.length} email(s) matching "${query}":\n\n` +
                    emails.map((e, i) =>
                        `${i + 1}. ${e.unread ? "🔵" : "⚪"} **${e.from}**: ${e.subject}\n   ID: ${e.id}`
                    ).join("\n");
            }

            case "read": {
                const id = input.message_id as string;
                if (!id) return "Error: 'message_id' is required.";
                const email = await readEmail(id);
                return `📧 **${email.subject}**\nFrom: ${email.from}\nTo: ${email.to}\nDate: ${email.date}\n${email.attachments.length > 0 ? `Attachments: ${email.attachments.map(a => a.filename).join(", ")}\n` : ""}\n---\n${email.body.slice(0, 3000)}`;
            }

            case "send": {
                // Sending is disabled — create a draft instead
                const to = input.to as string;
                const subject = input.subject as string;
                const body = input.body as string;
                if (!to || !subject || !body) return "Error: 'to', 'subject', and 'body' are required.";
                const draftId = await createDraft({
                    to, subject, body,
                    cc: input.cc as string,
                    bcc: input.bcc as string,
                    threadId: input.thread_id as string,
                    inReplyTo: input.in_reply_to as string,
                });
                return `📝 Draft created for ${to} (sending is disabled — please review and send manually from Gmail). Draft ID: ${draftId}`;
            }

            case "draft": {
                const to = input.to as string;
                const subject = input.subject as string;
                const body = input.body as string;
                if (!to || !subject || !body) return "Error: 'to', 'subject', and 'body' are required.";
                const draftId = await createDraft({
                    to, subject, body,
                    cc: input.cc as string,
                    bcc: input.bcc as string,
                    threadId: input.thread_id as string,
                    inReplyTo: input.in_reply_to as string,
                });
                return `📝 Draft created. Draft ID: ${draftId}`;
            }

            case "mark_read": {
                const id = input.message_id as string;
                if (!id) return "Error: 'message_id' is required.";
                await markAsRead(id);
                return `✅ Marked as read: ${id}`;
            }

            case "trash": {
                const id = input.message_id as string;
                if (!id) return "Error: 'message_id' is required.";
                await trashEmail(id);
                return `🗑️ Trashed: ${id}`;
            }

            case "unread_count": {
                const count = await getUnreadCount();
                return `📬 ${count} unread email(s) in inbox.`;
            }

            default:
                return `Unknown action: ${action}. Use: list, read, draft, search, trash, mark_read, unread_count, auth_status.`;
        }
    } catch (err) {
        return `❌ Gmail error: ${err instanceof Error ? err.message : String(err)}`;
    }
}
