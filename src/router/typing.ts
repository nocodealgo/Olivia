/**
 * Typing Indicator Service
 *
 * Continuously sends typing indicators while the LLM is processing.
 * Telegram's "typing" action expires after ~5s, so we repeat it
 * every 4s until the response is ready.
 *
 * Usage:
 *   const stop = startTyping(adapter, chatId, replyContext);
 *   const reply = await handleMessage(...);
 *   stop();         // Clear typing indicator
 */

import type { ChannelAdapter } from "./types.js";

// ── Active typing sessions ───────────────────────────

const activeSessions = new Map<string, NodeJS.Timeout>();

/**
 * Start sending typing indicators every 4 seconds.
 * Returns a stop function that clears the interval.
 */
export function startTyping(
    adapter: ChannelAdapter,
    chatId: number,
    replyContext: unknown,
): () => void {
    const key = `${chatId}-${Date.now()}`;

    // Send immediately
    adapter.sendTyping(chatId, replyContext).catch(() => { });

    // Repeat every 4s (Telegram typing expires at ~5s)
    const interval = setInterval(() => {
        adapter.sendTyping(chatId, replyContext).catch(() => { });
    }, 4000);

    activeSessions.set(key, interval);

    // Return stop function
    return () => {
        clearInterval(interval);
        activeSessions.delete(key);
    };
}

/**
 * Stop all active typing sessions (used during shutdown).
 */
export function stopAllTyping(): void {
    for (const interval of activeSessions.values()) {
        clearInterval(interval);
    }
    activeSessions.clear();
}

/**
 * Get the number of active typing sessions (for diagnostics).
 */
export function activeTypingCount(): number {
    return activeSessions.size;
}
