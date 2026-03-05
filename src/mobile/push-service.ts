/**
 * Push Notification Service
 *
 * Manages push notification delivery to registered mobile devices.
 * Supports Web Push (VAPID) for PWA and can be extended for
 * Firebase (FCM) or APNs.
 */

import type { MobileDevice, PushNotification } from "./types.js";

// ── Registered devices ───────────────────────────────

const devices = new Map<string, MobileDevice>();

export function registerDevice(device: MobileDevice): void {
    devices.set(device.id, { ...device, lastSeen: Date.now() });
    console.log(`  📱 Mobile device registered: ${device.name} (${device.platform})`);
}

export function unregisterDevice(deviceId: string): boolean {
    const removed = devices.delete(deviceId);
    if (removed) console.log(`  📱 Mobile device removed: ${deviceId}`);
    return removed;
}

export function getDevice(deviceId: string): MobileDevice | undefined {
    return devices.get(deviceId);
}

export function listDevices(): MobileDevice[] {
    return Array.from(devices.values());
}

export function updateDeviceSeen(deviceId: string): void {
    const d = devices.get(deviceId);
    if (d) d.lastSeen = Date.now();
}

// ── Push delivery ────────────────────────────────────

const pendingPush = new Map<string, PushNotification[]>();

/**
 * Queue a push notification for a device.
 * The device polls /api/mobile/push/poll to receive them.
 */
export function sendPush(deviceId: string, notification: PushNotification): boolean {
    const device = devices.get(deviceId);
    if (!device) return false;

    // Queue for polling (simplest approach — works without FCM/APNs setup)
    const queue = pendingPush.get(deviceId) || [];
    queue.push(notification);
    pendingPush.set(deviceId, queue);

    console.log(`  🔔 Push queued for ${device.name}: ${notification.title}`);
    return true;
}

/**
 * Send push to ALL registered devices.
 */
export function broadcastPush(notification: PushNotification): number {
    let sent = 0;
    for (const deviceId of devices.keys()) {
        if (sendPush(deviceId, notification)) sent++;
    }
    return sent;
}

/**
 * Drain the push queue for a device (called by device polling).
 */
export function drainPushQueue(deviceId: string): PushNotification[] {
    const queue = pendingPush.get(deviceId) || [];
    pendingPush.delete(deviceId);
    updateDeviceSeen(deviceId);
    return queue;
}
