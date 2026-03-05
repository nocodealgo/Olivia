/**
 * Mobile Companion Gateway
 *
 * HTTP routes for mobile companion app communication:
 *
 *   POST /api/mobile/register     — register a device
 *   POST /api/mobile/unregister   — remove a device
 *   GET  /api/mobile/devices      — list registered devices
 *
 *   POST /api/mobile/camera       — upload photo/video from device
 *   POST /api/mobile/location     — send GPS coordinates
 *   POST /api/mobile/screen       — upload screenshot/recording
 *
 *   POST /api/mobile/push/send    — queue a push notification
 *   GET  /api/mobile/push/poll    — device polls for notifications
 *
 *   GET  /api/mobile/commands     — device polls for pending commands
 *   POST /api/mobile/command      — server queues a command for a device
 */

import { type IncomingMessage, type ServerResponse } from "node:http";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { config } from "../config.js";
import { routeMessage } from "../router/message-bus.js";
import {
    registerDevice, unregisterDevice, listDevices, getDevice,
    sendPush, broadcastPush, drainPushQueue, updateDeviceSeen,
} from "./push-service.js";
import type {
    MobileDevice, CameraPayload, LocationData,
    ScreenRecordPayload, PushNotification, GatewayCommand,
} from "./types.js";

// ── Media storage ────────────────────────────────────

const MEDIA_DIR = join(homedir(), "Giorgio", "mobile-media");
if (!existsSync(MEDIA_DIR)) mkdirSync(MEDIA_DIR, { recursive: true });

// ── Pending commands (server → device) ───────────────

const pendingCommands = new Map<string, GatewayCommand[]>();

function queueCommand(deviceId: string, cmd: GatewayCommand): boolean {
    if (!getDevice(deviceId)) return false;
    const queue = pendingCommands.get(deviceId) || [];
    queue.push(cmd);
    pendingCommands.set(deviceId, queue);
    return true;
}

function drainCommands(deviceId: string): GatewayCommand[] {
    const cmds = pendingCommands.get(deviceId) || [];
    pendingCommands.delete(deviceId);
    updateDeviceSeen(deviceId);
    return cmds;
}

// ── Latest location tracking ─────────────────────────

const latestLocations = new Map<string, LocationData>();

export function getLatestLocation(deviceId?: string): LocationData | null {
    if (deviceId) return latestLocations.get(deviceId) || null;
    // Return most recent from any device
    let latest: LocationData | null = null;
    for (const loc of latestLocations.values()) {
        if (!latest || loc.timestamp > latest.timestamp) latest = loc;
    }
    return latest;
}

// ── Route handler ────────────────────────────────────

