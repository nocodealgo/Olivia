import { Bot, InputFile, InlineKeyboard } from "grammy";
import { config } from "./config.js";
import { transcribeVoice } from "./voice/transcribe.js";
import { synthesizeSpeech } from "./voice/synthesize.js";
import { isTalkModeActive, toggleTalkMode, recordTalkActivity, getTalkModeStatus } from "./voice/talk-mode.js";
import {
    startWizard, cancelWizard, getWizardSession, isWizardActive,
    getCurrentPhase, setAnswer, handleCustomRequest, isComplete,
    generatePreview, saveSoul, soulExists,
    proposeSoulChange, applySoulProposal, rejectSoulProposal,
} from "./soul/soul-wizard.js";
import { getUsageReport } from "./usage/tracker.js";
import { registerAdapter, routeMessage } from "./router/message-bus.js";
import type { ChannelAdapter } from "./router/types.js";
import {
    isGroupChat, shouldRespondInGroup, isGroupAdmin,
    stripMention, getGroupSettings, updateGroupSettings,
    addGroupAdmin, removeGroupAdmin, listGroups,
} from "./groups/group-manager.js";

// ── Bot setup ────────────────────────────────────────

export const bot = new Bot(config.telegramBotToken);

// ── Telegram adapter ─────────────────────────────────

// Store ctx references for reply routing
const replyContexts = new Map<string, any>();

const telegramAdapter: ChannelAdapter = {
    async send(chatId, text, replyContext) {
        const ctx = replyContext as any;

        // Talk Mode: voice-only reply (skip text)
        if (isTalkModeActive(chatId)) {
            recordTalkActivity(chatId);
            const voiceBuffer = await synthesizeSpeech(text.slice(0, 2000));
            if (voiceBuffer) {
                await ctx.replyWithVoice(new InputFile(voiceBuffer, "reply.ogg")).catch(() => { });
                return; // voice only — no text
            }
            // TTS failed — fall through to text reply
        }

        if (text.length <= 4096) {
            await ctx.reply(text, { parse_mode: "Markdown" }).catch(() =>
                ctx.reply(text)
            );
        } else {
            const chunks = splitMessage(text, 4096);
            for (const chunk of chunks) {
                await ctx.reply(chunk, { parse_mode: "Markdown" }).catch(() =>
                    ctx.reply(chunk)
                );
            }
        }
    },

    async sendTyping(_chatId, replyContext) {
        const ctx = replyContext as any;
        await ctx.replyWithChatAction("typing");
    },
};

registerAdapter("telegram", telegramAdapter);

// ── Security middleware — user & group access ────────

bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;

    // Always allow whitelisted users
    if (userId && config.allowedUserIds.has(userId)) {
        return next();
    }

    // Allow group chats (the bot was added to the group)
    if (chatId && isGroupChat(chatId)) {
        return next();
    }

    // Block unknown DMs
    return;
});

// ── /usage command ───────────────────────────────────

bot.command("usage", async (ctx) => {
    const report = getUsageReport();
    await ctx.reply(report, { parse_mode: "Markdown" }).catch(() =>
        ctx.reply(report)
    );
});

// ── /compact command ─────────────────────────────────

bot.command("compact", async (ctx) => {
    const { sessions } = await import("./agent.js");
    const { forceCompact, getSessionTokens } = await import("./memory/context-pruner.js");

    const session = sessions.get(ctx.chat.id);
    if (!session || session.length === 0) {
        await ctx.reply("Session is empty — nothing to compact.");
        return;
    }

    await ctx.replyWithChatAction("typing");
    const result = await forceCompact(session);
    await ctx.reply(result);
});

// ── /model command ───────────────────────────────────

