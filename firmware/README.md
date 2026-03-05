# Giorgio ESP32-S3 Firmware

Minimal firmware that turns an ESP32-S3 into a wireless Giorgio client.

## What it does

1. Connects to WiFi
2. Accepts text input via Serial Monitor
3. Sends messages to Giorgio's cloud API (Cloudflare Worker)
4. Displays AI responses
5. Periodic health checks with LED status

## Quick Start

### 1. Install PlatformIO

```bash
# VS Code Extension (recommended)
# Install "PlatformIO IDE" from VS Code extensions

# Or CLI
pip install platformio
```

### 2. Configure

```bash
cp src/config.example.h src/config.h
```

Edit `src/config.h`:
```c
#define WIFI_SSID       "YourWiFi"
#define WIFI_PASSWORD   "YourPassword"
#define GIORGIO_API_URL "https://giorgio.pa-dehoyos.workers.dev/api/message"
```

### 3. Build & Upload

```bash
cd firmware
pio run --target upload
pio device monitor    # Open serial monitor
```

### 4. Use

Type messages in the serial monitor and press Enter:

```
> Hello Giorgio!
🤖 Giorgio: Hello! How can I help you today?

> /status
📊 State: ready | WiFi: connected (-45 dBm) | Heap: 234567
```

## Commands

| Command | Description |
|---|---|
| `/status` | Show device state, WiFi signal, free memory |
| `/reconnect` | Reconnect to WiFi |
| `/health` | Ping Giorgio's health endpoint |
| `(any text)` | Send to Giorgio and get AI response |

## Hardware

- **LED** (GPIO 2): Blinks when processing
- **Boot Button** (GPIO 0): Press to send a ping to Giorgio

## Endpoints Used

| Endpoint | Purpose |
|---|---|
| `POST /api/message` | Send message, get AI reply |
| `GET /health` | Health check |
