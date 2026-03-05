/**
 * Giorgio ESP32-S3 Firmware
 *
 * Minimal client that:
 * 1. Connects to WiFi
 * 2. Accepts text input via Serial
 * 3. Forwards to Giorgio's cloud API
 * 4. Displays the AI response
 *
 * Works with both the Cloudflare Worker and local server endpoints.
 */

#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

// Load user config (copy config.example.h → config.h)
#if __has_include("config.h")
#include "config.h"
#else
#error                                                                         \
    "Missing config.h! Copy config.example.h to config.h and fill in your values."
#endif

// ── State ────────────────────────────────────────────

enum DeviceState {
  STATE_BOOT,
  STATE_CONNECTING,
  STATE_READY,
  STATE_PROCESSING,
  STATE_ERROR
};

static DeviceState currentState = STATE_BOOT;
static unsigned long lastHeartbeat = 0;
static String inputBuffer = "";

// ── WiFi ─────────────────────────────────────────────

void connectWiFi() {
  currentState = STATE_CONNECTING;
  digitalWrite(LED_PIN, HIGH);

  Serial.printf("\n📡 Connecting to WiFi: %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n✅ WiFi connected! IP: %s\n",
                  WiFi.localIP().toString().c_str());
    Serial.printf("   Signal: %d dBm\n", WiFi.RSSI());
    currentState = STATE_READY;
    digitalWrite(LED_PIN, LOW);
  } else {
    Serial.println("\n❌ WiFi connection failed!");
    currentState = STATE_ERROR;
  }
}

// ── API Communication ────────────────────────────────

String sendToGiorgio(const String &message) {
  if (WiFi.status() != WL_CONNECTED) {
    return "❌ WiFi not connected";
  }

  currentState = STATE_PROCESSING;
  digitalWrite(LED_PIN, HIGH);

  HTTPClient http;
  WiFiClientSecure client;
  client.setInsecure(); // Skip cert verification (OK for dev)

  Serial.println("⏳ Sending to Giorgio...");

  http.begin(client, GIORGIO_API_URL);
  http.addHeader("Content-Type", "application/json");

  // Add auth if configured
  String apiKey = GIORGIO_API_KEY;
  if (apiKey.length() > 0) {
    http.addHeader("Authorization", "Bearer " + apiKey);
  }

  // Build JSON payload
  JsonDocument doc;
  doc["chatId"] = DEVICE_CHAT_ID;
  doc["text"] = message;
  doc["device"] = DEVICE_NAME;

  String payload;
  serializeJson(doc, payload);

  int httpCode = http.POST(payload);
  String response = "";

  if (httpCode == 200) {
    String body = http.getString();

    // Parse JSON response
    JsonDocument resDoc;
    DeserializationError err = deserializeJson(resDoc, body);

    if (!err && resDoc.containsKey("reply")) {
      response = resDoc["reply"].as<String>();
    } else {
      response = body; // Return raw if not JSON
    }
  } else if (httpCode > 0) {
    response = "⚠️ HTTP " + String(httpCode) + ": " + http.getString();
  } else {
    response = "❌ Connection failed: " + http.errorToString(httpCode);
  }

  http.end();
  currentState = STATE_READY;
  digitalWrite(LED_PIN, LOW);

  return response;
}

// ── Health Check ─────────────────────────────────────

void checkHealth() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("⚠️ WiFi disconnected — reconnecting...");
    connectWiFi();
    return;
  }

  HTTPClient http;
  WiFiClientSecure client;
  client.setInsecure();

  String healthUrl = GIORGIO_API_URL;
  healthUrl.replace("/api/message", "/health");

  http.begin(client, healthUrl);
  int code = http.GET();

  if (code == 200) {
    Serial.printf("💚 Heartbeat OK | WiFi: %d dBm | Heap: %d bytes\n",
                  WiFi.RSSI(), ESP.getFreeHeap());
  } else {
    Serial.printf("⚠️ Heartbeat failed: HTTP %d\n", code);
  }

  http.end();
}

// ── Serial Input ─────────────────────────────────────

void processSerialInput() {
  while (Serial.available()) {
    char c = Serial.read();

    if (c == '\n' || c == '\r') {
      inputBuffer.trim();
      if (inputBuffer.length() > 0) {
        Serial.printf("\n📤 You: %s\n", inputBuffer.c_str());

        // Handle local commands
        if (inputBuffer == "/status") {
          Serial.printf("📊 State: %s | WiFi: %s (%d dBm) | Heap: %d\n",
                        currentState == STATE_READY ? "ready" : "busy",
                        WiFi.status() == WL_CONNECTED ? "connected"
                                                      : "disconnected",
                        WiFi.RSSI(), ESP.getFreeHeap());
        } else if (inputBuffer == "/reconnect") {
          connectWiFi();
        } else if (inputBuffer == "/health") {
          checkHealth();
        } else {
          // Send to Giorgio
          String reply = sendToGiorgio(inputBuffer);
          Serial.printf("🤖 Giorgio: %s\n", reply.c_str());
        }

        inputBuffer = "";
        Serial.print("\n> ");
      }
    } else {
      inputBuffer += c;
    }
  }
}

// ── Setup & Loop ─────────────────────────────────────

void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(1000); // Wait for serial

  pinMode(LED_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  Serial.println();
  Serial.println("┌─────────────────────────────────┐");
  Serial.println("│   🤖 Giorgio ESP32-S3 Client    │");
  Serial.println("└─────────────────────────────────┘");
  Serial.printf("  Device : %s\n", DEVICE_NAME);
  Serial.printf("  API    : %s\n", GIORGIO_API_URL);
  Serial.printf("  Heap   : %d bytes\n", ESP.getFreeHeap());

  connectWiFi();

  if (currentState == STATE_READY) {
    Serial.println("\n💬 Type a message and press Enter to talk to Giorgio.");
    Serial.println("   Commands: /status, /reconnect, /health\n");
    Serial.print("> ");
  }
}

void loop() {
  // Process serial input
  processSerialInput();

  // Button press → send a quick ping
  if (digitalRead(BUTTON_PIN) == LOW) {
    delay(200); // Debounce
    if (digitalRead(BUTTON_PIN) == LOW) {
      Serial.println("\n🔘 Button pressed — pinging Giorgio...");
      String reply = sendToGiorgio("ping from " + String(DEVICE_NAME));
      Serial.printf("🤖 Giorgio: %s\n> ", reply.c_str());
      while (digitalRead(BUTTON_PIN) == LOW)
        delay(10); // Wait release
    }
  }

  // Periodic heartbeat
  if (millis() - lastHeartbeat > HEARTBEAT_MS) {
    lastHeartbeat = millis();
    checkHealth();
  }

  delay(10);
}
