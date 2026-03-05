/**
 * Gmail OAuth2 Authentication
 *
 * Handles OAuth2 flow for Gmail API access.
 * Tokens are persisted to disk for reuse across restarts.
 */

import { google } from "googleapis";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "node:http";

// ── Config ───────────────────────────────────────────

const SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.modify",
];

const TOKEN_PATH = resolve(process.cwd(), ".gmail-token.json");

// ── OAuth2 Client ────────────────────────────────────

let oauth2Client: InstanceType<typeof google.auth.OAuth2> | null = null;

function getCredentials() {
    const clientId = process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET;
    const redirectUri = process.env.GMAIL_REDIRECT_URI || "http://localhost:3100/gmail/callback";

    if (!clientId || !clientSecret) return null;
    return { clientId, clientSecret, redirectUri };
}

export function getOAuth2Client(): InstanceType<typeof google.auth.OAuth2> | null {
    if (oauth2Client) return oauth2Client;

    const creds = getCredentials();
    if (!creds) return null;

    oauth2Client = new google.auth.OAuth2(
        creds.clientId,
        creds.clientSecret,
        creds.redirectUri,
    );

    // Load stored token
    if (existsSync(TOKEN_PATH)) {
        try {
            const token = JSON.parse(readFileSync(TOKEN_PATH, "utf-8"));
            oauth2Client.setCredentials(token);

            // Auto-refresh
            oauth2Client.on("tokens", (newTokens) => {
                const merged = { ...token, ...newTokens };
                writeFileSync(TOKEN_PATH, JSON.stringify(merged, null, 2));
                console.log("  📧 Gmail: token refreshed");
            });
        } catch {
            console.warn("  ⚠️  Gmail: invalid token file, re-auth required");
        }
    }

    return oauth2Client;
}

/**
 * Generate the OAuth2 authorization URL.
 */
export function getAuthUrl(): string | null {
    const client = getOAuth2Client();
    if (!client) return null;

    return client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: SCOPES,
    });
}

/**
 * Exchange authorization code for tokens and persist.
 */
export async function handleAuthCallback(code: string): Promise<boolean> {
    const client = getOAuth2Client();
    if (!client) return false;

    try {
        const { tokens } = await client.getToken(code);
        client.setCredentials(tokens);
        writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
        console.log("  ✅ Gmail: authenticated successfully");
        return true;
    } catch (err) {
        console.error("  ❌ Gmail: auth callback error:", err);
        return false;
    }
}

/**
 * Check if Gmail is authenticated and ready.
 */
export function isGmailReady(): boolean {
    const client = getOAuth2Client();
    if (!client) return false;
    const creds = client.credentials;
    return !!(creds && creds.access_token);
}
