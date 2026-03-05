/**
 * ESP32 / IoT Device Handler
 *
 * Handles incoming messages from hardware devices (ESP32-S3, etc.)
 * that connect via HTTP API.
 *
 * Devices POST JSON to /api/message:
 *   { chatId: number, text: string, device?: string }
 *
 * Response:
 *   { reply: string, chatId: number }
 */

import { config } from "../config.js";
import { routeMessage } from "../router/message-bus.js";

// ── Types ────────────────────────────────────────────

export interface DeviceMessage {
    chatId?: number;
    text: string;
    device?: string;
}

export interface DeviceResponse {
    reply: string;
    chatId: number;
    device?: string;
}

// ── Connected device tracking ────────────────────────

const connectedDevices = new Map<string, {
    lastSeen: number;
    messageCount: number;
    ip?: string;
}>();

export function getConnectedDevices() {
    const now = Date.now();
    const devices: Array<{ name: string; lastSeen: number; messageCount: number; online: boolean }> = [];
    for (const [name, info] of connectedDevices) {
        devices.push({
            name,
            lastSeen: info.lastSeen,
            messageCount: info.messageCount,
            online: (now - info.lastSeen) < 60000,  // Consider online if seen in last 60s
        });
    }
    return devices;
}

// ── Process device message ───────────────────────────

export async function handleDeviceMessage(msg: DeviceMessage, clientIp?: string): Promise<DeviceResponse> {
    const deviceName = msg.device || "unknown-device";
    const chatId = msg.chatId || config.ownerChatId;

    // Track device
    const existing = connectedDevices.get(deviceName);
    connectedDevices.set(deviceName, {
        lastSeen: Date.now(),
        messageCount: (existing?.messageCount || 0) + 1,
        ip: clientIp,
    });

    console.log(`  📟 [device/${deviceName}] ${msg.text.slice(0, 100)}`);

    // Route through message bus and capture the reply
    return new Promise<DeviceResponse>((resolve) => {
        let resolved = false;

        // Set up a one-time reply capture via webhook adapter
        const reqId = `dev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        // Store resolver for the webhook adapter to call
        devicePendingReplies.set(reqId, (reply: string) => {
            if (!resolved) {
                resolved = true;
                resolve({ reply, chatId, device: deviceName });
            }
        });

        // Timeout fallback
        setTimeout(() => {
            if (!resolved) {
                resolved = true;
                devicePendingReplies.delete(reqId);
                resolve({ reply: "⏳ Processing took too long. Try again.", chatId, device: deviceName });
            }
        }, 25000);

        // Route the message
        routeMessage({
            channel: "webhook",
            chatId,
            senderName: deviceName,
            text: `[Device: ${deviceName}] ${msg.text}`,
            replyContext: reqId,
        }).catch(() => {
            if (!resolved) {
                resolved = true;
                devicePendingReplies.delete(reqId);
                resolve({ reply: "❌ Error processing message.", chatId, device: deviceName });
            }
        });
    });
}

// ── Pending reply map (shared with webhook adapter) ──

export const devicePendingReplies = new Map<string, (reply: string) => void>();
