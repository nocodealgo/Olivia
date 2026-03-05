import { readFileSync } from "fs";

/**
 * Giorgio Deployment Switcher
 *
 * Usage:
 *   npm run switch local      — Telegram → local (full tools)
 *   npm run switch cloud      — Telegram → Cloudflare Workers (always-on)
 *   npm run switch status     — Show current mode
 */

const WORKER_URL = process.env.WORKER_URL || "https://giorgio.pa-dehoyos.workers.dev";
const command = process.argv[2]?.toLowerCase();

// Resolve bot token
let token = process.env.TELEGRAM_BOT_TOKEN || "";
if (!token) {
    try {
        const env = readFileSync(".env", "utf-8");
        const match = env.match(/TELEGRAM_BOT_TOKEN=(.+)/);
        if (match) token = match[1].trim();
    } catch { /* ignore */ }
}

if (!token) {
    console.error("❌ TELEGRAM_BOT_TOKEN not found in .env or environment");
    process.exit(1);
}

const api = `https://api.telegram.org/bot${token}`;

if (command === "local") {
    await switchToLocal();
} else if (command === "cloud" || command === "cf" || command === "edge") {
    await switchToCloud();
} else if (command === "status") {
    await showStatus();
} else {
    console.log(`
🔄 Giorgio Deployment Switcher

Usage:
  npm run switch local     Switch Telegram → local (full tools)
  npm run switch cloud     Switch Telegram → Cloudflare Workers
  npm run switch status    Show current deployment mode

Aliases: cloud = cf = edge
`);
}

async function switchToLocal() {
    console.log("🏠 Switching Telegram → Local...\n");
    const res = await fetch(`${api}/deleteWebhook`);
    const data = await res.json() as any;
    if (data.ok) {
        console.log("  ✅ Telegram → LOCAL (long-polling)");
        console.log("  🔧 Full tool access: shell, files, browser, MCP");
        console.log("  ⚠️  Make sure 'npm run dev' is running!");
    } else {
        console.error("  ❌ Failed:", data.description);
    }
}

async function switchToCloud() {
    const webhookUrl = `${WORKER_URL}/webhook/telegram`;
    console.log("☁️  Switching Telegram → Cloudflare Workers...\n");
    const res = await fetch(`${api}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
    const data = await res.json() as any;
    if (data.ok) {
        console.log("  ✅ Telegram → CLOUDFLARE WORKERS");
        console.log(`  🌍 Webhook: ${webhookUrl}`);
        console.log("  💤 You can close your Mac — Giorgio stays online.");
    } else {
        console.error("  ❌ Failed:", data.description);
    }
}

async function showStatus() {
    console.log("📊 Giorgio Deployment Status\n");

    // Telegram mode
    const whRes = await fetch(`${api}/getWebhookInfo`);
    const whData = await whRes.json() as any;
    const webhookUrl = whData.result?.url || "";
    const isCloud = !!webhookUrl;
    console.log(`  Telegram    : ${isCloud ? "☁️  CLOUD (webhook)" : "🏠 LOCAL (long-polling)"}`);
    if (webhookUrl) console.log(`  Webhook URL : ${webhookUrl}`);

    // Local health
    try {
        const r = await fetch("http://localhost:3100/health", { signal: AbortSignal.timeout(2000) });
        const d = await r.json() as any;
        console.log(`  Local       : ✅ running (${Math.round(d.uptime)}s uptime)`);
    } catch {
        console.log("  Local       : ❌ down");
    }

    // Cloudflare health
    try {
        const r = await fetch(`${WORKER_URL}/health`, { signal: AbortSignal.timeout(5000) });
        const d = await r.json() as any;
        console.log(`  Cloudflare  : ✅ running (${d.runtime})`);
    } catch {
        console.log("  Cloudflare  : ❌ down");
    }

    console.log();
}
