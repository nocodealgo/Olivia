import Database from "better-sqlite3";
import { config } from "../config.js";
import { getDefaultBriefingConfig } from "./morning-briefing.js";

// ── Re-use the same database ─────────────────────────

const db = new Database(config.memoryDbPath);

// ── Schema ───────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS schedules (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    cron_hour  INTEGER NOT NULL,
    cron_minute INTEGER NOT NULL DEFAULT 0,
    days       TEXT    NOT NULL DEFAULT '1,2,3,4,5,6,7',
    prompt     TEXT    NOT NULL,
    enabled    INTEGER NOT NULL DEFAULT 1,
    last_run   TEXT,
    created_at TEXT    DEFAULT (datetime('now'))
  );
`);

// Seed default morning briefing if table is empty
const count = db.prepare("SELECT COUNT(*) as n FROM schedules").get() as { n: number };
if (count.n === 0) {
    const cfg = getDefaultBriefingConfig();
    // Seed with a marker prompt — the scheduler will call buildBriefingPrompt() dynamically at fire time
    db.prepare(`
    INSERT INTO schedules (name, cron_hour, cron_minute, days, prompt)
    VALUES (?, ?, ?, ?, ?)
  `).run(
        cfg.name,
        cfg.hour,
        cfg.minute,
        cfg.days,
        "__MORNING_BRIEFING__"
    );
    console.log(`  📅 Seeded Morning Briefing schedule (${cfg.hour}:00 ${cfg.days === "1,2,3,4,5,6,7" ? "daily" : cfg.days}).`);
}

// ── Types ────────────────────────────────────────────

export interface Schedule {
    id: number;
    name: string;
    cron_hour: number;
    cron_minute: number;
    days: string;
    prompt: string;
    enabled: number;
    last_run: string | null;
    created_at: string;
}

// ── CRUD ─────────────────────────────────────────────

const listStmt = db.prepare("SELECT * FROM schedules ORDER BY cron_hour, cron_minute");
const listEnabledStmt = db.prepare("SELECT * FROM schedules WHERE enabled = 1 ORDER BY cron_hour, cron_minute");
const addStmt = db.prepare(
    "INSERT INTO schedules (name, cron_hour, cron_minute, days, prompt) VALUES (?, ?, ?, ?, ?)"
);
const removeStmt = db.prepare("DELETE FROM schedules WHERE id = ?");
const toggleStmt = db.prepare("UPDATE schedules SET enabled = NOT enabled WHERE id = ?");
const markRunStmt = db.prepare("UPDATE schedules SET last_run = datetime('now') WHERE id = ?");

export function listSchedules(enabledOnly = false): Schedule[] {
    return (enabledOnly ? listEnabledStmt : listStmt).all() as Schedule[];
}

export function addSchedule(
    name: string,
    hour: number,
    minute: number,
    days: string,
    prompt: string
): number {
    const result = addStmt.run(name, hour, minute, days, prompt);
    return result.lastInsertRowid as number;
}

export function removeSchedule(id: number): boolean {
    return removeStmt.run(id).changes > 0;
}

export function toggleSchedule(id: number): boolean {
    return toggleStmt.run(id).changes > 0;
}

export function markScheduleRun(id: number): void {
    markRunStmt.run(id);
}
