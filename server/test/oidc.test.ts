import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Config and the database are read on import: set the env first. Port 1 on
// localhost refuses connections, so provider discovery fails fast.
const dir = mkdtempSync(join(tmpdir(), 'patzer-oidc-'));
process.env.DB_PATH = join(dir, 'oidc.db');
process.env.OIDC_ISSUER = 'http://127.0.0.1:1/application/o/patzer/';
process.env.OIDC_CLIENT_ID = 'patzer';
process.env.OIDC_CLIENT_SECRET = 'secret';
process.env.OIDC_ONLY = 'true';
process.env.OIDC_BUTTON_TEXT = 'Sign in with Authentik';

type OidcModule = typeof import('../src/auth/oidc.js');
type DbModule = typeof import('../src/db.js');
type Router = { request: (path: string, init?: RequestInit) => Response | Promise<Response> };

let oidc: OidcModule;
let db: DbModule['db'];
let auth: Router;

const ISS = 'https://auth.example.com/application/o/patzer/';

function identity(over: Partial<import('../src/auth/oidc.js').OidcIdentity> = {}) {
  return {
    issuer: ISS,
    subject: 'sub-1',
    username: 'alice',
    email: 'alice@example.com',
    emailVerified: true,
    displayName: 'Alice A.',
    language: 'en' as const,
    ...over,
  };
}

function userRow(id: number) {
  return db.prepare('SELECT username, password_hash, role, email, email_verified FROM users WHERE id = ?').get(id) as {
    username: string; password_hash: string; role: string; email: string | null; email_verified: number;
  };
}

beforeAll(async () => {
  ({ db } = await import('../src/db.js'));
  oidc = await import('../src/auth/oidc.js');
  auth = (await import('../src/routes/auth.js')).default;
  db.prepare(`INSERT INTO users (id, username, password_hash, role, email) VALUES
    (1, 'Admin', 'x', 'admin', 'admin@example.com'),
    (2, 'bob', 'x', 'user', 'bob@example.com'),
    (3, 'Twin', 'x', 'user', NULL),
    (4, 'twin', 'x', 'user', NULL)`).run();
  db.prepare(`INSERT INTO profiles (user_id, display_name) VALUES (1, 'Admin'), (2, 'Bob'), (3, 'Twin'), (4, 'twin')`).run();
});

afterAll(() => {
  try { db.close(); } catch { /* ignore */ }
  rmSync(dir, { recursive: true, force: true });
});

