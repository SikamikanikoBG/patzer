import { Hono } from 'hono';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { db, getSetting, userCount } from '../db.js';
import { config } from '../config.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import { issueToken, consumeToken } from '../auth/tokens.js';
import {
  signupMode,
  findInvite,
  inviteStatus,
  consumeInvite,
  normalizeInviteCode,
  type InviteRow,
} from '../auth/invites.js';
import { publicBaseUrl } from '../publicUrl.js';
import {
  isMailerConfigured,
  sendMail,
  verifyEmailTemplate,
  resetPasswordTemplate,
  adminNewUserTemplate,
} from '../email/mailer.js';
import {
  createSession,
  destroySession,
  lookupUser,
  sessionOidcIdToken,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from '../auth/sessions.js';
import { beginOidcLogin, finishOidcLogin, resolveOidcUser, oidcLogoutUrl, OidcError } from '../auth/oidc.js';
import type { Profile, Role } from '../types.js';

const router = new Hono();

const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

// Per-IP + per-username sliding window. bcrypt cost-12 is ~250ms per check,
// so without this an attacker can pin the event loop with parallel POSTs.
// Limits are intentionally generous for legitimate users (10 attempts in 5
// minutes) but cut credential stuffing dead. The window is in-process, so it
// resets on container restart — that's acceptable for a single-host deploy.
const LOGIN_WINDOW_MS = 5 * 60_000;
const LOGIN_MAX_ATTEMPTS = 10;
type Bucket = { count: number; resetAt: number };
const ipBuckets = new Map<string, Bucket>();
const userBuckets = new Map<string, Bucket>();

function takeBucket(map: Map<string, Bucket>, key: string, now: number): Bucket {
  let b = map.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + LOGIN_WINDOW_MS };
    map.set(key, b);
  }
  return b;
}

function rateLimit(ip: string, username: string): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  // Lazy GC — sweep every call on average without paying for setInterval timers.
  if (ipBuckets.size > 1000 || userBuckets.size > 1000) {
    for (const [k, v] of ipBuckets) if (v.resetAt <= now) ipBuckets.delete(k);
    for (const [k, v] of userBuckets) if (v.resetAt <= now) userBuckets.delete(k);
  }
  const ipBucket = takeBucket(ipBuckets, ip, now);
  const userBucket = takeBucket(userBuckets, username.toLowerCase(), now);
  if (ipBucket.count >= LOGIN_MAX_ATTEMPTS || userBucket.count >= LOGIN_MAX_ATTEMPTS) {
    const resetAt = Math.max(ipBucket.resetAt, userBucket.resetAt);
    return { allowed: false, retryAfter: Math.ceil((resetAt - now) / 1000) };
  }
  ipBucket.count++;
  userBucket.count++;
  return { allowed: true, retryAfter: 0 };
}

