import "dotenv/config";

interface Config {
    /** Bot display name (changeable in .env) */
    botName: string;
    /** Telegram bot token from @BotFather */
    telegramBotToken: string;
    /** Anthropic API key */
    anthropicApiKey: string;
    /** OpenRouter API key (optional, for future use) */
    openRouterApiKey: string | undefined;
    /** OpenAI API key (optional, for future use) */
    openaiApiKey: string | undefined;
    /** Groq API key for Whisper transcription (optional) */
    groqApiKey: string | undefined;
    /** ElevenLabs API key for TTS (optional — text fallback if missing) */
    elevenlabsApiKey: string | undefined;
    /** ElevenLabs voice ID */
    elevenlabsVoiceId: string;
    /** Set of Telegram user IDs allowed to interact */
    allowedUserIds: Set<number>;
    /** Max tool-call iterations per message (safety limit) */
    maxToolIterations: number;
    /** Path to the SQLite memory database */
    memoryDbPath: string;
    /** Chat ID to send proactive messages to */
    ownerChatId: number;
    /** IANA timezone for schedule evaluation */
    timezone: string;
    /** WhatsApp enabled */
    whatsappEnabled: boolean;
    /**
     * WhatsApp permission mode:
     *   self_only  — only respond in your own chat (default, most private)
     *   allowlist  — respond to self + numbers in ALLOWED_WA_NUMBERS
     *   everyone   — respond to all private chats (no groups unless allowed)
     */
    waMode: "self_only" | "allowlist" | "everyone";
    /** Allow groups? If true, also checks allowedWaGroups. */
    waAllowGroups: boolean;
    /** Allowed WhatsApp phone numbers (without @s.whatsapp.net) */
    allowedWaNumbers: Set<string>;
    /** Allowed WhatsApp group JIDs (the full @g.us id) */
    allowedWaGroups: Set<string>;
    /** Path to WhatsApp session credentials */
    waSessionPath: string;
    /** Supabase URL (optional — cloud memory backend) */
    supabaseUrl: string | undefined;
    /** Supabase service role key */
    supabaseKey: string | undefined;
}

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        console.error(`❌ Missing required env var: ${name}`);
        console.error(`   Copy .env.example → .env and fill in your values.`);
        process.exit(1);
    }
    return value;
}

function parseUserIds(raw: string): Set<number> {
    const ids = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number);

    if (ids.some(isNaN)) {
        console.error(`❌ ALLOWED_USER_IDS must be comma-separated numbers.`);
        process.exit(1);
    }

    if (ids.length === 0) {
        console.error(`❌ ALLOWED_USER_IDS must contain at least one user ID.`);
        process.exit(1);
    }

    return new Set(ids);
}

export const config: Config = {
    botName: process.env.BOT_NAME || "Olivia",
    telegramBotToken: requireEnv("TELEGRAM_BOT_TOKEN"),
    anthropicApiKey: requireEnv("ANTHROPIC_API_KEY"),
    openRouterApiKey: process.env.OPENROUTER_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    groqApiKey: process.env.GROQ_API_KEY,
    elevenlabsApiKey: process.env.ELEVENLABS_API_KEY,
    elevenlabsVoiceId: process.env.ELEVENLABS_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb",
    allowedUserIds: parseUserIds(requireEnv("ALLOWED_USER_IDS")),
    maxToolIterations: parseInt(process.env.MAX_TOOL_ITERATIONS ?? "10", 10),
    memoryDbPath: process.env.MEMORY_DB_PATH ?? "./giorgio.db",
    ownerChatId: parseInt(process.env.OWNER_CHAT_ID ?? requireEnv("ALLOWED_USER_IDS").split(",")[0], 10),
    timezone: process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    whatsappEnabled: process.env.WHATSAPP_ENABLED === "true",
    waMode: (process.env.WA_MODE as any) || "self_only",
    waAllowGroups: process.env.WA_ALLOW_GROUPS === "true",
    allowedWaNumbers: new Set(
        (process.env.ALLOWED_WA_NUMBERS ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
    ),
    allowedWaGroups: new Set(
        (process.env.ALLOWED_WA_GROUPS ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
    ),
    waSessionPath: process.env.WA_SESSION_PATH ?? "./wa-session",
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_SERVICE_KEY,
};
