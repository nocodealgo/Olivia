import { config } from "../config.js";

/**
 * Synthesize text to speech using ElevenLabs.
 * Returns an OGG audio Buffer, or null if ElevenLabs is not configured.
 */
export async function synthesizeSpeech(
    text: string
): Promise<Buffer | null> {
    if (!config.elevenlabsApiKey) {
        return null; // Graceful fallback — no voice reply
    }

    const voiceId = config.elevenlabsVoiceId;
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "xi-api-key": config.elevenlabsApiKey,
        },
        body: JSON.stringify({
            text,
            model_id: "eleven_multilingual_v2",
            output_format: "ogg_opus",
            voice_settings: {
                stability: 0.5,
                similarity_boost: 0.75,
                style: 0.0,
                use_speaker_boost: true,
            },
        }),
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => "unknown error");
        console.error(`❌ ElevenLabs TTS error: ${response.status} - ${errorText}`);
        return null; // Fallback to text
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}