describe('resolveOidcUser', () => {
  it('without matching or provisioning, an unknown identity is rejected', () => {
    const r = oidc.resolveOidcUser(identity({ subject: 'nobody' }), { matchBy: 'none', autoProvision: false });
    expect(r).toEqual({ error: 'not_provisioned' });
  });

  it('matches by username case-insensitively and links the identity', () => {
    const r = oidc.resolveOidcUser(identity({ subject: 'sub-admin', username: 'admin' }), { matchBy: 'username', autoProvision: false });
    expect(r).toEqual({ userId: 1, outcome: 'linked' });
    // Once linked, the identity finds the account with matching turned off.
    const again = oidc.resolveOidcUser(identity({ subject: 'sub-admin', username: 'renamed' }), { matchBy: 'none', autoProvision: false });
    expect(again).toEqual({ userId: 1, outcome: 'existing' });
  });

  it('refuses a second identity for an already linked account', () => {
    const r = oidc.resolveOidcUser(identity({ subject: 'sub-impostor', username: 'Admin' }), { matchBy: 'username', autoProvision: true });
    expect(r).toEqual({ error: 'conflict' });
  });

  it('refuses to guess between usernames that differ only in case', () => {
    const r = oidc.resolveOidcUser(identity({ subject: 'sub-twin', username: 'TWIN' }), { matchBy: 'username', autoProvision: true });
    expect(r).toEqual({ error: 'conflict' });
  });

  it('matches by email only when the provider marks it verified', () => {
    const unverified = oidc.resolveOidcUser(
      identity({ subject: 'sub-bob', username: 'robert', email: 'BOB@example.com', emailVerified: false }),
      { matchBy: 'email', autoProvision: false },
    );
    expect(unverified).toEqual({ error: 'not_provisioned' });
    const verified = oidc.resolveOidcUser(
      identity({ subject: 'sub-bob', username: 'robert', email: 'BOB@example.com', emailVerified: true }),
      { matchBy: 'email', autoProvision: false },
    );
    expect(verified).toEqual({ userId: 2, outcome: 'linked' });
  });

  it('provisions a new account with an unusable password and the provider profile', () => {
    const r = oidc.resolveOidcUser(identity({ subject: 'sub-carol', username: 'carol', email: 'carol@example.com', displayName: 'Carol C.', language: 'de' }), { matchBy: 'none', autoProvision: true });
    expect(r).toMatchObject({ outcome: 'created' });
    const id = (r as { userId: number }).userId;
    expect(userRow(id)).toEqual({ username: 'carol', password_hash: oidc.SSO_ONLY_PASSWORD, role: 'user', email: 'carol@example.com', email_verified: 1 });
    const profile = db.prepare('SELECT display_name, language FROM profiles WHERE user_id = ?').get(id);
    expect(profile).toEqual({ display_name: 'Carol C.', language: 'de' });
  });

  it('with matching off, a taken username gets a suffix and a taken email is dropped', () => {
    const r = oidc.resolveOidcUser(identity({ subject: 'sub-other-bob', username: 'bob', email: 'bob@example.com' }), { matchBy: 'none', autoProvision: true });
    const id = (r as { userId: number }).userId;
    expect(userRow(id)).toMatchObject({ username: 'bob-2', email: null });
    const next = oidc.resolveOidcUser(identity({ subject: 'sub-third-bob', username: 'Bob', email: null }), { matchBy: 'none', autoProvision: true });
    expect(userRow((next as { userId: number }).userId).username).toBe('Bob-3');
  });

  it('keeps an unverified email but marks it unverified', () => {
    const r = oidc.resolveOidcUser(identity({ subject: 'sub-dan', username: 'dan', email: 'dan@example.com', emailVerified: false }), { matchBy: 'none', autoProvision: true });
    expect(userRow((r as { userId: number }).userId)).toMatchObject({ email: 'dan@example.com', email_verified: 0 });
  });

  it('falls back to the email local part, then to "player", for the username', () => {
    const a = oidc.resolveOidcUser(identity({ subject: 'sub-e', username: null, email: 'erin@example.com' }), { matchBy: 'none', autoProvision: true });
    expect(userRow((a as { userId: number }).userId).username).toBe('erin');
    const b = oidc.resolveOidcUser(identity({ subject: 'sub-f', username: null, email: null }), { matchBy: 'none', autoProvision: true });
    expect(userRow((b as { userId: number }).userId).username).toBe('player');
  });

  it('a deleted account takes its identity link with it', () => {
    const r = oidc.resolveOidcUser(identity({ subject: 'sub-gone', username: 'gone' }), { matchBy: 'none', autoProvision: true });
    db.prepare('DELETE FROM users WHERE id = ?').run((r as { userId: number }).userId);
    expect(db.prepare('SELECT 1 FROM oidc_identities WHERE subject = ?').get('sub-gone')).toBeUndefined();
  });
});

describe('auth routes with OIDC_ONLY', () => {
  it('/config advertises SSO and hides signup and password reset', async () => {
    const res = await auth.request('/config');
    expect(await res.json()).toEqual({
      signup_enabled: false,
      signup_mode: 'closed',
      email_enabled: false,
      oidc_enabled: true,
      oidc_only: true,
      oidc_button_text: 'Sign in with Authentik',
    });
  });

  it.each([
    ['/login', { username: 'Admin', password: 'whatever' }, 'password_login_disabled'],
    ['/register', { username: 'zed', password: 'long-enough-pw', display_name: 'Zed' }, 'signup_disabled'],
    ['/forgot', { email: 'admin@example.com' }, 'password_login_disabled'],
    ['/reset', { token: 'x', password: 'long-enough-pw' }, 'password_login_disabled'],
  ])('POST %s is refused', async (path, body, error) => {
    const res = await auth.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error });
  });

  it('an unreachable provider sends the browser back to /login with an error', async () => {
    const res = await auth.request('/oidc/start');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/login?sso_error=unavailable');
  });

  it('a callback without the flow cookie is rejected as expired', async () => {
    const res = await auth.request('/oidc/callback?code=abc&state=def');
    expect(res.headers.get('location')).toBe('/login?sso_error=expired');
  });

  it('logging out of a password session returns no provider URL', async () => {
    const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');
    const cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(2))}`;
    const res = await auth.request('/logout', { method: 'POST', headers: { Cookie: cookie } });
    expect(await res.json()).toEqual({ ok: true });
  });
});