bot.command("model", async (ctx) => {
    const { listModels, getActiveModel, setActiveModel } = await import("./llm/models.js");
    const arg = ctx.match?.trim();

    if (!arg) {
        // Show current model and list
        const active = getActiveModel();
        const all = listModels();
        const lines = all.map((m) => {
            const marker = m.id === active.id ? "→ " : "  ";
            const tools = m.tools ? "🔧" : "💬";
            return `${marker}\`${m.id}\` — ${m.name} ${tools} ($${m.inputCost}/$${m.outputCost} per 1M tok)`;
        });
        await ctx.reply(
            `*Active model:* \`${active.id}\` (${active.name})\n\n*Available models:*\n${lines.join("\n")}\n\nUsage: \`/model <id>\` to switch`,
            { parse_mode: "Markdown" }
        ).catch(() => ctx.reply(`Active: ${active.id}\n\n${lines.join("\n")}\n\nUsage: /model <id>`));
        return;
    }

    const model = setActiveModel(arg);
    if (!model) {
        await ctx.reply(`❌ Unknown model: \`${arg}\`. Use /model to see available options.`, { parse_mode: "Markdown" });
        return;
    }

    const tools = model.tools ? "with tools 🔧" : "text-only 💬";
    await ctx.reply(`✅ Switched to *${model.name}* (${tools})`, { parse_mode: "Markdown" }).catch(() =>
        ctx.reply(`✅ Switched to ${model.name} (${tools})`)
    );
});

// ── /think command ───────────────────────────────────

bot.command("think", async (ctx) => {
    const { getThinkingLevel, setThinkingLevel, getThinkingLabel, VALID_LEVELS } = await import("./llm/thinking.js");
    const arg = ctx.match?.trim().toLowerCase();

    if (!arg) {
        const current = getThinkingLevel();
        const label = getThinkingLabel();
        const levels = VALID_LEVELS.map((l) => {
            const marker = l === current ? "→ " : "  ";
            return `${marker}\`${l}\``;
        }).join("\n");
        await ctx.reply(
            `🧠 *Thinking level:* \`${current}\` — ${label}\n\n*Available levels:*\n${levels}\n\nUsage: \`/think <level>\``,
            { parse_mode: "Markdown" }
        ).catch(() => ctx.reply(`Thinking: ${current} — ${label}\n\n${levels}`));
        return;
    }

    const config = setThinkingLevel(arg as any);
    if (!config) {
        await ctx.reply(`❌ Invalid level: \`${arg}\`. Use: ${VALID_LEVELS.join(", ")}`, { parse_mode: "Markdown" });
        return;
    }

    await ctx.reply(`🧠 Thinking set to *${arg}* — ${config.label}`, { parse_mode: "Markdown" }).catch(() =>
        ctx.reply(`🧠 Thinking: ${arg} — ${config.label}`)
    );
});

// ── /schedule command ────────────────────────────────

bot.command("schedule", async (ctx) => {
    const { listSchedules, removeSchedule, toggleSchedule } = await import("./heartbeat/schedules-db.js");
    const { formatScheduleTime } = await import("./heartbeat/cron-parser.js");
    const arg = ctx.match?.trim().toLowerCase();

    // /schedule delete <id>
    if (arg?.startsWith("delete ") || arg?.startsWith("remove ")) {
        const id = parseInt(arg.split(" ")[1]);
        if (isNaN(id)) { await ctx.reply("Usage: /schedule delete <id>"); return; }
        const removed = removeSchedule(id);
        await ctx.reply(removed ? `🗑️ Schedule #${id} deleted.` : `❌ Schedule #${id} not found.`);
        return;
    }

    // /schedule pause <id> or /schedule resume <id>
    if (arg?.startsWith("pause ") || arg?.startsWith("resume ") || arg?.startsWith("toggle ")) {
        const id = parseInt(arg.split(" ")[1]);
        if (isNaN(id)) { await ctx.reply("Usage: /schedule pause <id>"); return; }
        const toggled = toggleSchedule(id);
        await ctx.reply(toggled ? `⏯️ Schedule #${id} toggled.` : `❌ Schedule #${id} not found.`);
        return;
    }

    // Default: list all schedules
    const schedules = listSchedules();
    if (schedules.length === 0) {
        await ctx.reply(`📅 No scheduled tasks.\n\nAsk ${config.botName} to schedule something, e.g.:\n"Schedule a daily standup reminder at 9am on weekdays"`);
        return;
    }

    const lines = schedules.map((s) => {
        const status = s.enabled ? "✅" : "⏸️";
        const time = formatScheduleTime(s.cron_hour, s.cron_minute, s.days);
        return `${status} #${s.id} *${s.name}* — ${time}`;
    });

    await ctx.reply(
        `📅 *Scheduled Tasks*\n\n${lines.join("\n")}\n\n_Commands:_\n\`/schedule pause <id>\`\n\`/schedule delete <id>\``,
        { parse_mode: "Markdown" }
    ).catch(() => ctx.reply(`Scheduled Tasks:\n\n${lines.join("\n")}`));
});
// ── /menu — interactive command buttons ──────────────