export async function handleMobileRoute(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
): Promise<boolean> {
    if (!pathname.startsWith("/api/mobile")) return false;
    const route = pathname.slice("/api/mobile".length);

    // ── Device management ──────────
    if (route === "/register" && req.method === "POST") {
        const body = await readBody(req);
        let device: MobileDevice;
        try { device = JSON.parse(body) as MobileDevice; } catch { return jsonError(res, 400, "Invalid JSON"); }
        if (!device.id || !device.name) {
            return jsonError(res, 400, "Missing 'id' and 'name'");
        }
        // Sanitize — strip HTML tags from device name/id
        device.name = device.name.replace(/<[^>]*>/g, "").slice(0, 100);
        device.id = device.id.replace(/[^a-zA-Z0-9_\-]/g, "").slice(0, 64);
        device.lastSeen = Date.now();
        device.capabilities = device.capabilities || [];
        registerDevice(device);
        return json(res, { registered: true, device });
    }

    if (route === "/unregister" && req.method === "POST") {
        const body = await readBody(req);
        let parsed: { deviceId?: string };
        try { parsed = JSON.parse(body); } catch { return jsonError(res, 400, "Invalid JSON"); }
        return json(res, { removed: unregisterDevice(parsed.deviceId || "") });
    }

    if (route === "/devices" && req.method === "GET") {
        return json(res, { devices: listDevices() });
    }

    // ── Camera upload ──────────────
    if (route === "/camera" && req.method === "POST") {
        const body = await readBody(req);
        const payload = JSON.parse(body) as CameraPayload;
        if (!payload.image || !payload.deviceId) {
            return jsonError(res, 400, "Missing 'image' or 'deviceId'");
        }

        // Save media file
        const ext = payload.mimeType?.includes("png") ? "png" : payload.mimeType?.includes("mp4") ? "mp4" : "jpg";
        const filename = `camera_${payload.deviceId}_${Date.now()}.${ext}`;
        const filepath = join(MEDIA_DIR, filename);
        writeFileSync(filepath, Buffer.from(payload.image, "base64"));

        console.log(`  📷 Camera upload from ${payload.deviceId}: ${filename}`);

        // Notify the agent
        const text = payload.caption
            ? `[Mobile Camera: ${payload.deviceId}] ${payload.caption} (saved: ${filename})`
            : `[Mobile Camera: ${payload.deviceId}] Photo received (saved: ${filename})`;

        routeMessage({
            channel: "webhook",
            chatId: config.ownerChatId,
            senderName: payload.deviceId,
            text,
            replyContext: `cam-${Date.now()}`,
        }).catch(() => { });

        return json(res, { saved: filename, path: filepath });
    }

    // ── GPS location ───────────────
    if (route === "/location" && req.method === "POST") {
        const body = await readBody(req);
        const { deviceId, ...location } = JSON.parse(body) as LocationData & { deviceId: string };
        if (!deviceId || location.latitude === undefined) {
            return jsonError(res, 400, "Missing 'deviceId' or 'latitude'");
        }

        latestLocations.set(deviceId, { ...location, timestamp: Date.now() });
        updateDeviceSeen(deviceId);

        console.log(`  📍 Location from ${deviceId}: ${location.latitude}, ${location.longitude}`);
        return json(res, { received: true });
    }

    if (route === "/location" && req.method === "GET") {
        const url = new URL(req.url || "/", "http://localhost");
        const deviceId = url.searchParams.get("deviceId") || undefined;
        return json(res, { location: getLatestLocation(deviceId) });
    }

    // ── Screen recording ───────────
    if (route === "/screen" && req.method === "POST") {
        const body = await readBody(req);
        const payload = JSON.parse(body) as ScreenRecordPayload;
        if (!payload.data || !payload.deviceId) {
            return jsonError(res, 400, "Missing 'data' or 'deviceId'");
        }

        const ext = payload.mimeType?.includes("mp4") ? "mp4" : "png";
        const filename = `screen_${payload.deviceId}_${Date.now()}.${ext}`;
        const filepath = join(MEDIA_DIR, filename);
        writeFileSync(filepath, Buffer.from(payload.data, "base64"));

        console.log(`  🖥️  Screen capture from ${payload.deviceId}: ${filename}`);
        return json(res, { saved: filename, path: filepath });
    }

    // ── Push notifications ─────────
    if (route === "/push/send" && req.method === "POST") {
        const body = await readBody(req);
        const { deviceId, notification } = JSON.parse(body) as {
            deviceId?: string;
            notification: PushNotification;
        };
        if (!notification?.title) {
            return jsonError(res, 400, "Missing 'notification.title'");
        }

        if (deviceId) {
            const sent = sendPush(deviceId, notification);
            return json(res, { sent, deviceId });
        } else {
            const count = broadcastPush(notification);
            return json(res, { broadcast: true, deviceCount: count });
        }
    }

    if (route === "/push/poll" && req.method === "GET") {
        const url = new URL(req.url || "/", "http://localhost");
        const deviceId = url.searchParams.get("deviceId");
        if (!deviceId) return jsonError(res, 400, "Missing 'deviceId' query param");
        return json(res, { notifications: drainPushQueue(deviceId) });
    }

    // ── Commands (server → device) ─
    if (route === "/command" && req.method === "POST") {
        const body = await readBody(req);
        const { deviceId, action, params } = JSON.parse(body);
        if (!deviceId || !action) {
            return jsonError(res, 400, "Missing 'deviceId' or 'action'");
        }
        const cmd: GatewayCommand = {
            id: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            action,
            params,
            timestamp: Date.now(),
        };
        const queued = queueCommand(deviceId, cmd);
        return json(res, { queued, command: cmd });
    }

    if (route === "/commands" && req.method === "GET") {
        const url = new URL(req.url || "/", "http://localhost");
        const deviceId = url.searchParams.get("deviceId");
        if (!deviceId) return jsonError(res, 400, "Missing 'deviceId' query param");
        return json(res, { commands: drainCommands(deviceId) });
    }

    return false;
}

// ── Helpers ──────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let data = "";
        req.on("data", (chunk: string) => { data += chunk; });
        req.on("end", () => resolve(data));
        req.on("error", reject);
        // 10MB limit for media uploads
        req.on("data", () => {
            if (data.length > 10 * 1024 * 1024) {
                req.destroy();
                reject(new Error("Body too large (10MB max)"));
            }
        });
    });
}

function json(res: ServerResponse, data: unknown): true {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
    return true;
}

function jsonError(res: ServerResponse, status: number, error: string): true {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error }));
    return true;
}
