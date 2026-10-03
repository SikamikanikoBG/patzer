import * as client from 'openid-client';
import type { Context } from 'hono';
import { getSignedCookie, setSignedCookie, deleteCookie } from 'hono/cookie';
import { db, getSetting } from '../db.js';
import { config, type OidcMatchBy } from '../config.js';
import { publicBaseUrl } from '../publicUrl.js';

// Single sign-on with any OpenID Connect provider (Authentik, Keycloak,
// Authelia, …). Authorization code flow with PKCE, state and nonce; the
// heavy lifting (discovery, token exchange, ID token validation) is done by
// openid-client. Configuration comes from env vars, see config.oidc.

export const OIDC_CALLBACK_PATH = '/api/auth/oidc/callback';
const SCOPES = 'openid profile email';
const LANGUAGES = ['en', 'bg', 'es', 'de', 'ru'] as const;
type Language = (typeof LANGUAGES)[number];

// Stored instead of a bcrypt hash for accounts created through SSO. bcrypt
// rejects it (a real hash is 60 characters), so the account has no working
// password until someone sets one through reset or the admin console.
export const SSO_ONLY_PASSWORD = '!sso-only';

// Error codes end up in /login?sso_error=… and are translated by the web app.
export type OidcErrorCode = 'unavailable' | 'expired' | 'denied' | 'failed' | 'not_provisioned' | 'conflict';

export class OidcError extends Error {
  constructor(public code: OidcErrorCode, detail?: string) {
    super(detail ?? code);
  }
}

// ---- Provider discovery ----------------------------------------------------

// Discovered once and reused. A failure is not cached, so a provider that was
// down when Patzer started is picked up on the next login attempt.
let discovered: Promise<client.Configuration> | null = null;

function oidcClient(): Promise<client.Configuration> {
  if (!discovered) {
    const issuer = new URL(config.oidc.issuer);
    const insecure = issuer.protocol === 'http:';
    if (insecure) console.warn('[oidc] the issuer uses plain http; only do this on a trusted network');
    const auth = config.oidc.clientSecret
      ? client.ClientSecretPost(config.oidc.clientSecret)
      : client.None();
    discovered = client
      .discovery(issuer, config.oidc.clientId, undefined, auth, insecure ? { execute: [client.allowInsecureRequests] } : undefined)
      .catch((err: unknown) => {
        discovered = null;
        throw err;
      });
  }
  return discovered;
}

// The callback URL as the browser and the provider see it. Behind a reverse
// proxy the request URL is the internal one, so this must come from the
// public base URL (PUBLIC_BASE_URL, or the proxy's X-Forwarded-* headers).
function redirectUri(c: Context): string {
  return `${publicBaseUrl(c)}${OIDC_CALLBACK_PATH}`;
}

// ---- Login flow ------------------------------------------------------------

// state, nonce and the PKCE verifier live in a short-lived signed cookie
// between the redirect to the provider and the callback. SameSite=Lax is
// required: the callback is a top-level navigation coming from the provider.
const FLOW_COOKIE = 'patzer_oidc';
const FLOW_COOKIE_PATH = '/api/auth/oidc';
const FLOW_MAX_AGE_SECONDS = 10 * 60;

interface FlowState {
  state: string;
  nonce: string;
  verifier: string;
}

export async function beginOidcLogin(c: Context): Promise<string> {
  let cfg: client.Configuration;
  try {
    cfg = await oidcClient();
  } catch (err) {
    throw new OidcError('unavailable', `discovery failed: ${(err as Error).message}`);
  }
  const flow: FlowState = {
    state: client.randomState(),
    nonce: client.randomNonce(),
    verifier: client.randomPKCECodeVerifier(),
  };
  await setSignedCookie(c, FLOW_COOKIE, JSON.stringify(flow), config.sessionSecret, {
    httpOnly: true,
    sameSite: 'Lax',
    path: FLOW_COOKIE_PATH,
    maxAge: FLOW_MAX_AGE_SECONDS,
    secure: config.cookieSecure,
  });
  const url = client.buildAuthorizationUrl(cfg, {
    redirect_uri: redirectUri(c),
    scope: SCOPES,
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: await client.calculatePKCECodeChallenge(flow.verifier),
    code_challenge_method: 'S256',
  });
  return url.href;
}