function buildMainMenu(): InlineKeyboard {
    return new InlineKeyboard()
        .text("📊 Status", "cmd:status")
        .text("🗑️ New Chat", "cmd:new")
        .row()
        .text("📦 Compact", "cmd:compact")
        .text("🤖 Model", "cmd:model")
        .row()
        .text("📈 Usage", "cmd:usage")
        .text("🧠 Think", "cmd:think")
        .row()
        .text("📅 Schedules", "cmd:schedule")
        .text("❓ Help", "cmd:help");
}

bot.command("menu", async (ctx) => {
    await ctx.reply(`*${config.botName} Control Panel*`, {
        parse_mode: "Markdown",
        reply_markup: buildMainMenu(),
    });
});

bot.command("start", async (ctx) => {
    await ctx.reply(
        `👋 Hey! I'm *${config.botName}*. Send me a message or use the menu below.`,
        { parse_mode: "Markdown", reply_markup: buildMainMenu() }
    );
});

// ── Callback query handlers (button presses) ─────────

bot.callbackQuery("cmd:status", async (ctx) => {
    const { parseCommand } = await import("./router/commands.js");
    const result = await parseCommand("/status", ctx.chat!.id);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(result.reply || "No data", { parse_mode: "Markdown", reply_markup: buildMainMenu() })
        .catch(() => ctx.reply(result.reply || "No data"));
});

bot.callbackQuery("cmd:new", async (ctx) => {
    const { parseCommand } = await import("./router/commands.js");
    const result = await parseCommand("/new", ctx.chat!.id);
    await ctx.answerCallbackQuery({ text: "Conversation cleared!" });
    await ctx.editMessageText(result.reply || "Done", { parse_mode: "Markdown", reply_markup: buildMainMenu() })
        .catch(() => ctx.reply(result.reply || "Done"));
});

bot.callbackQuery("cmd:compact", async (ctx) => {
    const { parseCommand } = await import("./router/commands.js");
    await ctx.answerCallbackQuery({ text: "Compacting…" });
    const result = await parseCommand("/compact", ctx.chat!.id);
    await ctx.editMessageText(result.reply || "Done", { parse_mode: "Markdown", reply_markup: buildMainMenu() })
        .catch(() => ctx.reply(result.reply || "Done"));
});

bot.callbackQuery("cmd:model", async (ctx) => {
    // Show model suggestions by use case + full list
    const { listModels, getActiveModel } = await import("./llm/models.js");
    const active = getActiveModel();
    const all = listModels();
    const kb = new InlineKeyboard();

    // Use-case recommendations
    const suggestions: { emoji: string; label: string; modelId: string; desc: string }[] = [
        { emoji: "⚡", label: "Quick tasks", modelId: "claude-haiku", desc: "Fast & cheap" },
        { emoji: "🧠", label: "Deep thinking", modelId: "claude-opus", desc: "Best reasoning" },
        { emoji: "✍️", label: "Writing & code", modelId: "claude-sonnet", desc: "Balanced" },
        { emoji: "💰", label: "Budget", modelId: "gemini-pro", desc: "$0.10/M input" },
        { emoji: "🌐", label: "GPT alternative", modelId: "gpt-4o", desc: "OpenAI flagship" },
        { emoji: "🔬", label: "Research", modelId: "deepseek", desc: "Strong & affordable" },
    ];

    const suggestionLines = suggestions.map((s) => {
        const check = s.modelId === active.id ? "→ " : "  ";
        return `${check}${s.emoji} *${s.label}*: ${s.desc}`;
    });

    // Suggestion buttons (top rows)
    for (let i = 0; i < suggestions.length; i++) {
        const s = suggestions[i];
        const prefix = s.modelId === active.id ? "✅ " : "";
        kb.text(`${prefix}${s.emoji} ${s.label}`, `model:${s.modelId}`);
        if (i % 2 === 1) kb.row();
    }

    kb.row();
    kb.text("── All Models ──", "cmd:model_all");
    kb.row().text("« Back", "cmd:back");

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
        `🤖 *Pick a model for the task*\n\n` +
        `${suggestionLines.join("\n")}\n\n` +
        `_Active: \`${active.id}\`_`,
        { parse_mode: "Markdown", reply_markup: kb }
    ).catch(() => { });
});