function clientIp(c: { req: { header: (k: string) => string | undefined } }): string {
  // Prefer X-Forwarded-For if a reverse proxy is in front; first hop is the client.
  // Hono's node adapter exposes the underlying socket via `getConnInfo`, but for
  // rate-limiting purposes a coarse "direct" bucket is fine when no proxy is in
  // play — the per-username bucket is the dominant guard against credential
  // stuffing, and a real LAN deploy almost always has a proxy.
  const xff = c.req.header('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  const real = c.req.header('x-real-ip');
  if (real) return real.trim();
  return 'direct';
}

function sessionCookieOpts() {
  return {
    httpOnly: true,
    sameSite: 'Lax' as const,
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
    secure: config.cookieSecure,
  };
}

router.post('/login', async (c) => {
  if (config.oidc.only) return c.json({ error: 'password_login_disabled' }, 403);
  const body = await c.req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);

  const { username, password } = parsed.data;
  const ip = clientIp(c);
  const limit = rateLimit(ip, username);
  if (!limit.allowed) {
    console.warn(`[auth] rate_limited ip=${ip} user=${username}`);
    c.header('Retry-After', String(limit.retryAfter));
    return c.json({ error: 'rate_limited', retry_after: limit.retryAfter }, 429);
  }

  const row = db
    .prepare('SELECT id, username, password_hash, role, email, email_verified FROM users WHERE username = ?')
    .get(username) as
    | { id: number; username: string; password_hash: string; role: Role; email: string | null; email_verified: number }
    | undefined;

  if (!row) {
    console.warn(`[auth] login_failed ip=${ip} user=${username} reason=unknown_user`);
    return c.json({ error: 'invalid_credentials' }, 401);
  }
  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) {
    console.warn(`[auth] login_failed ip=${ip} user=${username} reason=bad_password`);
    return c.json({ error: 'invalid_credentials' }, 401);
  }

  // Gate unverified accounts only when an admin has turned verification on AND
  // a working mailer exists — otherwise enforcing it would strand users with no
  // way to ever verify. Accounts with no email have nothing to verify and pass.
  if (
    getSetting('require_email_verification') === '1' &&
    isMailerConfigured() &&
    row.email &&
    !row.email_verified
  ) {
    console.warn(`[auth] login_blocked ip=${ip} user=${username} reason=email_unverified`);
    return c.json({ error: 'email_unverified' }, 403);
  }

  // Rotate: any cookie they were carrying gets replaced; the old token (if it
  // was a valid session) is destroyed so a stolen pre-login cookie can't ride
  // the freshly-authenticated identity.
  const existing = getCookie(c, SESSION_COOKIE_NAME);
  if (existing) destroySession(existing);

  const cookie = createSession(row.id);
  setCookie(c, SESSION_COOKIE_NAME, cookie, sessionCookieOpts());

  console.log(`[auth] login_ok ip=${ip} user=${username} role=${row.role}`);
  const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(row.id) as Profile;
  return c.json({ user: { id: row.id, username: row.username, role: row.role, profile } });
});

router.post('/logout', async (c) => {
  const signed = getCookie(c, SESSION_COOKIE_NAME);
  // Read before destroying: an SSO session also ends at the provider, by
  // sending the browser to its end-session URL (the web app follows logout_url).
  const idToken = signed && config.oidc.enabled ? sessionOidcIdToken(signed) : null;
  if (signed) destroySession(signed);
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
  const logoutUrl = idToken ? await oidcLogoutUrl(c, idToken) : null;
  return c.json(logoutUrl ? { ok: true, logout_url: logoutUrl } : { ok: true });
});

// ---- Single sign-on (OpenID Connect) ---------------------------------------

// The login page's SSO button is a plain link here; we answer with a redirect
// to the provider.
router.get('/oidc/start', async (c) => {
  if (!config.oidc.enabled) return c.notFound();
  try {
    return c.redirect(await beginOidcLogin(c));
  } catch (err) {
    const code = err instanceof OidcError ? err.code : 'failed';
    console.error(`[auth] sso_start_failed reason=${code}: ${(err as Error).message}`);
    return c.redirect(`/login?sso_error=${code}`);
  }
});

// The provider sends the browser back here with an authorization code.
router.get('/oidc/callback', async (c) => {
  if (!config.oidc.enabled) return c.notFound();
  // On a fresh install the setup wizard creates the admin first; letting SSO
  // create the first account would skip it. In SSO-only mode there is no
  // wizard, and the first SSO login creates the admin instead.
  if (userCount() === 0 && !config.oidc.only) return c.redirect('/');
  const ip = clientIp(c);

  let login: Awaited<ReturnType<typeof finishOidcLogin>>;
  try {
    login = await finishOidcLogin(c);
  } catch (err) {
    const code = err instanceof OidcError ? err.code : 'failed';
    console.warn(`[auth] sso_failed ip=${ip} reason=${code}: ${(err as Error).message}`);
    return c.redirect(`/login?sso_error=${code}`);
  }

  const { identity } = login;
  if (config.oidc.adminGroup && identity.groups === null) {
    console.warn('[oidc] OIDC_ADMIN_GROUP is set but the provider sent no "groups" claim; roles are left unchanged');
  }
  const result = resolveOidcUser(identity, {
    matchBy: config.oidc.matchBy,
    autoProvision: config.oidc.autoProvision,
    adminGroup: config.oidc.adminGroup,
    ssoOnly: config.oidc.only,
  });
  if ('error' in result) {
    console.warn(`[auth] sso_rejected ip=${ip} sub=${identity.subject} user=${identity.username ?? '-'} reason=${result.error}`);
    return c.redirect(`/login?sso_error=${result.error}`);
  }

  // Same rotation as password login.
  const existing = getCookie(c, SESSION_COOKIE_NAME);
  if (existing) destroySession(existing);
  setCookie(c, SESSION_COOKIE_NAME, createSession(result.userId, { oidcIdToken: login.idToken }), sessionCookieOpts());
  const notes = [result.roleChanged && 'role_changed', result.emailAdded && 'email_added'].filter(Boolean).join(' ');
  console.log(`[auth] sso_login_ok ip=${ip} user_id=${result.userId} sub=${identity.subject} account=${result.outcome} role=${result.role}${notes ? ` ${notes}` : ''}`);
  return c.redirect('/');
});

