// ── Giorgio ESP32-S3 Configuration ──────────────────
// Copy this file to config.h and fill in your values.

#ifndef CONFIG_H
#define CONFIG_H

// ── WiFi ─────────────────────────────────────────────
#define WIFI_SSID         "YOUR_WIFI_SSID"
#define WIFI_PASSWORD     "YOUR_WIFI_PASSWORD"

// ── Giorgio Backend ──────────────────────────────────
// Use your Cloudflare Worker URL or local server
#define GIORGIO_API_URL   "https://giorgio.pa-dehoyos.workers.dev/api/message"
// Optional: Bearer token for authentication
#define GIORGIO_API_KEY   ""

// ── Device Identity ──────────────────────────────────
#define DEVICE_NAME       "giorgio-esp32"
#define DEVICE_CHAT_ID    9999  // Unique chat ID for this device

// ── Hardware ─────────────────────────────────────────
#define LED_PIN           2     // Built-in LED (activity indicator)
#define BUTTON_PIN        0     // Boot button (used for input trigger)

// ── Behavior ─────────────────────────────────────────
#define HEARTBEAT_MS      30000  // Health check interval (30s)
#define RECONNECT_MS      5000   // WiFi reconnect delay
#define MAX_RESPONSE_SIZE 4096   // Max response buffer size
#define SERIAL_BAUD       115200

#endif