bot.callbackQuery("cmd:model_all", async (ctx) => {
    const { listModels, getActiveModel } = await import("./llm/models.js");
    const active = getActiveModel();
    const all = listModels();
    const kb = new InlineKeyboard();
    for (let i = 0; i < all.length; i++) {
        const m = all[i];
        const label = m.id === active.id ? `✅ ${m.name}` : m.name;
        kb.text(label, `model:${m.id}`);
        if (i % 2 === 1) kb.row();
    }
    kb.row().text("« Back", "cmd:model");
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`*All Models*\n\n_Active: \`${active.id}\`_\n\nTap to switch:`, {
        parse_mode: "Markdown", reply_markup: kb,
    }).catch(() => { });
});

bot.callbackQuery(/^model:/, async (ctx) => {
    const modelId = ctx.callbackQuery.data.slice("model:".length);
    const { setActiveModel } = await import("./llm/models.js");
    const model = setActiveModel(modelId);
    if (!model) {
        await ctx.answerCallbackQuery({ text: "Unknown model" });
        return;
    }
    const tools = model.tools ? "with tools 🔧" : "text-only 💬";
    await ctx.answerCallbackQuery({ text: `Switched to ${model.name}` });
    await ctx.editMessageText(`✅ *${model.name}* (${tools})`, {
        parse_mode: "Markdown", reply_markup: buildMainMenu(),
    }).catch(() => { });
});

bot.callbackQuery("cmd:usage", async (ctx) => {
    const { parseCommand } = await import("./router/commands.js");
    const result = await parseCommand("/usage", ctx.chat!.id);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(result.reply || "No usage data", { parse_mode: "Markdown", reply_markup: buildMainMenu() })
        .catch(() => ctx.reply(result.reply || "No data"));
});

bot.callbackQuery("cmd:think", async (ctx) => {
    const { getThinkingLevel, VALID_LEVELS } = await import("./llm/thinking.js");
    const current = getThinkingLevel();
    const kb = new InlineKeyboard();
    for (const level of VALID_LEVELS) {
        const label = level === current ? `✅ ${level}` : level;
        kb.text(label, `think:${level}`);
    }
    kb.row().text("« Back", "cmd:back");
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`🧠 *Thinking level:* \`${current}\`\n\nTap to change:`, {
        parse_mode: "Markdown", reply_markup: kb,
    }).catch(() => { });
});

bot.callbackQuery(/^think:/, async (ctx) => {
    const level = ctx.callbackQuery.data.slice("think:".length);
    const { setThinkingLevel } = await import("./llm/thinking.js");
    const result = setThinkingLevel(level as any);
    if (!result) {
        await ctx.answerCallbackQuery({ text: "Invalid level" });
        return;
    }
    await ctx.answerCallbackQuery({ text: `Thinking: ${level}` });
    await ctx.editMessageText(`🧠 Thinking set to *${level}* — ${result.label}`, {
        parse_mode: "Markdown", reply_markup: buildMainMenu(),
    }).catch(() => { });
});

bot.callbackQuery("cmd:schedule", async (ctx) => {
    const { listSchedules } = await import("./heartbeat/schedules-db.js");
    const { formatScheduleTime } = await import("./heartbeat/cron-parser.js");
    const schedules = listSchedules();
    await ctx.answerCallbackQuery();
    if (schedules.length === 0) {
        await ctx.editMessageText(`📅 No scheduled tasks.`, {
            reply_markup: buildMainMenu(),
        }).catch(() => { });
        return;
    }
    const lines = schedules.map((s) => {
        const status = s.enabled ? "✅" : "⏸️";
        const time = formatScheduleTime(s.cron_hour, s.cron_minute, s.days);
        return `${status} #${s.id} *${s.name}* — ${time}`;
    });
    await ctx.editMessageText(`📅 *Schedules*\n\n${lines.join("\n")}`, {
        parse_mode: "Markdown",
        reply_markup: new InlineKeyboard().text("« Back", "cmd:back"),
    }).catch(() => { });
});