router.get('/me', (c) => {
  const cookie = getCookie(c, SESSION_COOKIE_NAME);
  const user = lookupUser(cookie);
  if (!user) return c.json({ user: null });
  return c.json({ user });
});

// ---- Self-service signup + email flows -----------------------------------

// Public capability probe so the login/signup pages can show or hide the
// "Sign up" and "Forgot password?" affordances without guessing.
// signup_enabled stays for older front-ends: true for 'open' and 'invite'.
router.get('/config', (c) => {
  const only = config.oidc.only;
  const mode = only ? 'closed' : signupMode();
  return c.json({
    signup_enabled: mode !== 'closed',
    signup_mode: mode,
    // Drives the "Forgot password?" link, which means nothing without passwords.
    email_enabled: !only && isMailerConfigured(),
    oidc_enabled: config.oidc.enabled,
    oidc_only: only,
    oidc_button_text: config.oidc.buttonText || null,
  });
});

// Lets the signup page say "this invite has expired" before anyone fills in
// the form, and switch to the invite's preset language. The admin's note is
// never returned — it is for the admin only.
router.get('/invite', (c) => {
  const invite = findInvite(c.req.query('code') ?? '');
  if (!invite) return c.json({ valid: false, reason: 'invalid' });
  const status = inviteStatus(invite);
  if (status !== 'active') return c.json({ valid: false, reason: status });
  return c.json({ valid: true, language: invite.language });
});

const registerSchema = z.object({
  username: z.string().trim().min(2).max(40),
  password: z.string().min(10).max(200),
  display_name: z.string().trim().min(1).max(60),
  // Optional, but if present must be a real address. Empty string is coerced to
  // "absent" so the front-end can always send the field.
  email: z.union([z.string().trim().email().max(200), z.literal('')]).optional(),
  language: z.enum(['en', 'bg', 'es', 'de', 'ru']).default('en'),
  // Required when signup is invite-only; optional (but still checked) when it
  // is open, where it only presets language and audience.
  invite: z.string().max(40).optional(),
});

// Thrown inside the signup transaction to roll the new account back.
class InviteSpent extends Error {}

