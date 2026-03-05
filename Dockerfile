# ── Stage 1: Build ────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files and install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts && npm rebuild better-sqlite3

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
COPY soul.md* ./
RUN npm run build

# ── Stage 2: Runtime ──────────────────────────────────
FROM node:22-slim AS runtime

WORKDIR /app

# Install runtime dependencies for native modules + Playwright
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy built app and dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY soul.md* ./

# Copy optional directories (create empty fallbacks first)
RUN mkdir -p /app/skills /app/plugins
COPY skill[s]/ ./skills/
COPY plugin[s]/ ./plugins/

# Create data directories
RUN mkdir -p /data /data/logs /data/wa-session /data/screenshots

# Environment
ENV NODE_ENV=production
ENV MEMORY_DB_PATH=/data/giorgio.db
ENV VAULT_PATH=/data/secrets.vault

# Health check (uses webhook server's /health endpoint)
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://localhost:${WEBHOOK_PORT:-3100}/health').then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))"

# Expose webhook port
EXPOSE 3100

# Start
CMD ["node", "dist/index.js"]
