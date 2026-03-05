#!/bin/bash
# ── Giorgio — Cloudflare Workers Deploy Script ───────
set -e

echo "🚀 Deploying Giorgio to Cloudflare Workers..."
echo ""

# Check wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "❌ wrangler not found. Install with: npm i -g wrangler"
    exit 1
fi

# Check if logged in
if ! wrangler whoami &> /dev/null 2>&1; then
    echo "📋 Not logged in. Running wrangler login..."
    wrangler login
fi

# Create D1 database if needed
echo "📦 Ensuring D1 database exists..."
DB_ID=$(wrangler d1 list 2>/dev/null | grep "giorgio-db" | awk '{print $1}' || true)

if [ -z "$DB_ID" ]; then
    echo "   Creating D1 database 'giorgio-db'..."
    wrangler d1 create giorgio-db
    echo ""
    echo "⚠️  Copy the database_id from above into wrangler.toml, then re-run this script."
    exit 0
fi

echo "   D1 database: $DB_ID"

# Run migrations
echo "📊 Running D1 migrations..."
wrangler d1 execute giorgio-db --file=./migrations/0001_init.sql --remote

# Create KV namespace if needed
echo "📦 Ensuring KV namespace exists..."
KV_ID=$(wrangler kv namespace list 2>/dev/null | grep -A1 '"title": "giorgio-KV"' | grep '"id"' | awk -F'"' '{print $4}' || true)

if [ -z "$KV_ID" ]; then
    echo "   Creating KV namespace..."
    wrangler kv namespace create KV
    echo ""
    echo "⚠️  Copy the namespace id from above into wrangler.toml, then re-run this script."
    exit 0
fi

echo "   KV namespace: $KV_ID"

# Set secrets (only if not already set)
echo "🔐 Checking secrets..."
echo "   (If prompted, paste your API keys)"

for SECRET in ANTHROPIC_API_KEY OPENROUTER_API_KEY TELEGRAM_BOT_TOKEN; do
    if ! wrangler secret list 2>/dev/null | grep -q "$SECRET"; then
        echo "   Setting $SECRET..."
        wrangler secret put "$SECRET"
    else
        echo "   ✅ $SECRET already set"
    fi
done

# Deploy
echo ""
echo "🚀 Deploying worker..."
wrangler deploy

echo ""
echo "✅ Giorgio deployed to Cloudflare Workers!"
echo ""
echo "📋 Next steps:"
echo "   1. Set Telegram webhook:"
echo "      curl https://api.telegram.org/bot\$TELEGRAM_BOT_TOKEN/setWebhook?url=https://giorgio.<your-subdomain>.workers.dev/webhook/telegram"
echo "   2. Test health check:"
echo "      curl https://giorgio.<your-subdomain>.workers.dev/health"
