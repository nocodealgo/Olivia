import { config } from "./config.js";
import { bot } from "./bot.js";
import { closeDb } from "./memory/db.js";
import { initMcp, shutdownMcp } from "./mcp/mcp-manager.js";
import { startScheduler, stopScheduler } from "./heartbeat/scheduler.js";
import { initVault } from "./security/vault.js";

// ── Decrypt secrets before anything else ─────────────
await initVault();

// ── Load plugins ─────────────────────────────────────
import { loadPlugins } from "./plugins/loader.js";
await loadPlugins();

// ── Startup ──────────────────────────────────────────

const nameLabel = `🤖 ${config.botName} is starting…`;
const pad = Math.max(0, 39 - nameLabel.length);
const left = Math.floor(pad / 2);
const right = pad - left;
console.log("┌─────────────────────────────────────────┐");
console.log(`│${" ".repeat(left + 1)}${nameLabel}${" ".repeat(right + 1)}│`);
console.log("└─────────────────────────────────────────┘");
console.log(`  Allowed users : ${[...config.allowedUserIds].join(", ")}`);
console.log(`  Max iterations: ${config.maxToolIterations}`);
console.log(`  Memory DB     : ${config.memoryDbPath}`);
console.log(`  Whisper (STT) : ${config.groqApiKey ? "✅ Groq" : "⚠️  not configured (voice won't transcribe)"}`);
console.log(`  Embeddings    : ${config.openaiApiKey ? "✅ OpenAI text-embedding-3-small" : "⚠️  not configured (no semantic search)"}`);
console.log(`  ElevenLabs TTS: ${config.elevenlabsApiKey ? "✅ configured" : "ℹ️  not configured (text-only replies)"}`);
console.log(`  Gmail         : ${process.env.GMAIL_CLIENT_ID ? "✅ configured" : "ℹ️  not configured"}`);
console.log(`  WhatsApp      : ${config.whatsappEnabled ? "✅ enabled" : "ℹ️  disabled"}`);
console.log(`  Supabase      : ${config.supabaseUrl ? "✅ enabled" : "ℹ️  disabled (local-only)"}`);
console.log(`  Timezone      : ${config.timezone}`);
const webhookPort = process.env.WEBHOOK_PORT || "3100";
const webhookBind = process.env.WEBHOOK_BIND || "127.0.0.1";
console.log(`  Webhook       : http://${webhookBind}:${webhookPort}/webhook${process.env.WEBHOOK_SECRET ? " (auth required)" : ""}`);
console.log(`  Dashboard     : http://${webhookBind}:${webhookPort}/dashboard`);
console.log(`  Canvas        : http://${webhookBind}:${webhookPort}/canvas`);
console.log(`  Mode          : Telegram long-polling (no open ports)`);
console.log();

// ── Graceful shutdown ────────────────────────────────

