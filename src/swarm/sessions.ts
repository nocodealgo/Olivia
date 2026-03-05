/**
 * Multi-session manager for agent-to-agent communication.
 *
 * Sessions are named conversations that agents can create, send messages to,
 * and read history from. This enables collaboration between the main agent,
 * sub-agents, and external integrations.
 */

// ── Types ────────────────────────────────────────────

export interface SessionMessage {
    timestamp: number;
    from: string;     // agent name or "user"
    to: string;       // session name
    content: string;
}

export interface Session {
    id: string;
    name: string;
    createdAt: number;
    participants: Set<string>;
    messages: SessionMessage[];
    metadata: Record<string, string>;
}

// ── State ────────────────────────────────────────────

const sessions = new Map<string, Session>();

// Bootstrap the default "main" session
sessions.set("main", {
    id: "main",
    name: "Main Conversation",
    createdAt: Date.now(),
    participants: new Set(["giorgio", "user"]),
    messages: [],
    metadata: {},
});

// ── Public API ───────────────────────────────────────

/**
 * Create a new named session.
 */
export function createSession(id: string, name: string, participants: string[] = []): Session {
    if (sessions.has(id)) {
        return sessions.get(id)!;
    }

    const session: Session = {
        id,
        name,
        createdAt: Date.now(),
        participants: new Set(["giorgio", ...participants]),
        messages: [],
        metadata: {},
    };

    sessions.set(id, session);
    console.log(`  🔗 Session created: "${name}" (${id}) — ${session.participants.size} participant(s).`);
    return session;
}

/**
 * Send a message to a session. Creates the session if it doesn't exist.
 */
export function sendToSession(sessionId: string, from: string, content: string): SessionMessage {
    let session = sessions.get(sessionId);
    if (!session) {
        session = createSession(sessionId, sessionId, [from]);
    }

    session.participants.add(from);

    const msg: SessionMessage = {
        timestamp: Date.now(),
        from,
        to: sessionId,
        content,
    };

    session.messages.push(msg);

    // Keep sessions bounded (last 100 messages)
    if (session.messages.length > 100) {
        session.messages = session.messages.slice(-100);
    }

    return msg;
}

/**
 * Get message history for a session.
 */
export function getSessionHistory(sessionId: string, limit = 20): SessionMessage[] {
    const session = sessions.get(sessionId);
    if (!session) return [];
    return session.messages.slice(-limit);
}

/**
 * List all active sessions.
 */
export function listSessions(): Array<{
    id: string;
    name: string;
    participants: string[];
    messageCount: number;
    lastActivity: number | null;
}> {
    return Array.from(sessions.values()).map((s) => ({
        id: s.id,
        name: s.name,
        participants: Array.from(s.participants),
        messageCount: s.messages.length,
        lastActivity: s.messages.length > 0
            ? s.messages[s.messages.length - 1].timestamp
            : null,
    }));
}

/**
 * Delete a session (except "main").
 */
export function deleteSession(sessionId: string): boolean {
    if (sessionId === "main") return false;
    return sessions.delete(sessionId);
}

/**
 * Get unread messages for an agent since a given timestamp.
 */
export function getUnreadMessages(agentName: string, since: number): SessionMessage[] {
    const unread: SessionMessage[] = [];
    for (const session of sessions.values()) {
        if (!session.participants.has(agentName)) continue;
        for (const msg of session.messages) {
            if (msg.timestamp > since && msg.from !== agentName) {
                unread.push(msg);
            }
        }
    }
    return unread.sort((a, b) => a.timestamp - b.timestamp);
}
