import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, normalize } from "node:path";

// ── Config ───────────────────────────────────────────

const HOME = homedir();
const LOG_DIR = resolve(HOME, "Giorgio", "logs");
const AUDIT_LOG = resolve(LOG_DIR, "security-audit.log");

// ── Command Allowlist ────────────────────────────────
// Only these command prefixes are allowed. Everything else is blocked.
// Set SECURITY_CMD_MODE=allowlist to enforce, or "blocklist" (default) to use existing blocklist.

const CMD_MODE = process.env.SECURITY_CMD_MODE || "blocklist";

const ALLOWED_COMMANDS = (process.env.SECURITY_ALLOWED_CMDS || [
    "ls", "cat", "head", "tail", "wc", "grep", "find", "which", "echo",
    "date", "cal", "uptime", "whoami", "hostname", "uname",
    "pwd", "cd", "df", "du", "free", "top",
    "git", "npm", "node", "npx", "tsx", "tsc",
    "python", "python3", "pip", "pip3",
    "brew", "curl", "wget",
    "docker", "jq", "sed", "awk", "sort", "uniq", "tr", "cut",
    "file", "stat", "md5", "shasum",
    "open", "pbcopy", "pbpaste",
].join(",")).toString().split(",").map((s) => s.trim()).filter(Boolean);

const BLOCKED_COMMANDS = [
    /\brm\s+(-[a-zA-Z]*f|-[a-zA-Z]*r|--force|--recursive)/i,
    /\brm\s+-rf\b/i,
    /\bsudo\b/i,
    /\bmkfs\b/i,
    /\bdd\b.*\bof=/i,
    /\bkill\s+-9/i,
    /\bkillall\b/i,
    /\bshutdown\b/i,
    /\breboot\b/i,
    /\bchmod\s+777/i,
    /\bchown\b.*-R/i,
    />\s*\/dev\//i,
    /\bcurl\b.*\|\s*(bash|sh|zsh)/i,
    /\bwget\b.*\|\s*(bash|sh|zsh)/i,
    /\bformat\b/i,
    /\bdiskutil\s+erase/i,
];

// ── File Path Allowlist ──────────────────────────────
// Files must be under one of these directories.

const ALLOWED_PATHS = (process.env.SECURITY_ALLOWED_PATHS || [
    resolve(HOME, "Giorgio"),
    resolve(HOME, "Documents"),
    resolve(HOME, "Downloads"),
    resolve(HOME, "Desktop"),
    "/tmp",
].join(",")).toString().split(",").map((s) => s.trim()).filter(Boolean);

const PROTECTED_PATHS = [
    resolve(HOME, ".ssh"),
    resolve(HOME, ".gnupg"),
    resolve(HOME, ".aws"),
    resolve(HOME, ".kube"),
    resolve(HOME, ".env"),
    resolve(HOME, ".gitconfig"),
    resolve(HOME, ".zshrc"),
    resolve(HOME, ".bashrc"),
    resolve(HOME, ".npmrc"),
    // Project-critical files — only modifiable via approved flows
    resolve(HOME, "Giorgio", "soul.md"),
    resolve(HOME, "Giorgio", ".env"),
    resolve(HOME, "Giorgio", "secrets.vault"),
    "/etc",
    "/var",
    "/System",
    "/Library",
];

// ── Network Endpoint Allowlist ───────────────────────
// Only these domains/IPs are allowed for outbound requests.

const NETWORK_MODE = process.env.SECURITY_NET_MODE || "allowlist";

const ALLOWED_ENDPOINTS = (process.env.SECURITY_ALLOWED_ENDPOINTS || [
    "api.openai.com",
    "api.anthropic.com",
    "openrouter.ai",
    "api.groq.com",
    "api.elevenlabs.io",
    "generativelanguage.googleapis.com",
    "api.telegram.org",
    "web.whatsapp.com",
    "api.brave.com",
    "www.googleapis.com",
    "customsearch.googleapis.com",
    "html.duckduckgo.com",
    "api.duckduckgo.com",
    "ip-api.com",
    "supabase.co",
    "localhost",
    "127.0.0.1",
].join(",")).toString().split(",").map((s) => s.trim()).filter(Boolean);

// ── Public API ───────────────────────────────────────

export type SecurityAction = "command" | "file_read" | "file_write" | "file_delete" | "network";

