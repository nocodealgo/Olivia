import OpenAI from "openai";
import { config } from "../config.js";

// ── Groq Whisper client ──────────────────────────────

let client: OpenAI | null = null;

function getClient(): OpenAI | null {
    if (!config.groqApiKey) return null;
    if (!client) {
        client = new OpenAI({
            apiKey: config.groqApiKey,
            baseURL: "https://api.groq.com/openai/v1",
        });
    }
    return client;
}

/**
 * Download a Telegram voice file and transcribe it with Whisper via Groq.
 * Returns the transcribed text, or null if Groq is not configured.
 */
export async function transcribeVoice(fileUrl: string): Promise<string | null> {
    const whisper = getClient();
    if (!whisper) {
        console.warn("⚠️  GROQ_API_KEY not set — cannot transcribe voice.");
        return null;
    }

    // Download the voice file from Telegram
    const response = await fetch(fileUrl);
    if (!response.ok) {
        throw new Error(`Failed to download voice file: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Create a File object for the OpenAI-compatible SDK
    const file = new File([buffer], "voice.ogg", { type: "audio/ogg" });

    // Transcribe with Whisper via Groq (faster + free tier)
    const transcription = await whisper.audio.transcriptions.create({
        model: "whisper-large-v3-turbo",
        file,
        response_format: "text",
    });

    return (transcription as unknown as string).trim();
}

/**
 * Transcribe audio from a Buffer (for web Talk Mode / direct uploads).
 * Returns the transcribed text, or null if Groq is not configured.
 */
export async function transcribeBuffer(
    buffer: Buffer,
    filename = "audio.webm",
    mimeType = "audio/webm",
): Promise<string | null> {
    const whisper = getClient();
    if (!whisper) {
        console.warn("⚠️  GROQ_API_KEY not set — cannot transcribe audio.");
        return null;
    }

    const file = new File([new Uint8Array(buffer)], filename, { type: mimeType });

    const transcription = await whisper.audio.transcriptions.create({
        model: "whisper-large-v3-turbo",
        file,
        response_format: "text",
    });

    return (transcription as unknown as string).trim();
}

