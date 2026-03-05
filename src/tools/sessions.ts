import type Anthropic from "@anthropic-ai/sdk";
import {
    listSessions,
    getSessionHistory,
    sendToSession,
    createSession,
    deleteSession,
} from "../swarm/sessions.js";

// ── sessions_list ────────────────────────────────────

export const sessionsList = {
    definition: {
        name: "sessions_list",
        description:
            "List all active agent sessions. Shows session ID, name, participants, message count, and last activity.",
        input_schema: {
            type: "object" as const,
            properties: {},
        },
    } satisfies Anthropic.Tool,

    async execute(_input: Record<string, unknown>): Promise<string> {
        const sessions = listSessions();
        if (sessions.length === 0) {
            return JSON.stringify({ sessions: [], message: "No active sessions." });
        }

        return JSON.stringify({
            sessions: sessions.map((s) => ({
                id: s.id,
                name: s.name,
                participants: s.participants,
                messages: s.messageCount,
                lastActivity: s.lastActivity ? new Date(s.lastActivity).toISOString() : null,
            })),
        });
    },
};

// ── sessions_history ─────────────────────────────────

export const sessionsHistory = {
    definition: {
        name: "sessions_history",
        description:
            "Get the message history for a specific agent session. Returns the last N messages with sender, timestamp, and content.",
        input_schema: {
            type: "object" as const,
            properties: {
                session_id: {
                    type: "string",
                    description: "The session ID to get history for.",
                },
                limit: {
                    type: "number",
                    description: "Max number of messages to return (default: 20).",
                },
            },
            required: ["session_id"],
        },
    } satisfies Anthropic.Tool,

    async execute(input: Record<string, unknown>): Promise<string> {
        const sessionId = input.session_id as string;
        const limit = (input.limit as number) || 20;

        const messages = getSessionHistory(sessionId, limit);
        if (messages.length === 0) {
            return JSON.stringify({ messages: [], message: `No messages in session "${sessionId}".` });
        }

        return JSON.stringify({
            session: sessionId,
            messages: messages.map((m) => ({
                from: m.from,
                time: new Date(m.timestamp).toISOString(),
                content: m.content.slice(0, 2000),
            })),
        });
    },
};

// ── sessions_send ────────────────────────────────────

export const sessionsSend = {
    definition: {
        name: "sessions_send",
        description:
            `Send a message to an agent session. Creates the session if it doesn't exist. Use this for:
- Agent-to-agent communication (sub-agents sharing findings)
- Creating task threads for organized collaboration
- Leaving notes or instructions for other agents or future runs`,
        input_schema: {
            type: "object" as const,
            properties: {
                session_id: {
                    type: "string",
                    description: "Target session ID. Will be created if it doesn't exist.",
                },
                message: {
                    type: "string",
                    description: "The message content to send.",
                },
                from: {
                    type: "string",
                    description: "Sender name (default: 'giorgio').",
                },
                session_name: {
                    type: "string",
                    description: "Display name for a new session (used only when creating).",
                },
            },
            required: ["session_id", "message"],
        },
    } satisfies Anthropic.Tool,

    async execute(input: Record<string, unknown>): Promise<string> {
        const sessionId = input.session_id as string;
        const message = input.message as string;
        const from = (input.from as string) || "giorgio";
        const sessionName = input.session_name as string | undefined;

        if (!sessionId?.trim() || !message?.trim()) {
            return JSON.stringify({ error: "MISSING_FIELDS", message: "session_id and message are required." });
        }

        // Create session with name if it's new
        if (sessionName) {
            createSession(sessionId, sessionName, [from]);
        }

        const msg = sendToSession(sessionId, from, message);

        return JSON.stringify({
            sent: true,
            session: sessionId,
            from: msg.from,
            time: new Date(msg.timestamp).toISOString(),
        });
    },
};

// ── sessions_manage ──────────────────────────────────

export const sessionsManage = {
    definition: {
        name: "sessions_manage",
        description:
            "Manage agent sessions. Create new sessions or delete existing ones.",
        input_schema: {
            type: "object" as const,
            properties: {
                action: {
                    type: "string",
                    enum: ["create", "delete"],
                    description: "Action to perform.",
                },
                session_id: {
                    type: "string",
                    description: "Session ID.",
                },
                session_name: {
                    type: "string",
                    description: "Display name (for create).",
                },
                participants: {
                    type: "array",
                    items: { type: "string" },
                    description: "Initial participants (for create).",
                },
            },
            required: ["action", "session_id"],
        },
    } satisfies Anthropic.Tool,

    async execute(input: Record<string, unknown>): Promise<string> {
        const action = input.action as string;
        const sessionId = input.session_id as string;

        if (action === "create") {
            const name = (input.session_name as string) || sessionId;
            const participants = (input.participants as string[]) || [];
            const session = createSession(sessionId, name, participants);
            return JSON.stringify({
                created: true,
                id: session.id,
                name: session.name,
                participants: Array.from(session.participants),
            });
        }

        if (action === "delete") {
            const deleted = deleteSession(sessionId);
            return JSON.stringify({
                deleted,
                message: deleted ? `Session "${sessionId}" deleted.` : `Cannot delete "${sessionId}" (not found or is "main").`,
            });
        }

        return JSON.stringify({ error: "UNKNOWN_ACTION", message: `Unknown action: ${action}` });
    },
};