export interface SecurityCheck {
    allowed: boolean;
    reason?: string;
}

/**
 * Check if a shell command is allowed.
 */
export function checkCommand(command: string): SecurityCheck {
    // Always block dangerous patterns first
    for (const pattern of BLOCKED_COMMANDS) {
        if (pattern.test(command)) {
            logAudit("BLOCKED", "command", command, "Matches dangerous pattern");
            return { allowed: false, reason: `Blocked: dangerous command pattern detected` };
        }
    }

    // In allowlist mode, check the command prefix
    if (CMD_MODE === "allowlist") {
        const firstWord = command.trim().split(/\s+/)[0].replace(/^.*\//, ""); // basename
        if (!ALLOWED_COMMANDS.includes(firstWord)) {
            logAudit("BLOCKED", "command", command, `Command "${firstWord}" not in allowlist`);
            return { allowed: false, reason: `Command "${firstWord}" is not in the allowlist` };
        }
    }

    logAudit("ALLOWED", "command", command);
    return { allowed: true };
}

/**
 * Check if a file path is allowed for the given action.
 */
export function checkFilePath(filePath: string, action: "read" | "write" | "delete"): SecurityCheck {
    const normalized = normalize(resolve(filePath));

    // Block protected paths
    for (const protected_ of PROTECTED_PATHS) {
        if (normalized.startsWith(protected_)) {
            logAudit("BLOCKED", `file_${action}`, filePath, "Protected path");
            return { allowed: false, reason: `Access denied: "${filePath}" is a protected path` };
        }
    }

    // Check if under an allowed directory
    const isAllowed = ALLOWED_PATHS.some((allowed) => normalized.startsWith(allowed));
    if (!isAllowed) {
        logAudit("BLOCKED", `file_${action}`, filePath, "Not in allowed paths");
        return { allowed: false, reason: `Access denied: "${filePath}" is outside allowed directories` };
    }

    logAudit("ALLOWED", `file_${action}`, filePath);
    return { allowed: true };
}

/**
 * Check if a network endpoint is allowed.
 */
export function checkEndpoint(url: string): SecurityCheck {
    if (NETWORK_MODE !== "allowlist") {
        return { allowed: true };
    }

    try {
        const parsed = new URL(url);
        const host = parsed.hostname;

        const isAllowed = ALLOWED_ENDPOINTS.some((allowed) =>
            host === allowed || host.endsWith(`.${allowed}`)
        );

        if (!isAllowed) {
            logAudit("BLOCKED", "network", url, `Host "${host}" not in allowlist`);
            return { allowed: false, reason: `Network access denied: "${host}" is not in the allowlist` };
        }
    } catch {
        logAudit("BLOCKED", "network", url, "Invalid URL");
        return { allowed: false, reason: `Invalid URL: "${url}"` };
    }

    logAudit("ALLOWED", "network", url);
    return { allowed: true };
}

/**
 * Get policy summary (for /status or debugging).
 */
export function getSecuritySummary(): string {
    return [
        `🔒 Security Policy:`,
        `  Commands: ${CMD_MODE} mode (${CMD_MODE === "allowlist" ? ALLOWED_COMMANDS.length + " allowed" : "blocklist active"})`,
        `  File paths: ${ALLOWED_PATHS.length} allowed directories`,
        `  Protected: ${PROTECTED_PATHS.length} protected paths`,
        `  Network: ${NETWORK_MODE} mode (${ALLOWED_ENDPOINTS.length} endpoints)`,
    ].join("\n");
}

// ── Audit Log ────────────────────────────────────────

let logReady = false;

async function ensureLogDir(): Promise<void> {
    if (logReady) return;
    try {
        await mkdir(LOG_DIR, { recursive: true });
        logReady = true;
    } catch { /* ignore */ }
}

function logAudit(verdict: "ALLOWED" | "BLOCKED", action: string, target: string, reason?: string): void {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${verdict} ${action}: ${target}${reason ? ` — ${reason}` : ""}\n`;

    if (verdict === "BLOCKED") {
        console.log(`  🔒 ${verdict} ${action}: ${target.slice(0, 80)}${reason ? ` — ${reason}` : ""}`);
    }

    // Write to audit log file (async, fire-and-forget)
    ensureLogDir().then(() =>
        appendFile(AUDIT_LOG, line).catch(() => { })
    );
}
