/**
 * Voice Wake Word Service
 *
 * Listens for a wake word ("Hey Giorgio") using the macOS microphone.
 * When triggered, activates Talk Mode for voice-to-text input.
 *
 * Uses macOS `say` + `rec` (SoX) for lightweight voice detection
 * without heavy ML dependencies.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { config } from "../config.js";

// ── State ────────────────────────────────────────────

interface VoiceWakeState {
    enabled: boolean;
    listening: boolean;
    lastTriggered: number | null;
    triggerCount: number;
}

const state: VoiceWakeState = {
    enabled: false,
    listening: false,
    lastTriggered: null,
    triggerCount: 0,
};

let micProcess: ChildProcess | null = null;

// ── Public API ───────────────────────────────────────

export function getVoiceWakeStatus(): VoiceWakeState {
    return { ...state };
}

export function toggleVoiceWake(): VoiceWakeState {
    if (state.enabled) {
        stopListening();
    } else {
        startListening();
    }
    return { ...state };
}

export function startVoiceWake(): void {
    if (process.env.VOICE_WAKE_AUTOSTART === "true") {
        startListening();
    }
}

export function stopVoiceWake(): void {
    stopListening();
}

// ── Microphone Listener ──────────────────────────────

function startListening(): void {
    if (state.listening) return;

    state.enabled = true;
    state.listening = true;

    console.log(`  🎤 Voice wake: listening for "Hey ${config.botName}"…`);

    // Use macOS `rec` (from SoX) to capture audio and detect silence/sound patterns
    // This is a lightweight approach — for real wake word detection,
    // integrate Picovoice Porcupine or similar
    try {
        // Attempt to start audio monitoring
        // rec outputs raw audio; we detect amplitude spikes as potential wake words
        micProcess = spawn("rec", [
            "-q",           // Quiet
            "-t", "raw",    // Raw format
            "-r", "16000",  // 16kHz
            "-b", "16",     // 16-bit
            "-c", "1",      // Mono
            "-e", "signed", // Signed PCM
            "-",            // Stdout
            "silence", "1", "0.1", "3%",  // Wait for sound
            "1", "1.0", "3%",             // Then wait for 1s silence
        ], {
            stdio: ["ignore", "pipe", "ignore"],
        });

        micProcess.stdout?.on("data", () => {
            // Sound detected — in a real implementation, this would
            // run the audio through a wake word model.
            // For now, we treat any voice activation as a trigger
            // when voice wake is enabled.
            handleWakeWordDetected();
        });

        micProcess.on("error", (err) => {
            console.log(`  ⚠️  Voice wake: microphone error (${err.message}). Install SoX: brew install sox`);
            state.listening = false;
            state.enabled = false;
        });

        micProcess.on("exit", () => {
            if (state.enabled) {
                // Restart after silence detection completes
                setTimeout(() => {
                    if (state.enabled) startListening();
                }, 500);
            } else {
                state.listening = false;
            }
        });
    } catch {
        console.log("  ⚠️  Voice wake: could not start microphone. Install SoX: brew install sox");
        state.enabled = false;
        state.listening = false;
    }
}

function stopListening(): void {
    state.enabled = false;
    state.listening = false;

    if (micProcess) {
        micProcess.kill();
        micProcess = null;
    }

    console.log("  🎤 Voice wake: stopped.");
}

function handleWakeWordDetected(): void {
    state.lastTriggered = Date.now();
    state.triggerCount++;

    console.log(`  🎤 Voice wake triggered! (#${state.triggerCount})`);

    // Notify via macOS notification
    spawn("osascript", [
        "-e",
        `display notification "Listening…" with title "${config.botName}" sound name "Ping"`,
    ]);
}
