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

// Single sign-on (OpenID Connect). SSO is on when OIDC_ISSUER and
// OIDC_CLIENT_ID are both set; everything else has a safe default.
export type OidcMatchBy = 'none' | 'username' | 'email';

function loadOidcConfig() {
  const issuer = (process.env.OIDC_ISSUER ?? '').trim();
  const clientId = (process.env.OIDC_CLIENT_ID ?? '').trim();
  const enabled = issuer !== '' && clientId !== '';
  if (issuer && !clientId) console.warn('[oidc] OIDC_ISSUER is set but OIDC_CLIENT_ID is not, so SSO stays off');

  const rawMatch = (process.env.OIDC_MATCH_BY ?? 'none').trim().toLowerCase();
  const matchBy: OidcMatchBy = rawMatch === 'username' || rawMatch === 'email' ? rawMatch : 'none';
  if (matchBy !== rawMatch) console.warn(`[oidc] unknown OIDC_MATCH_BY="${rawMatch}", using "none"`);

  // Never lock everyone out: OIDC_ONLY without a working SSO config is ignored.
  let only = parseBool(process.env.OIDC_ONLY, false);
  if (only && !enabled) {
    console.warn('[oidc] OIDC_ONLY is set but SSO is not configured, so password login stays on');
    only = false;
  }

  return {
    enabled,
    issuer,
    clientId,
    clientSecret: process.env.OIDC_CLIENT_SECRET ?? '',
    only,
    buttonText: (process.env.OIDC_BUTTON_TEXT ?? '').trim(),
    autoProvision: parseBool(process.env.OIDC_AUTO_PROVISION, false),
    matchBy,
  };
}

export const config = {
  port: Number(process.env.PORT ?? 8800),
  host: process.env.HOST ?? '0.0.0.0',
  dbPath,
  sessionSecret: loadOrCreateSessionSecret(dbPath),
  stockfishPathHint: process.env.STOCKFISH_PATH || undefined,
  projectRoot: PROJECT_ROOT,
  cookieSecure: parseBool(process.env.COOKIE_SECURE, false),
  oidc: loadOidcConfig(),
};
