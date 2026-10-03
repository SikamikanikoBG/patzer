import * as client from 'openid-client';
import type { Context } from 'hono';
import { getSignedCookie, setSignedCookie, deleteCookie } from 'hono/cookie';
import { db, getSetting, userCount } from '../db.js';
import { config, type OidcMatchBy } from '../config.js';
import { publicBaseUrl } from '../publicUrl.js';
import { setSignupMode } from './invites.js';

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
export type OidcErrorCode =
  | 'unavailable' | 'expired' | 'denied' | 'failed' | 'not_provisioned' | 'conflict' | 'admin_first';

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
  // The `groups` claim; null when the provider didn't send one at all.
  groups: string[] | null;
  language: Language;
}

// Control characters and bidi overrides have no business in a username or a
// display name, and would let a provider profile spoof names in the admin
// list ("evil\u202Egnp.exe") or break log lines. Joiners (ZWJ/ZWNJ) stay:
// emoji and some scripts need them.
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ufeff]/g;

export function cleanText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const clean = v.replace(UNSAFE_CHARS, '').trim();
  return clean === '' ? null : clean;
}

// For values that come from outside (the provider, the callback URL) and end
// up in a log line: no line breaks or other controls that could forge
// entries, and a length cap.
export function logSafe(v: unknown, max = 200): string {
  const s = String(v).replace(UNSAFE_CHARS, '?');
  return s.length > max ? `${s.slice(0, max)}…` : s;
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
    console.warn(`[oidc] userinfo failed, using ID token claims only: ${logSafe((err as Error).message)}`);
  }

  return {
    idToken: tokens.id_token,
    identity: {
      issuer: claims.iss,
      subject: claims.sub,
      username: cleanText(info.preferred_username),
      email: cleanText(info.email),
      emailVerified: info.email_verified === true || info.email_verified === 'true',
      displayName: cleanText(info.name),
      groups: Array.isArray(info.groups) ? info.groups.filter((g): g is string => typeof g === 'string') : null,
      language: pickLanguage(c),
    },
  };
}

// ---- Account resolution ----------------------------------------------------

export type ResolveResult =
  | {
      userId: number;
      outcome: 'existing' | 'linked' | 'created';
      role: 'admin' | 'user';
      // What changed on an existing account during this login, for the log.
      roleChanged: boolean;
      emailAdded: boolean;
    }
  | { error: 'not_provisioned' | 'conflict' | 'admin_first' };

export interface ResolveOptions {
  matchBy: OidcMatchBy;
  autoProvision: boolean;
  // OIDC_ADMIN_GROUP: the provider decides who is an admin.
  adminGroup: string | null;
  // OIDC_ONLY: there is no setup wizard, so SSO creates the first account.
  ssoOnly: boolean;
}

// Maps an identity to a Patzer account:
//  1. an identity seen before logs into the same account, whatever changed since;
//  2. otherwise OIDC_MATCH_BY may link it to an existing account by username
//     (case-insensitive) or by email (only when the provider says it's verified);
//  3. otherwise OIDC_AUTO_PROVISION decides whether a new account is created,
//     except for the very first account in SSO-only mode, which always is.
// With OIDC_ADMIN_GROUP set, the account's role follows the group on every
// login, and while no admin exists only members of the group get in.
export function resolveOidcUser(id: OidcIdentity, opts: ResolveOptions): ResolveResult {
  return db.transaction((): ResolveResult => {
    // null: no admin group configured, or the provider sent no groups claim.
    const inAdminGroup = opts.adminGroup && id.groups ? id.groups.includes(opts.adminGroup) : null;
    const adminCount = (db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin'`).get() as { n: number }).n;
    // Until the first admin has signed in, the provider group is the only
    // proof of who that should be.
    if (opts.adminGroup && adminCount === 0 && inAdminGroup !== true) return { error: 'admin_first' };

    let userId: number;
    let outcome: 'existing' | 'linked' | 'created';
    const linked = db
      .prepare('SELECT user_id FROM oidc_identities WHERE issuer = ? AND subject = ?')
      .get(id.issuer, id.subject) as { user_id: number } | undefined;
    if (linked) {
      db.prepare(`UPDATE oidc_identities SET last_login_at = datetime('now') WHERE issuer = ? AND subject = ?`)
        .run(id.issuer, id.subject);
      userId = linked.user_id;
      outcome = 'existing';
    } else {
      const match = findMatch(id, opts.matchBy);
      if (match === 'ambiguous') return { error: 'conflict' };
      if (match !== null) {
        // The account already belongs to a different identity at this provider.
        const taken = db.prepare('SELECT 1 FROM oidc_identities WHERE user_id = ? AND issuer = ?').get(match, id.issuer);
        if (taken) return { error: 'conflict' };
        db.prepare(`INSERT INTO oidc_identities (issuer, subject, user_id, last_login_at) VALUES (?, ?, ?, datetime('now'))`)
          .run(id.issuer, id.subject, match);
        userId = match;
        outcome = 'linked';
      } else {
        const firstAccount = opts.ssoOnly && userCount() === 0;
        if (!opts.autoProvision && !firstAccount) return { error: 'not_provisioned' };
        // Without an admin group, the first account in SSO-only mode is the admin.
        const role = inAdminGroup === true || (firstAccount && !opts.adminGroup) ? 'admin' : 'user';
        userId = createAccount(id, role);
        outcome = 'created';
      }
    }

    // Keep the role in step with the provider group. Without a groups claim
    // (scope or mapping missing) roles are left alone rather than guessed.
    let roleChanged = false;
    if (inAdminGroup !== null) {
      const want = inAdminGroup ? 'admin' : 'user';
      roleChanged = db.prepare('UPDATE users SET role = ? WHERE id = ? AND role != ?').run(want, userId, want).changes > 0;
    }

    // An existing account without an email gets the provider's, so password
    // resets and notifications work for it too. An email it already has is
    // never overwritten.
    let emailAdded = false;
    if (outcome !== 'created' && id.email) {
      const free = !db.prepare('SELECT 1 FROM users WHERE lower(email) = lower(?) AND id != ?').get(id.email, userId);
      if (free) {
        emailAdded = db
          .prepare('UPDATE users SET email = ?, email_verified = ? WHERE id = ? AND email IS NULL')
          .run(id.email, id.emailVerified ? 1 : 0, userId).changes > 0;
      }
    }

    const { role } = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: 'admin' | 'user' };
    return { userId, outcome, role, roleChanged, emailAdded };
  })();
}

