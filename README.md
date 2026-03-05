# Olivia

AI assistant that lives on your machine. Telegram + WhatsApp. Voice, tools, memory.

## Quick Start

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env
# Edit .env — add your API keys and bot tokens

# 3. Run
npm run dev
```

## First Run

On first boot, Olivia will start the **Soul Wizard** in your Telegram chat — a guided step-by-step process to define her personality. Just follow the buttons.

## Required Keys

| Key | Where to get it |
|---|---|
| `TELEGRAM_BOT_TOKEN` | [@BotFather](https://t.me/botfather) — create a **new** bot for Olivia |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| `OWNER_CHAT_ID` | Send `/start` to your new bot, check logs |

## Optional Keys

| Key | For |
|---|---|
| `GROQ_API_KEY` | Voice transcription (Whisper) |
| `ELEVENLABS_API_KEY` | Text-to-speech (Talk Mode) |
| `WHATSAPP_ENABLED=true` | WhatsApp channel |
| `GMAIL_CLIENT_ID` + `GMAIL_CLIENT_SECRET` | Gmail integration |

## Architecture

Same engine as Giorgio — tools, memory, heartbeat, security policy, soul wizard. Separate personality, separate bot token, separate data.

## Commands

- `/soul` — Set up or change personality
- `/model` — Switch LLM model
- `/talk` — Toggle voice mode
- `/status` — Bot status
- `/new` — Fresh conversation
- `/help` — All commands
