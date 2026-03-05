/**
 * Mobile Companion Types
 *
 * Shared types for the mobile gateway.
 */

// ── Device Registration ──────────────────────────────

export interface MobileDevice {
    id: string;
    name: string;
    platform: "ios" | "android" | "web";
    pushToken?: string;
    lastSeen: number;
    capabilities: MobileCapability[];
}

export type MobileCapability = "camera" | "gps" | "screen_record" | "push" | "microphone" | "sensors";

// ── Location ─────────────────────────────────────────

export interface LocationData {
    latitude: number;
    longitude: number;
    accuracy?: number;
    altitude?: number;
    speed?: number;
    heading?: number;
    timestamp: number;
}

// ── Media Payloads ───────────────────────────────────

export interface CameraPayload {
    deviceId: string;
    image: string;          // base64 encoded
    mimeType: string;       // image/jpeg, image/png, video/mp4
    width?: number;
    height?: number;
    caption?: string;
    timestamp: number;
}

export interface ScreenRecordPayload {
    deviceId: string;
    data: string;           // base64 encoded
    mimeType: string;       // image/png (screenshot) or video/mp4 (recording)
    duration?: number;      // seconds, for video
    timestamp: number;
}

// ── Push Notification ────────────────────────────────

export interface PushNotification {
    title: string;
    body: string;
    icon?: string;
    url?: string;
    data?: Record<string, unknown>;
    priority?: "default" | "high";
}

// ── Gateway Command (server → device) ────────────────

export interface GatewayCommand {
    id: string;
    action: "take_photo" | "get_location" | "start_screen_record" | "stop_screen_record" | "send_push";
    params?: Record<string, unknown>;
    timestamp: number;
}
