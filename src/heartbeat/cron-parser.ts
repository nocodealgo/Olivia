// ── Cron expression parser ───────────────────────────
// Supports standard 5-field cron: minute hour day-of-month month day-of-week
// Also parses natural language like "every day at 9am", "weekdays at 8:30"

export interface ParsedCron {
    minute: number;
    hour: number;
    days: string; // "1,2,3,4,5,6,7" format (1=Mon, 7=Sun)
}

/**
 * Parse cron expression OR natural language into a schedule config.
 * Returns null if unparseable.
 */
export function parseCronOrNatural(input: string): ParsedCron | null {
    const trimmed = input.trim();

    // Try cron expression first (5 fields: min hour dom month dow)
    const cronResult = parseCronExpression(trimmed);
    if (cronResult) return cronResult;

    // Try natural language
    return parseNaturalLanguage(trimmed);
}

// ── Cron expression parser ───────────────────────────

function parseCronExpression(expr: string): ParsedCron | null {
    const parts = expr.split(/\s+/);
    if (parts.length < 2 || parts.length > 5) return null;

    // Must start with a number or *
    if (!/^[\d*]/.test(parts[0])) return null;

    const minute = parts[0] === "*" ? 0 : parseInt(parts[0]);
    const hour = parts.length >= 2 ? (parts[1] === "*" ? 0 : parseInt(parts[1])) : 0;

    if (isNaN(minute) || isNaN(hour)) return null;
    if (minute < 0 || minute > 59 || hour < 0 || hour > 23) return null;

    // Parse day-of-week (field 5, index 4) if present
    let days = "1,2,3,4,5,6,7";
    if (parts.length === 5) {
        const dow = parts[4];
        if (dow !== "*") {
            days = parseDowField(dow);
        }
    }

    return { minute, hour, days };
}

function parseDowField(field: string): string {
    // Cron dow: 0=Sun, 1=Mon, ..., 6=Sat — convert to our 1=Mon, ..., 7=Sun
    const cronToOurs: Record<number, number> = { 0: 7, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7 };
    const nameToNum: Record<string, number> = {
        sun: 7, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
    };

    const parts = field.split(",");
    const result = new Set<number>();

    for (const part of parts) {
        // Range: 1-5
        if (part.includes("-")) {
            const [start, end] = part.split("-").map((p) => {
                const n = nameToNum[p.toLowerCase()] || parseInt(p);
                return isNaN(n) ? (cronToOurs[0] ?? 0) : (cronToOurs[n] ?? n);
            });
            for (let i = start; i <= end; i++) result.add(i);
        } else {
            const n = nameToNum[part.toLowerCase()] || parseInt(part);
            if (!isNaN(n)) result.add(cronToOurs[n] ?? n);
        }
    }

    return Array.from(result).sort().join(",") || "1,2,3,4,5,6,7";
}

// ── Natural language parser ──────────────────────────

function parseNaturalLanguage(text: string): ParsedCron | null {
    const lower = text.toLowerCase();

    // Extract time
    const time = extractTime(lower);
    if (!time) return null;

    // Extract days
    const days = extractDays(lower);

    return { minute: time.minute, hour: time.hour, days };
}

function extractTime(text: string): { hour: number; minute: number } | null {
    // "at 9:30am", "at 14:00", "at 9am", "at 9 am", "9:30", "9am"
    const timeMatch = text.match(/(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (!timeMatch) return null;

    let hour = parseInt(timeMatch[1]);
    const minute = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    const ampm = timeMatch[3]?.toLowerCase();

    if (ampm === "pm" && hour !== 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;

    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

    return { hour, minute };
}

function extractDays(text: string): string {
    const lower = text.toLowerCase();

    if (lower.includes("weekday") || lower.includes("lunes a viernes") || lower.includes("mon-fri")) {
        return "1,2,3,4,5";
    }
    if (lower.includes("weekend") || lower.includes("fin de semana")) {
        return "6,7";
    }
    if (lower.includes("every day") || lower.includes("daily") || lower.includes("todos los días") || lower.includes("diario")) {
        return "1,2,3,4,5,6,7";
    }

    // Check for specific day names
    const dayNames: Record<string, number> = {
        monday: 1, mon: 1, lunes: 1,
        tuesday: 2, tue: 2, martes: 2,
        wednesday: 3, wed: 3, miércoles: 3, miercoles: 3,
        thursday: 4, thu: 4, jueves: 4,
        friday: 5, fri: 5, viernes: 5,
        saturday: 6, sat: 6, sábado: 6, sabado: 6,
        sunday: 7, sun: 7, domingo: 7,
    };

    const foundDays = new Set<number>();
    for (const [name, num] of Object.entries(dayNames)) {
        if (lower.includes(name)) foundDays.add(num);
    }

    if (foundDays.size > 0) {
        return Array.from(foundDays).sort().join(",");
    }

    // Default: every day
    return "1,2,3,4,5,6,7";
}

/**
 * Format a schedule time for display.
 */
export function formatScheduleTime(hour: number, minute: number, days: string): string {
    const h = String(hour).padStart(2, "0");
    const m = String(minute).padStart(2, "0");

    const dayMap: Record<string, string> = {
        "1": "Mon", "2": "Tue", "3": "Wed", "4": "Thu",
        "5": "Fri", "6": "Sat", "7": "Sun",
    };

    const dayList = days.split(",");
    let dayLabel: string;

    if (dayList.length === 7) dayLabel = "daily";
    else if (days === "1,2,3,4,5") dayLabel = "weekdays";
    else if (days === "6,7") dayLabel = "weekends";
    else dayLabel = dayList.map((d) => dayMap[d] || d).join(", ");

    return `${h}:${m} (${dayLabel})`;
}
