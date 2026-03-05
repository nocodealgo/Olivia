import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { readFile, writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";

// ── Config ───────────────────────────────────────────

/** Path to the encrypted vault file */
const VAULT_PATH = process.env.VAULT_PATH || resolve("secrets.vault");

/** Master key — set via env or prompt at startup */
const MASTER_KEY = process.env.VAULT_MASTER_KEY || "";

/** AES-256-GCM constants */
const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const TAG_LENGTH = 16;

// ── Types ────────────────────────────────────────────

interface VaultData {
    version: number;
    secrets: Record<string, string>; // key -> encrypted value
}

// ── Internal ─────────────────────────────────────────

function deriveKey(masterKey: string, salt: Buffer): Buffer {
    return scryptSync(masterKey, salt, KEY_LENGTH);
}

function encrypt(plaintext: string, masterKey: string): string {
    const salt = randomBytes(SALT_LENGTH);
    const key = deriveKey(masterKey, salt);
    const iv = randomBytes(IV_LENGTH);

    const cipher = createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(plaintext, "utf-8", "hex");
    encrypted += cipher.final("hex");
    const tag = cipher.getAuthTag();

    // Format: salt:iv:tag:ciphertext (all hex)
    return [
        salt.toString("hex"),
        iv.toString("hex"),
        tag.toString("hex"),
        encrypted,
    ].join(":");
}

function decrypt(packed: string, masterKey: string): string {
    const [saltHex, ivHex, tagHex, ciphertext] = packed.split(":");
    if (!saltHex || !ivHex || !tagHex || !ciphertext) {
        throw new Error("Invalid encrypted data format");
    }

    const salt = Buffer.from(saltHex, "hex");
    const iv = Buffer.from(ivHex, "hex");
    const tag = Buffer.from(tagHex, "hex");
    const key = deriveKey(masterKey, salt);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(ciphertext, "hex", "utf-8");
    decrypted += decipher.final("utf-8");
    return decrypted;
}

// ── Vault operations ─────────────────────────────────

async function loadVault(masterKey: string): Promise<VaultData> {
    try {
        await access(VAULT_PATH);
    } catch {
        return { version: 1, secrets: {} };
    }

    const raw = await readFile(VAULT_PATH, "utf-8");
    const data = JSON.parse(raw) as VaultData;
    return data;
}

async function saveVault(vault: VaultData): Promise<void> {
    await writeFile(VAULT_PATH, JSON.stringify(vault, null, 2), "utf-8");
}

// ── Public API ───────────────────────────────────────

/** In-memory cache of decrypted secrets */
const secretsCache = new Map<string, string>();

/**
 * Initialize the vault — decrypt all secrets into memory.
 * Call once at startup.
 */
export async function initVault(): Promise<void> {
    if (!MASTER_KEY) {
        console.log("  🔐 Vault: no VAULT_MASTER_KEY set — using .env for secrets.");
        return;
    }

    try {
        const vault = await loadVault(MASTER_KEY);
        const count = Object.keys(vault.secrets).length;

        if (count === 0) {
            console.log("  🔐 Vault: initialized (empty — use vault CLI to add secrets).");
            return;
        }

        // Decrypt all secrets into memory
        for (const [name, encrypted] of Object.entries(vault.secrets)) {
            try {
                secretsCache.set(name, decrypt(encrypted, MASTER_KEY));
            } catch {
                console.error(`  ❌ Vault: failed to decrypt "${name}" — wrong master key?`);
            }
        }

        console.log(`  🔐 Vault: decrypted ${secretsCache.size} secret(s) into memory.`);
    } catch (err) {
        console.error("  ❌ Vault: failed to load —", err instanceof Error ? err.message : err);
    }
}

/**
 * Get a secret by name. Checks vault first, then falls back to env vars.
 */
export function getSecret(name: string): string | undefined {
    return secretsCache.get(name) || process.env[name] || undefined;
}

/**
 * Store a secret in the vault (encrypted at rest).
 */
export async function setSecret(name: string, value: string): Promise<void> {
    if (!MASTER_KEY) {
        throw new Error("VAULT_MASTER_KEY is not set — cannot store secrets.");
    }

    const vault = await loadVault(MASTER_KEY);
    vault.secrets[name] = encrypt(value, MASTER_KEY);
    await saveVault(vault);

    // Update in-memory cache
    secretsCache.set(name, value);
}

/**
 * Remove a secret from the vault.
 */
export async function removeSecret(name: string): Promise<boolean> {
    if (!MASTER_KEY) {
        throw new Error("VAULT_MASTER_KEY is not set.");
    }

    const vault = await loadVault(MASTER_KEY);
    if (!(name in vault.secrets)) return false;

    delete vault.secrets[name];
    await saveVault(vault);
    secretsCache.delete(name);
    return true;
}

/**
 * List all secret names (not values).
 */
export async function listSecrets(): Promise<string[]> {
    if (!MASTER_KEY) return [];
    const vault = await loadVault(MASTER_KEY);
    return Object.keys(vault.secrets);
}

/**
 * Generate a random master key (for initial setup).
 */
export function generateMasterKey(): string {
    return randomBytes(32).toString("base64url");
}

/**
 * Migrate secrets from .env to vault.
 * Reads env vars by name, encrypts them, and stores in vault.
 */
export async function migrateFromEnv(varNames: string[]): Promise<{ migrated: string[]; skipped: string[] }> {
    if (!MASTER_KEY) {
        throw new Error("VAULT_MASTER_KEY is not set.");
    }

    const migrated: string[] = [];
    const skipped: string[] = [];

    for (const name of varNames) {
        const value = process.env[name];
        if (value) {
            await setSecret(name, value);
            migrated.push(name);
        } else {
            skipped.push(name);
        }
    }

    return { migrated, skipped };
}