router.post('/register', async (c) => {
  if (userCount() === 0) return c.json({ error: 'setup_required' }, 409);
  if (config.oidc.only) return c.json({ error: 'signup_disabled' }, 403);
  const mode = signupMode();
  if (mode === 'closed') return c.json({ error: 'signup_disabled' }, 403);

  const body = await c.req.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input', details: parsed.error.flatten() }, 400);
  const { username, password, display_name } = parsed.data;
  const email = parsed.data.email ? parsed.data.email : null;
  const inviteCode = normalizeInviteCode(parsed.data.invite ?? '');
  if (mode === 'invite' && !inviteCode) return c.json({ error: 'invite_required' }, 403);

  // Reuse the login limiter buckets — registration is just as abusable for
  // resource exhaustion (each call runs a ~250ms bcrypt hash).
  const ip = clientIp(c);
  const limit = rateLimit(ip, username);
  if (!limit.allowed) {
    c.header('Retry-After', String(limit.retryAfter));
    return c.json({ error: 'rate_limited', retry_after: limit.retryAfter }, 429);
  }

  let invite: InviteRow | undefined;
  if (inviteCode) {
    invite = findInvite(inviteCode);
    const status = invite ? inviteStatus(invite) : 'invalid';
    if (status !== 'active') return c.json({ error: `invite_${status}` }, 403);
  }
  // An invite's presets beat what the browser sent: a coach handing out
  // "beginner, Spanish" links to a class wants exactly that.
  const language = invite?.language ?? parsed.data.language;
  const audience = invite?.audience ?? 'beginner';

  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
    return c.json({ error: 'username_taken' }, 409);
  }
  if (email && db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(email)) {
    return c.json({ error: 'email_taken' }, 409);
  }

  const mailer = isMailerConfigured();
  // A supplied email is "unverified" only if we can actually email a link.
  // Without a mailer there is no verification path, so don't strand the user.
  const emailVerified = email && mailer ? 0 : 1;
  const passwordHash = await hashPassword(password);

  let userId: number;
  try {
    userId = db.transaction(() => {
      // Someone else can take the last use during the bcrypt hash above.
      if (invite && !consumeInvite(invite.id)) throw new InviteSpent();
      const r = db
        .prepare(`INSERT INTO users (username, password_hash, role, email, email_verified, invite_id) VALUES (?, ?, 'user', ?, ?, ?)`)
        .run(username, passwordHash, email, emailVerified, invite?.id ?? null);
      const id = Number(r.lastInsertRowid);
      // Self-signups default to the friendliest profile; they can change it in
      // Settings. 'beginner' audience keeps the coach approachable out of the box.
      db.prepare(
        `INSERT INTO profiles (user_id, display_name, language, audience, coach_behavior) VALUES (?, ?, ?, ?, 'on_demand')`,
      ).run(id, display_name, language, audience);
      return id;
    })();
  } catch (err) {
    if (err instanceof InviteSpent) return c.json({ error: 'invite_used_up' }, 403);
    // UNIQUE violations can still slip through the pre-checks under a race.
    const msg = (err as Error).message || '';
    if (/users\.username/i.test(msg)) return c.json({ error: 'username_taken' }, 409);
    if (/users\.email|idx_users_email/i.test(msg)) return c.json({ error: 'email_taken' }, 409);
    throw err;
  }

  // Best-effort emails — never block or fail the signup on a mail hiccup.
  if (email && mailer) {
    const token = issueToken(userId, 'verify');
    const link = `${publicBaseUrl(c)}/verify-email?token=${token}`;
    const tpl = verifyEmailTemplate(display_name, link);
    void sendMail({ to: email, ...tpl });
  }
  if (mailer && getSetting('notify_admin_on_signup') !== '0') {
    const admins = db
      .prepare(`SELECT u.email, p.display_name FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.role = 'admin' AND u.email IS NOT NULL AND u.email <> ''`)
      .all() as { email: string; display_name: string }[];
    for (const a of admins) {
      const tpl = adminNewUserTemplate(a.display_name, username, email);
      void sendMail({ to: a.email, ...tpl });
    }
  }

  const requireVerification = getSetting('require_email_verification') === '1' && mailer && !!email;
  if (requireVerification) {
    // Don't hand out a session until they prove the email; the front-end shows
    // a "check your inbox" screen.
    console.log(`[auth] register_pending_verification user=${username}`);
    return c.json({ ok: true, verification_required: true });
  }

  // Otherwise log them straight in, same as a normal login.
  const cookie = createSession(userId);
  setCookie(c, SESSION_COOKIE_NAME, cookie, sessionCookieOpts());
  console.log(`[auth] register_ok ip=${ip} user=${username} email=${email ? 'yes' : 'no'} invite=${invite ? invite.id : 'none'}`);
  const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId) as Profile;
  return c.json({ user: { id: userId, username, role: 'user' as Role, profile }, verification_required: false });
});

const emailOnlySchema = z.object({ email: z.string().trim().email().max(200) });

