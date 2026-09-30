# Multi-stage build for chess: Node web build → tiny runtime with Stockfish.

# ---- Stage 1: build everything ----
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# Native deps for better-sqlite3 compile
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# Workspace install — `npm ci` enforces the lockfile so the image is
# reproducible across machines and CI.
COPY package.json package-lock.json tsconfig.base.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci --include=dev

# Sources
COPY server ./server
COPY web ./web

# Build server (TS → JS) and web (Vite → static dist)
RUN npm run build

# ---- Stage 2: runtime ----
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

# Stockfish from Debian repos — recent enough for our needs. zstd unpacks the
# Lichess puzzle database download (Node 20 has no built-in zstd).
RUN apt-get update && apt-get install -y --no-install-recommends \
    stockfish ca-certificates zstd \
 && rm -rf /var/lib/apt/lists/*

# Install only production deps for the server workspace
COPY package.json package-lock.json ./
COPY server/package.json ./server/
RUN npm ci --omit=dev --workspace=server

# Copy built artifacts from builder
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/web/dist ./web/dist

# CHANGELOG is read at runtime by /api/meta/changelog
COPY CHANGELOG.md ./CHANGELOG.md

# Persistent data lives here — mount a volume to keep DB across container restarts
RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME ["/app/data"]

ENV NODE_ENV=production \
    PORT=8800 \
    HOST=0.0.0.0 \
    DB_PATH=/app/data/chess.db \
    STOCKFISH_PATH=/usr/games/stockfish

USER node
EXPOSE 8800
CMD ["node", "server/dist/index.js"]