bot.callbackQuery("cmd:help", async (ctx) => {
    const { parseCommand } = await import("./router/commands.js");
    const result = await parseCommand("/help", ctx.chat!.id);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(result.reply || "No help", { parse_mode: "Markdown", reply_markup: buildMainMenu() })
        .catch(() => { });
});

bot.callbackQuery("cmd:back", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`*${config.botName} Control Panel*`, {
        parse_mode: "Markdown", reply_markup: buildMainMenu(),
    }).catch(() => { });
});

// ── /group command ── admin-only group settings ──────

bot.command("group", async (ctx) => {
    const chatId = ctx.chat.id;
    if (!isGroupChat(chatId)) {
        await ctx.reply("This command only works in group chats.");
        return;
    }

    if (!ctx.from || !isGroupAdmin(chatId, ctx.from.id)) {
        await ctx.reply("⛔ Only group admins can manage settings.");
        return;
    }

    const arg = ctx.match?.trim().toLowerCase();

    if (!arg) {
        const settings = getGroupSettings(chatId, ctx.chat.title);
        const admins: number[] = JSON.parse(settings.admins || "[]");
        await ctx.reply(
            `⚙️ *Group Settings*\n\n` +
            `Mode: \`${settings.respond_mode}\`\n` +
            `Enabled: ${settings.enabled ? "✅" : "❌"}\n` +
            `Admins: ${admins.length > 0 ? admins.join(", ") : "(owner only)"}\n\n` +
            `_Commands:_\n` +
            `\`/group mode mention\` — respond only when @mentioned\n` +
            `\`/group mode always\` — respond to every message\n` +
            `\`/group mode never\` — silent in this group\n` +
            `\`/group admin add <userId>\`\n` +
            `\`/group admin rm <userId>\`\n` +
            `\`/group enable\` / \`/group disable\``,
            { parse_mode: "Markdown" }
        ).catch(() => ctx.reply("Use: /group mode <mention|always|never>"));
        return;
    }

    if (arg.startsWith("mode ")) {
        const mode = arg.slice(5).trim();
        if (!["mention", "always", "never"].includes(mode)) {
            await ctx.reply("Modes: `mention`, `always`, `never`", { parse_mode: "Markdown" });
            return;
        }
        updateGroupSettings(chatId, { respond_mode: mode as any });
        await ctx.reply(`✅ Response mode set to \`${mode}\``, { parse_mode: "Markdown" });
        return;
    }

    if (arg.startsWith("admin add ")) {
        const uid = parseInt(arg.slice(10).trim());
        if (isNaN(uid)) { await ctx.reply("Usage: /group admin add <userId>"); return; }
        addGroupAdmin(chatId, uid);
        await ctx.reply(`✅ User ${uid} added as admin.`);
        return;
    }

    if (arg.startsWith("admin rm ") || arg.startsWith("admin remove ")) {
        const uid = parseInt(arg.replace(/^admin (rm|remove)\s+/, "").trim());
        if (isNaN(uid)) { await ctx.reply("Usage: /group admin rm <userId>"); return; }
        removeGroupAdmin(chatId, uid);
        await ctx.reply(`✅ User ${uid} removed as admin.`);
        return;
    }

    if (arg === "enable") {
        updateGroupSettings(chatId, { enabled: 1 });
        await ctx.reply(`✅ ${config.botName} enabled in this group.`);
        return;
    }

    if (arg === "disable") {
        updateGroupSettings(chatId, { enabled: 0 });
        await ctx.reply(`⏸️ ${config.botName} disabled in this group.`);
        return;
    }

    await ctx.reply("Unknown subcommand. Use /group for help.");
});

// ── /talk command — toggle Talk Mode ─────────────────

