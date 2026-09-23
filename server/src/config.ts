import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..');

function ensureDir(filePath: string) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function resolveDbPath(): string {
  const raw = process.env.DB_PATH ?? './data/chess.db';
  const abs = resolve(PROJECT_ROOT, raw);
  ensureDir(abs);
  return abs;
}

function loadOrCreateSessionSecret(dbPath: string): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const secretFile = resolve(dirname(dbPath), '.session-secret');
  if (existsSync(secretFile)) return readFileSync(secretFile, 'utf8').trim();
  const secret = randomBytes(32).toString('hex');
  writeFileSync(secretFile, secret, { mode: 0o600 });
  return secret;
}

const dbPath = resolveDbPath();

// Cookie `Secure` flag. The default `false` matches the documented localhost /
// LAN deploy, where the server speaks plaintext HTTP. Operators terminating TLS
// (reverse proxy, Cloudflare tunnel, etc.) should set COOKIE_SECURE=true so
// session cookies aren't shipped in plaintext over the wire.
function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v == null) return fallback;
  return /^(1|true|yes|on)$/i.test(v);
}

export const config = {
  port: Number(process.env.PORT ?? 8800),
  host: process.env.HOST ?? '0.0.0.0',
  dbPath,
  sessionSecret: loadOrCreateSessionSecret(dbPath),
  stockfishPathHint: process.env.STOCKFISH_PATH || undefined,
  projectRoot: PROJECT_ROOT,
  cookieSecure: parseBool(process.env.COOKIE_SECURE, false),
  demoMode: parseBool(process.env.DEMO_MODE, false),
  demoStockfishCap: Number(process.env.DEMO_STOCKFISH_CAP ?? 2),
};