async function shutdown(signal: string) {
    console.log(`\n🛑 Received ${signal}. Shutting down…`);
    stopScheduler();

    // Stop event loop & recommendations
    const { stopEventLoop } = await import("./heartbeat/event-loop.js");
    stopEventLoop();
    const { stopRecommendations } = await import("./heartbeat/recommendations.js");
    stopRecommendations();

    bot.stop();

    // Stop WhatsApp if running
    if (config.whatsappEnabled) {
        const { stopWhatsApp } = await import("./whatsapp/wa-client.js");
        stopWhatsApp();
    }

    await shutdownMcp();

    // Close browser if open
    const { closeBrowser } = await import("./tools/browser.js");
    await closeBrowser().catch(() => { });

    // Stop webhook server
    const { stopWebhookServer } = await import("./webhook/server.js");
    stopWebhookServer();

    // Stop menubar
    const { stopMenuBar } = await import("./menubar/index.js");
    stopMenuBar();

    closeDb();
    process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ── Initialize MCP + models + Supabase + WhatsApp + scheduler + start ────

await initMcp();

// Load skills from /skills directory
import { loadSkills } from "./skills/loader.js";
import { resolve } from "node:path";
await loadSkills(resolve(import.meta.dirname || ".", "..", "skills"));

// Refresh model registry from OpenRouter
if (config.openRouterApiKey) {
    const { refreshModels } = await import("./llm/model-refresh.js");
    await refreshModels().catch((e: Error) =>
        console.error("  ⚠️  Model refresh error:", e.message)
    );
}

// Detect local Ollama models
{
    const { detectOllamaModels } = await import("./llm/ollama.js");
    await detectOllamaModels().catch(() => { }); // Silent if Ollama not running
}

// Initialize Supabase if configured
if (config.supabaseUrl && config.supabaseKey) {
    const { initSupabase } = await import("./memory/supabase-memory.js");
    await initSupabase().catch((e: Error) =>
        console.error("  ⚠️  Supabase init error:", e.message)
    );
}

// Start WhatsApp if enabled
if (config.whatsappEnabled) {
    const { startWhatsApp } = await import("./whatsapp/wa-client.js");
    await startWhatsApp();
}

let schedulerStarted = false;

async function startBot(attempt = 0) {
    const MAX_ATTEMPTS = 3;

    if (attempt > 0) {
        // Drop the stale Telegram getUpdates session before retrying
        try {
            await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/deleteWebhook?drop_pending_updates=true`);
            await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/getUpdates?offset=-1&timeout=1`);
        } catch { /* ignore */ }
    }

    try {
        await bot.start({
            onStart: (botInfo) => {
                console.log(`\n  ✅ Online as @${botInfo.username}`);
                console.log(`  💬 Send me a message on Telegram!\n`);
                if (!schedulerStarted) {
                    startScheduler();
                    schedulerStarted = true;

                    // Start Gmail watch if configured
                    import("./gmail/pubsub.js").then(({ startGmailWatch }) =>
                        startGmailWatch().catch(() => { })
                    ).catch(() => { });
                }
            },
        });
    } catch (err: any) {
        if (err?.error_code === 409 && attempt < MAX_ATTEMPTS) {
            console.log(`  ⚠️  Telegram: another instance detected. Clearing stale session… (attempt ${attempt + 1}/${MAX_ATTEMPTS})`);
            await new Promise((r) => setTimeout(r, 3000));
            return startBot(attempt + 1);
        } else if (err?.error_code === 409) {
            console.error("  ❌ Telegram: could not clear stale session after retries. Restart manually.");
        } else {
            throw err;
        }
    }
}

// Start webhook server (skip in air-gapped mode)
import { startWebhookServer } from "./webhook/server.js";
import { isAirGapped } from "./security/airgap.js";
if (!isAirGapped()) {
    startWebhookServer();
    // Start menu bar dashboard & voice wake
    const { startMenuBar } = await import("./menubar/index.js");
    startMenuBar();
} else {
    console.log("  ✈️  Webhook server skipped (air-gapped).");
}

// Register watchers and start event loop
import { registerWatcher, startEventLoop } from "./heartbeat/event-loop.js";
import { watchDiskSpace, watchMemory, watchSecurity, watchSecurityAuditDue } from "./heartbeat/watchers.js";
registerWatcher("disk-space", watchDiskSpace);
registerWatcher("memory", watchMemory);
registerWatcher("security", watchSecurity);
registerWatcher("security-audit", watchSecurityAuditDue);
startEventLoop();

// Start proactive recommendation engine
import { startRecommendations } from "./heartbeat/recommendations.js";
startRecommendations();

startBot();

// ── First-run: auto-start soul wizard if no soul.md ──
import { soulExists, startWizard, getCurrentPhase } from "./soul/soul-wizard.js";
if (!soulExists()) {
    setTimeout(async () => {
        try {
            const { bot } = await import("./bot.js");
            const chatId = config.ownerChatId;
            if (!chatId) return;

            const session = startWizard(chatId);
            const phase = getCurrentPhase(session)!;

            const { InlineKeyboard } = await import("grammy");
            const kb = new InlineKeyboard();
            for (const opt of phase.options) {
                kb.text(opt.label, `soul:${session.phase}:${opt.value}`).row();
            }
            kb.text("❌ Cancel", "soul:cancel");

            await bot.api.sendMessage(
                chatId,
                `👋 *Welcome! I'm your new AI assistant.*\n\nBefore we start, let's set up my personality.\n\n${phase.question}`,
                { parse_mode: "Markdown", reply_markup: kb }
            );
            console.log("  🎭 First run — soul wizard started for owner.");
        } catch (err) {
            console.error("  ⚠️  Could not auto-start soul wizard:", err instanceof Error ? err.message : err);
        }
    }, 5000);
}