bot.command("talk", async (ctx) => {
    if (!config.elevenlabsApiKey) {
        await ctx.reply("🎙️ Talk Mode requires ElevenLabs TTS. Set ELEVENLABS_API_KEY in .env");
        return;
    }
    if (!config.groqApiKey) {
        await ctx.reply("🎙️ Talk Mode requires Whisper STT. Set GROQ_API_KEY in .env");
        return;
    }

    const active = toggleTalkMode(ctx.chat.id);
    if (active) {
        await ctx.reply(
            `🎙️ *Talk Mode ON*\n\nSend voice messages and I'll reply with voice!\n\nSay /talk again or wait 10min to exit.`,
            { parse_mode: "Markdown" }
        ).catch(() => ctx.reply("🎙️ Talk Mode ON! Send voice messages."));
    } else {
        await ctx.reply("🔇 Talk Mode OFF. Back to text replies.");
    }
});

// ── /soul command — personality wizard ────────────────

bot.command("soul", async (ctx) => {
    const chatId = ctx.chat.id;
    const session = startWizard(chatId);
    const phase = getCurrentPhase(session)!;
    const kb = buildSoulKeyboard(session.phase);
    await ctx.reply(phase.question, { parse_mode: "Markdown", reply_markup: kb }).catch(() => { });
});

function buildSoulKeyboard(phaseNum: number): InlineKeyboard {
    const session: any = { phase: phaseNum, awaitingCustom: false, answers: {} };
    const phaseConfig = getCurrentPhase(session as any);
    if (!phaseConfig) return new InlineKeyboard();

    const kb = new InlineKeyboard();
    for (const opt of phaseConfig.options) {
        kb.text(opt.label, `soul:${phaseNum}:${opt.value}`).row();
    }
    kb.text("❌ Cancel", "soul:cancel");
    return kb;
}

// Soul wizard callbacks
bot.callbackQuery(/^soul:cancel$/, async (ctx) => {
    cancelWizard(ctx.chat!.id);
    await ctx.answerCallbackQuery({ text: "Wizard cancelled" });
    await ctx.editMessageText("🚫 Soul wizard cancelled. Run /soul anytime to start again.").catch(() => { });
});

bot.callbackQuery(/^soul:\d+:/, async (ctx) => {
    const chatId = ctx.chat!.id;
    const session = getWizardSession(chatId);
    if (!session) {
        await ctx.answerCallbackQuery({ text: "No active wizard" });
        return;
    }

    const data = ctx.callbackQuery.data; // soul:1:value
    const parts = data.split(":");
    const value = parts.slice(2).join(":"); // rejoin in case value has colons

    if (value === "__custom__") {
        handleCustomRequest(session);
        await ctx.answerCallbackQuery();
        await ctx.editMessageText("✏️ Type your custom answer:").catch(() => { });
        return;
    }

    setAnswer(session, value);
    await ctx.answerCallbackQuery();

    if (isComplete(session)) {
        // Show preview
        const preview = generatePreview(session.answers);
        const kb = new InlineKeyboard()
            .text("✅ Save", "soul:save").text("🔄 Start Over", "soul:restart").row()
            .text("❌ Cancel", "soul:cancel");
        await ctx.editMessageText(preview, { parse_mode: "Markdown", reply_markup: kb }).catch(() => { });
    } else {
        const phase = getCurrentPhase(session)!;
        const kb = buildSoulKeyboard(session.phase);
        await ctx.editMessageText(phase.question, { parse_mode: "Markdown", reply_markup: kb }).catch(() => { });
    }
});

bot.callbackQuery("soul:save", async (ctx) => {
    const chatId = ctx.chat!.id;
    const session = getWizardSession(chatId);
    if (!session) { await ctx.answerCallbackQuery({ text: "No wizard" }); return; }

    saveSoul(session.answers);
    cancelWizard(chatId);
    await ctx.answerCallbackQuery({ text: "Saved!" });
    await ctx.editMessageText(
        `✅ *Soul saved!*\n\nI've written \`soul.md\`. My new personality takes effect on next restart.\n\nRun /soul anytime to change it.`,
        { parse_mode: "Markdown" }
    ).catch(() => { });
});