// Generic-success on purpose: we never reveal whether an address has an account
// (account-enumeration guard). The work only happens when it lines up.
router.post('/forgot', async (c) => {
  if (config.oidc.only) return c.json({ error: 'password_login_disabled' }, 403);
  const body = await c.req.json().catch(() => null);
  const parsed = emailOnlySchema.safeParse(body);
  // Even malformed input gets the same opaque 200 — no oracle.
  if (!parsed.success) return c.json({ ok: true });
  const email = parsed.data.email;

  const ip = clientIp(c);
  const limit = rateLimit(ip, `forgot:${email.toLowerCase()}`);
  if (!limit.allowed) {
    c.header('Retry-After', String(limit.retryAfter));
    return c.json({ error: 'rate_limited', retry_after: limit.retryAfter }, 429);
  }

  if (isMailerConfigured()) {
    const row = db
      .prepare(`SELECT u.id, p.display_name FROM users u JOIN profiles p ON p.user_id = u.id WHERE lower(u.email) = lower(?)`)
      .get(email) as { id: number; display_name: string } | undefined;
    if (row) {
      const token = issueToken(row.id, 'reset');
      const link = `${publicBaseUrl(c)}/reset-password?token=${token}`;
      const tpl = resetPasswordTemplate(row.display_name, link);
      void sendMail({ to: email, ...tpl });
      console.log(`[auth] reset_requested user_id=${row.id}`);
    }
  }
  return c.json({ ok: true });
});

const resetSchema = z.object({
  token: z.string().min(1).max(200),
  password: z.string().min(10).max(200),
});

router.post('/reset', async (c) => {
  if (config.oidc.only) return c.json({ error: 'password_login_disabled' }, 403);
  const body = await c.req.json().catch(() => null);
  const parsed = resetSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input', details: parsed.error.flatten() }, 400);

  const userId = consumeToken(parsed.data.token, 'reset');
  if (userId === null) return c.json({ error: 'invalid_or_expired' }, 400);

  const hash = await hashPassword(parsed.data.password);
  db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
    // Reaching a reset link proves control of the inbox — clear the unverified
    // flag too so a "forgot password" also completes verification.
    db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(userId);
    // Nuke every existing session: if the reset was triggered because the
    // account was compromised, this is what actually evicts the attacker.
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  })();
  console.log(`[auth] reset_completed user_id=${userId}`);
  return c.json({ ok: true });
});

router.post('/verify', async (c) => {
  const body = await c.req.json().catch(() => null);
  const token = body && typeof body === 'object' && typeof (body as { token?: unknown }).token === 'string'
    ? (body as { token: string }).token
    : '';
  if (!token) return c.json({ error: 'invalid_or_expired' }, 400);
  const userId = consumeToken(token, 'verify');
  if (userId === null) return c.json({ error: 'invalid_or_expired' }, 400);
  db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(userId);
  console.log(`[auth] email_verified user_id=${userId}`);
  return c.json({ ok: true });
});

// Re-send a verification link. Generic 200 regardless, so it can't be used to
// probe which emails exist or which are already verified.
router.post('/resend-verification', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = emailOnlySchema.safeParse(body);
  if (!parsed.success) return c.json({ ok: true });
  const email = parsed.data.email;
  const ip = clientIp(c);
  const limit = rateLimit(ip, `resend:${email.toLowerCase()}`);
  if (!limit.allowed) {
    c.header('Retry-After', String(limit.retryAfter));
    return c.json({ error: 'rate_limited', retry_after: limit.retryAfter }, 429);
  }
  if (isMailerConfigured()) {
    const row = db
      .prepare(`SELECT u.id, p.display_name FROM users u JOIN profiles p ON p.user_id = u.id WHERE lower(u.email) = lower(?) AND u.email_verified = 0`)
      .get(email) as { id: number; display_name: string } | undefined;
    if (row) {
      const token = issueToken(row.id, 'verify');
      const link = `${publicBaseUrl(c)}/verify-email?token=${token}`;
      const tpl = verifyEmailTemplate(row.display_name, link);
      void sendMail({ to: email, ...tpl });
    }
  }
  return c.json({ ok: true });
});

export default router;
