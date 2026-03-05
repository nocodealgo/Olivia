/**
 * Group Chat Manager
 *
 * Handles Telegram group chat behavior:
 *   - Respond only when @mentioned or replied to
 *   - Per-group isolated memory (via session chatId = group chatId)
 *   - Admin-only commands in groups
 *   - Configurable group settings (stored in SQLite)
 */

import { db } from "../memory/db.js";
import { config } from "../config.js";

// ── Schema ───────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS group_settings (
    chat_id       INTEGER PRIMARY KEY,
    title         TEXT    DEFAULT '',
    respond_mode  TEXT    DEFAULT 'mention',
    admins        TEXT    DEFAULT '[]',
    enabled       INTEGER DEFAULT 1,
    created_at    TEXT    DEFAULT (datetime('now')),
    updated_at    TEXT    DEFAULT (datetime('now'))
  );
`);

// ── Types ────────────────────────────────────────────

export type RespondMode = "mention" | "always" | "never";

export interface GroupSettings {
    chat_id: number;
    title: string;
    respond_mode: RespondMode;
    admins: string;    // JSON array of user IDs
    enabled: number;
    created_at: string;
    updated_at: string;
}

// ── Prepared statements ──────────────────────────────

const getSettingsStmt = db.prepare(
    `SELECT * FROM group_settings WHERE chat_id = ?`
);

const upsertStmt = db.prepare(`
  INSERT INTO group_settings (chat_id, title, respond_mode, admins, enabled, updated_at)
  VALUES (?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(chat_id) DO UPDATE SET
    title = excluded.title,
    respond_mode = excluded.respond_mode,
    admins = excluded.admins,
    enabled = excluded.enabled,
    updated_at = datetime('now')
`);

const listGroupsStmt = db.prepare(
    `SELECT * FROM group_settings ORDER BY updated_at DESC`
);

// ── Public API ───────────────────────────────────────

/**
 * Get or create group settings.
 */
export function getGroupSettings(chatId: number, title?: string): GroupSettings {
    let row = getSettingsStmt.get(chatId) as GroupSettings | undefined;
    if (!row) {
        upsertStmt.run(chatId, title || "", "mention", "[]", 1);
        row = getSettingsStmt.get(chatId) as GroupSettings;
    }
    return row;
}

/**
 * Update group settings.
 */
export function updateGroupSettings(
    chatId: number,
    updates: Partial<Pick<GroupSettings, "title" | "respond_mode" | "admins" | "enabled">>,
): GroupSettings {
    const current = getGroupSettings(chatId);
    upsertStmt.run(
        chatId,
        updates.title ?? current.title,
        updates.respond_mode ?? current.respond_mode,
        updates.admins ?? current.admins,
        updates.enabled ?? current.enabled,
    );
    return getGroupSettings(chatId);
}

/**
 * List all registered groups.
 */
export function listGroups(): GroupSettings[] {
    return listGroupsStmt.all() as GroupSettings[];
}

/**
 * Check if a user is a group admin.
 * The bot owner (allowedUserIds) is always an admin.
 */
export function isGroupAdmin(chatId: number, userId: number): boolean {
    // Bot owner is always admin everywhere
    if (config.allowedUserIds.has(userId)) return true;

    const settings = getGroupSettings(chatId);
    const admins: number[] = JSON.parse(settings.admins || "[]");
    return admins.includes(userId);
}

/**
 * Add a user as group admin.
 */
export function addGroupAdmin(chatId: number, userId: number): void {
    const settings = getGroupSettings(chatId);
    const admins: number[] = JSON.parse(settings.admins || "[]");
    if (!admins.includes(userId)) {
        admins.push(userId);
        updateGroupSettings(chatId, { admins: JSON.stringify(admins) });
    }
}

/**
 * Remove a group admin.
 */
export function removeGroupAdmin(chatId: number, userId: number): void {
    const settings = getGroupSettings(chatId);
    const admins: number[] = JSON.parse(settings.admins || "[]");
    const filtered = admins.filter((id) => id !== userId);
    updateGroupSettings(chatId, { admins: JSON.stringify(filtered) });
}

// ── Mention detection ────────────────────────────────

/**
 * Check if the bot was mentioned or replied to in a message.
 */
export function isBotMentioned(text: string, botUsername?: string): boolean {
    const name = config.botName.toLowerCase();
    const lower = text.toLowerCase();

    // Check @username mention
    if (botUsername && lower.includes(`@${botUsername.toLowerCase()}`)) return true;

    // Check bot username without @ (e.g. "Giorgio_v1_Bot, what time?")
    if (botUsername && lower.includes(botUsername.toLowerCase())) return true;

    // Check display name mention (e.g. "Giorgio, what's the time?")
    if (lower.includes(name)) return true;

    return false;
}

/**
 * Strip the bot mention from the text so the LLM gets clean input.
 */
export function stripMention(text: string, botUsername?: string): string {
    let cleaned = text;
    if (botUsername) {
        cleaned = cleaned.replace(new RegExp(`@${botUsername}`, "gi"), "").trim();
    }
    return cleaned;
}

/**
 * Determine if the bot should respond to a group message.
 */
export function shouldRespondInGroup(
    chatId: number,
    text: string,
    isReplyToBot: boolean,
    botUsername?: string,
): boolean {
    const settings = getGroupSettings(chatId);

    if (!settings.enabled) return false;

    switch (settings.respond_mode) {
        case "always":
            return true;
        case "never":
            return false;
        case "mention":
        default:
            // Respond when @mentioned, name-mentioned, or replied to
            if (isReplyToBot) return true;
            if (isBotMentioned(text, botUsername)) return true;
            // Also respond to slash commands
            if (text.trim().startsWith("/")) return true;
            return false;
    }
}

/**
 * Check if a chat is a group chat (negative ID in Telegram).
 */
export function isGroupChat(chatId: number): boolean {
    return chatId < 0;
}
