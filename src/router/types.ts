// ── Channel types ────────────────────────────────────

export type Channel = "telegram" | "whatsapp" | "webhook";

// ── Incoming message ─────────────────────────────────

export interface IncomingMessage {
    /** Which channel this came from */
    channel: Channel;
    /** Numeric chat ID (used as key for agent memory) */
    chatId: number;
    /** Display name of the sender (no phone numbers) */
    senderName: string;
    /** Text content of the message */
    text: string;
    /** Channel-specific context needed for replying */
    replyContext: unknown;
}

// ── Channel adapter interface ────────────────────────

export interface ChannelAdapter {
    /** Send a text reply back to the channel */
    send(chatId: number, text: string, replyContext: unknown): Promise<void>;
    /** Show typing/recording indicator */
    sendTyping(chatId: number, replyContext: unknown): Promise<void>;
}