export interface OidcIdentity {
  issuer: string;
  subject: string;
  username: string | null;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  language: Language;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function pickLanguage(c: Context): Language {
  // First language in Accept-Language that Patzer speaks, else the server default.
  const header = c.req.header('accept-language') ?? '';
  for (const part of header.split(',')) {
    const code = part.split(';')[0]!.trim().slice(0, 2).toLowerCase();
    if ((LANGUAGES as readonly string[]).includes(code)) return code as Language;
  }
  const fallback = getSetting('default_language');
  return (LANGUAGES as readonly string[]).includes(fallback ?? '') ? (fallback as Language) : 'en';
}

export async function finishOidcLogin(c: Context): Promise<{ identity: OidcIdentity; idToken: string }> {
  const raw = await getSignedCookie(c, config.sessionSecret, FLOW_COOKIE);
  deleteCookie(c, FLOW_COOKIE, { path: FLOW_COOKIE_PATH });
  if (!raw) throw new OidcError('expired', 'missing or tampered flow cookie');
  const flow = JSON.parse(raw) as FlowState;

  // The user cancelled, or the provider refused (e.g. not in the allowed group).
  const reqUrl = new URL(c.req.url);
  const providerError = reqUrl.searchParams.get('error');
  if (providerError) throw new OidcError('denied', providerError);

  let cfg: client.Configuration;
  try {
    cfg = await oidcClient();
  } catch (err) {
    throw new OidcError('unavailable', `discovery failed: ${(err as Error).message}`);
  }

  let tokens: Awaited<ReturnType<typeof client.authorizationCodeGrant>>;
  try {
    // openid-client derives the redirect_uri it sends to the token endpoint
    // from this URL, so it has to be the public one.
    const currentUrl = new URL(`${redirectUri(c)}${reqUrl.search}`);
    tokens = await client.authorizationCodeGrant(cfg, currentUrl, {
      pkceCodeVerifier: flow.verifier,
      expectedState: flow.state,
      expectedNonce: flow.nonce,
      idTokenExpected: true,
    });
  } catch (err) {
    throw new OidcError('failed', `code exchange failed: ${(err as Error).message}`);
  }

  const claims = tokens.claims();
  if (!claims || !tokens.id_token) throw new OidcError('failed', 'no ID token');

  // Providers differ in which claims they put in the ID token; userinfo has
  // the full profile. If it fails, the ID token claims are still enough.
  let info: Record<string, unknown> = { ...claims };
  try {
    info = { ...info, ...(await client.fetchUserInfo(cfg, tokens.access_token, claims.sub)) };
  } catch (err) {
    console.warn(`[oidc] userinfo failed, using ID token claims only: ${(err as Error).message}`);
  }

  return {
    idToken: tokens.id_token,
    identity: {
      issuer: claims.iss,
      subject: claims.sub,
      username: str(info.preferred_username),
      email: str(info.email),
      emailVerified: info.email_verified === true || info.email_verified === 'true',
      displayName: str(info.name),
      language: pickLanguage(c),
    },
  };
}

// ---- Account resolution ----------------------------------------------------

export type ResolveResult =
  | { userId: number; outcome: 'existing' | 'linked' | 'created' }
  | { error: 'not_provisioned' | 'conflict' };

interface ResolveOptions {
  matchBy: OidcMatchBy;
  autoProvision: boolean;
}

// Maps an identity to a Patzer account:
//  1. an identity seen before logs into the same account, whatever changed since;
//  2. otherwise OIDC_MATCH_BY may link it to an existing account by username
//     (case-insensitive) or by email (only when the provider says it's verified);
//  3. otherwise OIDC_AUTO_PROVISION decides whether a new account is created.
export function resolveOidcUser(id: OidcIdentity, opts: ResolveOptions): ResolveResult {
  return db.transaction((): ResolveResult => {
    const linked = db
      .prepare('SELECT user_id FROM oidc_identities WHERE issuer = ? AND subject = ?')
      .get(id.issuer, id.subject) as { user_id: number } | undefined;
    if (linked) {
      db.prepare(`UPDATE oidc_identities SET last_login_at = datetime('now') WHERE issuer = ? AND subject = ?`)
        .run(id.issuer, id.subject);
      return { userId: linked.user_id, outcome: 'existing' };
    }

    let candidates: { id: number }[] = [];
    if (opts.matchBy === 'username' && id.username) {
      candidates = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').all(id.username) as { id: number }[];
    } else if (opts.matchBy === 'email' && id.email && id.emailVerified) {
      candidates = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').all(id.email) as { id: number }[];
    }
    // Two accounts differing only in letter case: refuse to guess.
    if (candidates.length > 1) return { error: 'conflict' };
    if (candidates.length === 1) {
      const userId = candidates[0]!.id;
      // The account already belongs to a different identity at this provider.
      const taken = db.prepare('SELECT 1 FROM oidc_identities WHERE user_id = ? AND issuer = ?').get(userId, id.issuer);
      if (taken) return { error: 'conflict' };
      db.prepare(`INSERT INTO oidc_identities (issuer, subject, user_id, last_login_at) VALUES (?, ?, ?, datetime('now'))`)
        .run(id.issuer, id.subject, userId);
      return { userId, outcome: 'linked' };
    }

    if (!opts.autoProvision) return { error: 'not_provisioned' };

    const username = freeUsername(id.username ?? id.email?.split('@')[0] ?? null);
    // Keep the email only if no other account uses it (emails are unique).
    const emailFree = id.email !== null
      && !db.prepare('SELECT 1 FROM users WHERE lower(email) = lower(?)').get(id.email);
    const email = emailFree ? id.email : null;
    const r = db
      .prepare(`INSERT INTO users (username, password_hash, role, email, email_verified) VALUES (?, ?, 'user', ?, ?)`)
      .run(username, SSO_ONLY_PASSWORD, email, email && !id.emailVerified ? 0 : 1);
    const userId = Number(r.lastInsertRowid);
    const displayName = (id.displayName ?? username).slice(0, 60);
    // Same defaults as self-signup.
    db.prepare(
      `INSERT INTO profiles (user_id, display_name, language, audience, coach_behavior) VALUES (?, ?, ?, 'beginner', 'on_demand')`,
    ).run(userId, displayName, id.language);
    db.prepare(`INSERT INTO oidc_identities (issuer, subject, user_id, last_login_at) VALUES (?, ?, ?, datetime('now'))`)
      .run(id.issuer, id.subject, userId);
    return { userId, outcome: 'created' };
  })();
}

// The provider's username if nobody has it yet, else the first free
// "name-2", "name-3", … Same 2–40 character rule as signup.
function freeUsername(preferred: string | null): string {
  let base = (preferred ?? '').trim().slice(0, 40);
  if (base.length < 2) base = 'player';
  const taken = db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE');
  if (!taken.get(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, 40 - suffix.length)}${suffix}`;
    if (!taken.get(candidate)) return candidate;
  }
}

// ---- Logout ----------------------------------------------------------------

// The provider's end-session URL for an SSO session (RP-initiated logout), or
// null when the provider doesn't advertise one. The provider sends the
// browser back to Patzer's login page afterwards; that URL has to be listed
// among the provider's allowed redirect URIs.
export async function oidcLogoutUrl(c: Context, idToken: string): Promise<string | null> {
  try {
    const cfg = await oidcClient();
    if (!cfg.serverMetadata().end_session_endpoint) return null;
    return client.buildEndSessionUrl(cfg, {
      id_token_hint: idToken,
      post_logout_redirect_uri: `${publicBaseUrl(c)}/login`,
    }).href;
  } catch (err) {
    console.warn(`[oidc] could not build the logout URL: ${(err as Error).message}`);
    return null;
  }
}
