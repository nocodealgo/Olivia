/**
 * Talk Mode — Voice conversation state manager
 *
 * Tracks per-chat talk mode sessions. When active:
 * - Voice messages get voice replies (TTS)
 * - Text messages also get voice replies
 * - Auto-deactivates after timeout
 */

const activeSessions = new Map<number, TalkSession>();

interface TalkSession {
    startedAt: number;
    lastActivity: number;
    messageCount: number;
}

const SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes inactivity

/**
 * Toggle talk mode for a chat. Returns new state.
 */
export function toggleTalkMode(chatId: number): boolean {
    if (activeSessions.has(chatId)) {
        activeSessions.delete(chatId);
        return false;
    }
    activeSessions.set(chatId, {
        startedAt: Date.now(),
        lastActivity: Date.now(),
        messageCount: 0,
    });
    return true;
}

/**
 * Check if talk mode is active for a chat.
 */
export function isTalkModeActive(chatId: number): boolean {
    const session = activeSessions.get(chatId);
    if (!session) return false;

    // Auto-expire after timeout
    if (Date.now() - session.lastActivity > SESSION_TIMEOUT_MS) {
        activeSessions.delete(chatId);
        return false;
    }
    return true;
}

/**
 * Record activity in a talk session.
 */
export function recordTalkActivity(chatId: number): void {
    const session = activeSessions.get(chatId);
    if (session) {
        session.lastActivity = Date.now();
        session.messageCount++;
    }
}

/**
 * End talk mode for a chat.
 */
export function endTalkMode(chatId: number): boolean {
    return activeSessions.delete(chatId);
}

/**
 * Get talk mode status for display.
 */
export function getTalkModeStatus(chatId: number): string {
    const session = activeSessions.get(chatId);
    if (!session) return "Talk Mode: off";

    const elapsed = Math.round((Date.now() - session.startedAt) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    return `🎙️ Talk Mode: active (${mins}m${secs}s, ${session.messageCount} messages)`;
}