// The account OIDC_MATCH_BY points at: its id, null for none, or 'ambiguous'
// for two accounts whose usernames differ only in letter case.
function findMatch(id: OidcIdentity, matchBy: OidcMatchBy): number | null | 'ambiguous' {
  let rows: { id: number }[] = [];
  if (matchBy === 'username' && id.username) {
    rows = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').all(id.username) as { id: number }[];
  } else if (matchBy === 'email' && id.email && id.emailVerified) {
    rows = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').all(id.email) as { id: number }[];
  }
  if (rows.length > 1) return 'ambiguous';
  return rows[0]?.id ?? null;
}

// A new account for a first SSO login, with the provider's profile and no
// password. Called inside resolveOidcUser's transaction.
function createAccount(id: OidcIdentity, role: 'admin' | 'user'): number {
  const username = freeUsername(id.username ?? id.email?.split('@')[0] ?? null);
  // Keep the email only if no other account uses it (emails are unique).
  const emailFree = id.email !== null
    && !db.prepare('SELECT 1 FROM users WHERE lower(email) = lower(?)').get(id.email);
  const email = emailFree ? id.email : null;
  const r = db
    .prepare(`INSERT INTO users (username, password_hash, role, email, email_verified, created_via) VALUES (?, ?, ?, ?, ?, 'sso')`)
    .run(username, SSO_ONLY_PASSWORD, role, email, email && !id.emailVerified ? 0 : 1);
  const userId = Number(r.lastInsertRowid);
  const displayName = (id.displayName ?? username).slice(0, 60);
  // Same defaults as self-signup.
  db.prepare(
    `INSERT INTO profiles (user_id, display_name, language, audience, coach_behavior) VALUES (?, ?, ?, 'beginner', 'on_demand')`,
  ).run(userId, displayName, id.language);
  db.prepare(`INSERT INTO oidc_identities (issuer, subject, user_id, last_login_at) VALUES (?, ?, ?, datetime('now'))`)
    .run(id.issuer, id.subject, userId);
  return userId;
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

// ---- First run in SSO-only mode ---------------------------------------------

// With OIDC_ONLY there's no setup wizard: nobody could use a local password
// anyway. On a fresh install this does what the wizard would have, minus the
// parts that need a person: sign-up is closed (accounts come from the
// provider) and the coach stays unconfigured until an admin sets it up in
// Admin → System. The first SSO login then creates the admin. Runs at startup;
// does nothing once any account exists.
export function prepareSsoOnlyFirstRun(): boolean {
  if (!config.oidc.only || userCount() > 0) return false;
  setSignupMode('closed');
  console.log(
    config.oidc.adminGroup
      ? `[oidc] fresh install in SSO-only mode: no setup wizard; the first member of "${config.oidc.adminGroup}" to sign in becomes the admin`
      : '[oidc] fresh install in SSO-only mode: no setup wizard; the first person to sign in becomes the admin',
  );
  return true;
}

// Without a fixed public address, the callback URL is built from the request's
// Host / X-Forwarded-Host headers. The provider's strict redirect URI check
// stops that from leaking codes, but the setup is fragile and should be fixed.
export function warnIfNoPublicBaseUrl(): boolean {
  if (!config.oidc.enabled || getSetting('public_base_url') || process.env.PUBLIC_BASE_URL) return false;
  console.warn(
    '[oidc] PUBLIC_BASE_URL is not set, so the SSO callback URL is built from request headers. '
    + 'Set it to the address people use, e.g. https://chess.example.com',
  );
  return true;
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
    console.warn(`[oidc] could not build the logout URL: ${logSafe((err as Error).message)}`);
    return null;
  }
}