bot.callbackQuery("soul:restart", async (ctx) => {
    const chatId = ctx.chat!.id;
    const session = startWizard(chatId);
    const phase = getCurrentPhase(session)!;
    const kb = buildSoulKeyboard(session.phase);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(phase.question, { parse_mode: "Markdown", reply_markup: kb }).catch(() => { });
});

// Soul proposal approve/reject
bot.callbackQuery(/^soul:approve:/, async (ctx) => {
    const proposalId = ctx.callbackQuery.data.slice("soul:approve:".length);
    const result = applySoulProposal(proposalId);
    await ctx.answerCallbackQuery({ text: result.applied ? "Applied!" : result.reason });
    if (result.applied) {
        await ctx.editMessageText(
            "✅ *Soul updated!* The personality change has been applied. It takes effect on next restart.",
            { parse_mode: "Markdown" }
        ).catch(() => { });
    } else {
        await ctx.editMessageText(`❌ Could not apply: ${result.reason}`).catch(() => { });
    }
});

bot.callbackQuery(/^soul:reject:/, async (ctx) => {
    const proposalId = ctx.callbackQuery.data.slice("soul:reject:".length);
    rejectSoulProposal(proposalId);
    await ctx.answerCallbackQuery({ text: "Rejected" });
    await ctx.editMessageText("❌ Soul change rejected. No changes made.").catch(() => { });
});

// ── Text message handler ─────────────────────────────

bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text;

    // ── Soul wizard text interceptor ──
    if (isWizardActive(chatId)) {
        const session = getWizardSession(chatId)!;
        if (session.awaitingCustom) {
            setAnswer(session, text);
            if (isComplete(session)) {
                const preview = generatePreview(session.answers);
                const kb = new InlineKeyboard()
                    .text("✅ Save", "soul:save").text("🔄 Start Over", "soul:restart").row()
                    .text("❌ Cancel", "soul:cancel");
                await ctx.reply(preview, { parse_mode: "Markdown", reply_markup: kb }).catch(() => { });
            } else {
                const phase = getCurrentPhase(session)!;
                const kb = buildSoulKeyboard(session.phase);
                await ctx.reply(phase.question, { parse_mode: "Markdown", reply_markup: kb }).catch(() => { });
            }
            return;
        }
        // Phase 1 (name) also accepts free text
        if (session.phase === 1) {
            setAnswer(session, text);
            const phase = getCurrentPhase(session)!;
            const kb = buildSoulKeyboard(session.phase);
            await ctx.reply(phase.question, { parse_mode: "Markdown", reply_markup: kb }).catch(() => { });
            return;
        }
    }

    const botInfo = await bot.api.getMe();

    // ── Group chat filtering ──
    if (isGroupChat(chatId)) {
        // Track the group
        getGroupSettings(chatId, (ctx.chat as any).title);

        // Check if bot was replied to
        const isReplyToBot = ctx.message.reply_to_message?.from?.id === botInfo.id;

        // Admin-only commands in groups
        if (text.trim().startsWith("/")) {
            if (!isGroupAdmin(chatId, ctx.from.id)) {
                // Silently ignore commands from non-admins
                return;
            }
        }

        // Check if we should respond
        if (!shouldRespondInGroup(chatId, text, isReplyToBot, botInfo.username)) {
            return;
        }

        // Strip @mention for clean LLM input
        const cleanText = stripMention(text, botInfo.username);

        await routeMessage({
            channel: "telegram",
            chatId,
            senderName: ctx.from.first_name,
            text: cleanText,
            replyContext: ctx,
        });
        return;
    }

    // ── DM (direct message) — normal handling ──
    await routeMessage({
        channel: "telegram",
        chatId,
        senderName: ctx.from.first_name,
        text,
        replyContext: ctx,
    });
});

// ── Voice message handler ────────────────────────────

bot.on("message:voice", async (ctx) => {
    const chatId = ctx.chat.id;
    const talkActive = isTalkModeActive(chatId);

    await ctx.replyWithChatAction(talkActive ? "record_voice" : "typing");

    try {
        const file = await ctx.getFile();
        const fileUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;

        const transcription = await transcribeVoice(fileUrl);

        if (!transcription) {
            await ctx.reply("🎤 I received your voice message but can't transcribe it — Groq API key is not configured.");
            return;
        }

        // In Talk Mode, show a subtle transcription preview
        if (talkActive) {
            recordTalkActivity(chatId);
            await ctx.reply(`🎤 _"${transcription.slice(0, 100)}${transcription.length > 100 ? "…" : ""}"_`, {
                parse_mode: "Markdown",
            }).catch(() => { });
        }

        await routeMessage({
            channel: "telegram",
            chatId,
            senderName: ctx.from.first_name,
            text: transcription,
            replyContext: ctx,
        });
    } catch (err) {
        console.error("  ❌ [telegram] Voice error:", err instanceof Error ? err.message : err);
        await ctx.reply("Something went wrong processing your voice message.");
    }
});

// ── Photo handler ────────────────────────────────────

bot.on("message:photo", async (ctx) => {
    await ctx.replyWithChatAction("typing");

    try {
        const { processImage } = await import("./memory/multimodal.js");
        const photos = ctx.message.photo;
        const largest = photos[photos.length - 1];
        const file = await ctx.api.getFile(largest.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;

        const response = await fetch(fileUrl);
        const buffer = Buffer.from(await response.arrayBuffer());
        const caption = ctx.message.caption || undefined;

        const description = await processImage(buffer, ctx.chat.id, file.file_path, caption);

        await routeMessage({
            channel: "telegram",
            chatId: ctx.chat.id,
            senderName: ctx.from.first_name,
            text: caption ? `[Sent an image: "${caption}"] ${description}` : `[Sent an image] ${description}`,
            replyContext: ctx,
        });
    } catch (err) {
        console.error("  ❌ [telegram] Photo error:", err instanceof Error ? err.message : err);
        await ctx.reply("Something went wrong processing your image.");
    }
});

// ── Document handler ─────────────────────────────────

bot.on("message:document", async (ctx) => {
    await ctx.replyWithChatAction("typing");

    try {
        const { processDocument } = await import("./memory/multimodal.js");
        const doc = ctx.message.document;
        const file = await ctx.api.getFile(doc.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;

        const response = await fetch(fileUrl);
        const buffer = Buffer.from(await response.arrayBuffer());

        const description = await processDocument(buffer, ctx.chat.id, doc.file_name, doc.mime_type);

        await routeMessage({
            channel: "telegram",
            chatId: ctx.chat.id,
            senderName: ctx.from.first_name,
            text: `[Sent document: ${doc.file_name}] ${description}`,
            replyContext: ctx,
        });
    } catch (err) {
        console.error("  ❌ [telegram] Document error:", err instanceof Error ? err.message : err);
        await ctx.reply("Something went wrong processing your document.");
    }
});

// ── Video handler ────────────────────────────────────

bot.on("message:video", async (ctx) => {
    await ctx.replyWithChatAction("typing");

    try {
        const { processVideo } = await import("./memory/multimodal.js");
        const video = ctx.message.video;
        const file = await ctx.api.getFile(video.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;

        const response = await fetch(fileUrl);
        const buffer = Buffer.from(await response.arrayBuffer());
        const caption = ctx.message.caption || undefined;

        const description = await processVideo(buffer, ctx.chat.id, video.file_name, caption);

        await routeMessage({
            channel: "telegram",
            chatId: ctx.chat.id,
            senderName: ctx.from.first_name,
            text: caption ? `[Sent video: "${caption}"] ${description}` : `[Sent video] ${description}`,
            replyContext: ctx,
        });
    } catch (err) {
        console.error("  ❌ [telegram] Video error:", err instanceof Error ? err.message : err);
        await ctx.reply("Something went wrong processing your video.");
    }
});

// ── Helpers ──────────────────────────────────────────

function splitMessage(text: string, maxLen: number): string[] {
    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > maxLen) {
        let splitIdx = remaining.lastIndexOf("\n", maxLen);
        if (splitIdx === -1) splitIdx = maxLen;

        chunks.push(remaining.slice(0, splitIdx));
        remaining = remaining.slice(splitIdx).trimStart();
    }

    if (remaining.length > 0) chunks.push(remaining);
    return chunks;
}
