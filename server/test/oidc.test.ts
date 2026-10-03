import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
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
let admin: Router;
let sessions: typeof import('../src/auth/sessions.js');

const ISS = 'https://auth.example.com/application/o/patzer/';
const ADMINS = 'patzer-admins';

function identity(over: Partial<import('../src/auth/oidc.js').OidcIdentity> = {}) {
  return {
    issuer: ISS,
    subject: 'sub-1',
    username: 'alice',
    email: 'alice@example.com',
    emailVerified: true,
    displayName: 'Alice A.',
    groups: null,
    language: 'en' as const,
    ...over,
  };
}

function opts(over: Partial<import('../src/auth/oidc.js').ResolveOptions> = {}) {
  return { matchBy: 'none' as const, autoProvision: false, adminGroup: null, ssoOnly: false, ...over };
}

function userRow(id: number) {
  return db.prepare('SELECT username, password_hash, role, email, email_verified, created_via FROM users WHERE id = ?').get(id) as {
    username: string; password_hash: string; role: string; email: string | null; email_verified: number; created_via: string;
  };
}

const idOf = (r: unknown) => (r as { userId: number }).userId;

// Every test starts from the same four password accounts.
beforeEach(() => {
  db.exec('DELETE FROM users');
  db.prepare(`INSERT INTO users (id, username, password_hash, role, email) VALUES
    (1, 'Admin', 'x', 'admin', 'admin@example.com'),
    (2, 'bob', 'x', 'user', 'bob@example.com'),
    (3, 'Twin', 'x', 'user', NULL),
    (4, 'twin', 'x', 'user', NULL)`).run();
  db.prepare(`INSERT INTO profiles (user_id, display_name) VALUES (1, 'Admin'), (2, 'Bob'), (3, 'Twin'), (4, 'twin')`).run();
});

beforeAll(async () => {
  ({ db } = await import('../src/db.js'));
  oidc = await import('../src/auth/oidc.js');
  sessions = await import('../src/auth/sessions.js');
  auth = (await import('../src/routes/auth.js')).default;
  admin = (await import('../src/routes/admin.js')).default;
});

afterAll(() => {
  try { db.close(); } catch { /* ignore */ }
  rmSync(dir, { recursive: true, force: true });
});

describe('resolveOidcUser: finding the account', () => {
  it('without matching or provisioning, an unknown identity is rejected', () => {
    expect(oidc.resolveOidcUser(identity({ subject: 'nobody' }), opts())).toEqual({ error: 'not_provisioned' });
  });

  it('matches by username case-insensitively, links it, and an identity seen before needs no matching', () => {
    const r = oidc.resolveOidcUser(identity({ subject: 'sub-admin', username: 'admin' }), opts({ matchBy: 'username' }));
    expect(r).toMatchObject({ userId: 1, outcome: 'linked', role: 'admin' });
    const again = oidc.resolveOidcUser(identity({ subject: 'sub-admin', username: 'renamed' }), opts());
    expect(again).toMatchObject({ userId: 1, outcome: 'existing' });
  });

  it('refuses a second identity for an already linked account', () => {
    oidc.resolveOidcUser(identity({ subject: 'sub-admin', username: 'admin' }), opts({ matchBy: 'username' }));
    const r = oidc.resolveOidcUser(identity({ subject: 'sub-impostor', username: 'Admin' }), opts({ matchBy: 'username', autoProvision: true }));
    expect(r).toEqual({ error: 'conflict' });
  });

  it('refuses to guess between usernames that differ only in case', () => {
    const r = oidc.resolveOidcUser(identity({ subject: 'sub-twin', username: 'TWIN' }), opts({ matchBy: 'username', autoProvision: true }));
    expect(r).toEqual({ error: 'conflict' });
  });

  it('matches by email only when the provider marks it verified', () => {
    const who = { subject: 'sub-bob', username: 'robert', email: 'BOB@example.com' };
    expect(oidc.resolveOidcUser(identity({ ...who, emailVerified: false }), opts({ matchBy: 'email' }))).toEqual({ error: 'not_provisioned' });
    expect(oidc.resolveOidcUser(identity({ ...who, emailVerified: true }), opts({ matchBy: 'email' }))).toMatchObject({ userId: 2, outcome: 'linked' });
  });

  it('a deleted account takes its identity link with it', () => {
    const r = oidc.resolveOidcUser(identity({ subject: 'sub-gone', username: 'gone' }), opts({ autoProvision: true }));
    db.prepare('DELETE FROM users WHERE id = ?').run(idOf(r));
    expect(db.prepare('SELECT 1 FROM oidc_identities WHERE subject = ?').get('sub-gone')).toBeUndefined();
  });
});

describe('resolveOidcUser: new accounts', () => {
  it('get the provider profile, no usable password, and are marked as created by SSO', () => {
    const r = oidc.resolveOidcUser(
      identity({ subject: 'sub-carol', username: 'carol', email: 'carol@example.com', displayName: 'Carol C.', language: 'de' }),
      opts({ autoProvision: true }),
    );
    expect(r).toMatchObject({ outcome: 'created', role: 'user' });
    expect(userRow(idOf(r))).toEqual({
      username: 'carol', password_hash: oidc.SSO_ONLY_PASSWORD, role: 'user', email: 'carol@example.com', email_verified: 1, created_via: 'sso',
    });
    expect(db.prepare('SELECT display_name, language FROM profiles WHERE user_id = ?').get(idOf(r))).toEqual({ display_name: 'Carol C.', language: 'de' });
  });

  it('get a suffix for a taken username, and no email if another account has it', () => {
    const r = oidc.resolveOidcUser(identity({ subject: 'sub-other-bob', username: 'bob', email: 'bob@example.com' }), opts({ autoProvision: true }));
    expect(userRow(idOf(r))).toMatchObject({ username: 'bob-2', email: null });
    const next = oidc.resolveOidcUser(identity({ subject: 'sub-third-bob', username: 'Bob', email: null }), opts({ autoProvision: true }));
    expect(userRow(idOf(next)).username).toBe('Bob-3');
  });

  it('keep an unverified email but mark it unverified', () => {
    const r = oidc.resolveOidcUser(identity({ subject: 'sub-dan', username: 'dan', email: 'dan@example.com', emailVerified: false }), opts({ autoProvision: true }));
    expect(userRow(idOf(r))).toMatchObject({ email: 'dan@example.com', email_verified: 0 });
  });

  it('fall back to the email local part, then to "player", for the username', () => {
    const a = oidc.resolveOidcUser(identity({ subject: 'sub-e', username: null, email: 'erin@example.com' }), opts({ autoProvision: true }));
    expect(userRow(idOf(a)).username).toBe('erin');
    const b = oidc.resolveOidcUser(identity({ subject: 'sub-f', username: null, email: null }), opts({ autoProvision: true }));
    expect(userRow(idOf(b)).username).toBe('player');
  });

  it('accounts created any other way stay marked as password accounts', () => {
    expect(userRow(2).created_via).toBe('password');
  });
});

describe('resolveOidcUser: storing the email of matched accounts', () => {
  it('an account without an email gets the provider one when it is linked', () => {
    const r = oidc.resolveOidcUser(identity({ subject: 'sub-twin3', username: 'Twin', email: 'twin@example.com' }), opts({ matchBy: 'username' }));
    // "Twin" and "twin" both exist: drop one so the match is unambiguous.
    expect(r).toEqual({ error: 'conflict' });
    db.prepare('DELETE FROM users WHERE id = 4').run();
    const ok = oidc.resolveOidcUser(identity({ subject: 'sub-twin3', username: 'Twin', email: 'twin@example.com' }), opts({ matchBy: 'username' }));
    expect(ok).toMatchObject({ userId: 3, outcome: 'linked', emailAdded: true });
    expect(userRow(3)).toMatchObject({ email: 'twin@example.com', email_verified: 1 });
  });

  it('an email the account already has is never overwritten', () => {
    const r = oidc.resolveOidcUser(identity({ subject: 'sub-b', username: 'bob', email: 'robert@elsewhere.example' }), opts({ matchBy: 'username' }));
    expect(r).toMatchObject({ userId: 2, emailAdded: false });
    expect(userRow(2).email).toBe('bob@example.com');
  });

  it('an email another account already uses is not copied', () => {
    db.prepare('DELETE FROM users WHERE id = 4').run();
    const r = oidc.resolveOidcUser(identity({ subject: 'sub-t', username: 'twin', email: 'bob@example.com' }), opts({ matchBy: 'username' }));
    expect(r).toMatchObject({ userId: 3, emailAdded: false });
    expect(userRow(3).email).toBeNull();
  });

  it('is filled in on a later login too, once the account has none', () => {
    db.prepare('DELETE FROM users WHERE id = 4').run();
    oidc.resolveOidcUser(identity({ subject: 'sub-t', username: 'twin', email: null }), opts({ matchBy: 'username' }));
    const later = oidc.resolveOidcUser(identity({ subject: 'sub-t', username: 'twin', email: 'twin@example.com', emailVerified: false }), opts());
    expect(later).toMatchObject({ outcome: 'existing', emailAdded: true });
    expect(userRow(3)).toMatchObject({ email: 'twin@example.com', email_verified: 0 });
  });
});

describe('resolveOidcUser: OIDC_ADMIN_GROUP', () => {
  const group = (member: boolean) => ({ groups: member ? ['family', ADMINS] : ['family'] });

  it('a new member of the group is created as an admin, anyone else as a user', () => {
    const a = oidc.resolveOidcUser(identity({ subject: 'sub-g1', username: 'gina', ...group(true) }), opts({ autoProvision: true, adminGroup: ADMINS }));
    expect(a).toMatchObject({ outcome: 'created', role: 'admin' });
    const u = oidc.resolveOidcUser(identity({ subject: 'sub-g2', username: 'hank', ...group(false) }), opts({ autoProvision: true, adminGroup: ADMINS }));
    expect(u).toMatchObject({ outcome: 'created', role: 'user' });
  });

  it('the role follows the group on every login, both ways', () => {
    const o = opts({ matchBy: 'username', adminGroup: ADMINS });
    expect(oidc.resolveOidcUser(identity({ subject: 'sub-bob', username: 'bob', ...group(true) }), o)).toMatchObject({ role: 'admin', roleChanged: true });
    expect(oidc.resolveOidcUser(identity({ subject: 'sub-bob', username: 'bob', ...group(false) }), o)).toMatchObject({ role: 'user', roleChanged: true });
    expect(oidc.resolveOidcUser(identity({ subject: 'sub-bob', username: 'bob', ...group(false) }), o)).toMatchObject({ role: 'user', roleChanged: false });
  });

  it('without a groups claim, roles are left alone', () => {
    const r = oidc.resolveOidcUser(identity({ subject: 'sub-admin', username: 'Admin', groups: null }), opts({ matchBy: 'username', adminGroup: ADMINS }));
    expect(r).toMatchObject({ userId: 1, role: 'admin', roleChanged: false });
  });

  it('while no admin exists, only members of the group get in', () => {
    db.prepare(`UPDATE users SET role = 'user'`).run();
    const o = opts({ matchBy: 'username', autoProvision: true, adminGroup: ADMINS });
    expect(oidc.resolveOidcUser(identity({ subject: 'sub-bob', username: 'bob', ...group(false) }), o)).toEqual({ error: 'admin_first' });
    expect(oidc.resolveOidcUser(identity({ subject: 'sub-new', username: 'newbie', groups: null }), o)).toEqual({ error: 'admin_first' });
    expect(oidc.resolveOidcUser(identity({ subject: 'sub-admin', username: 'Admin', ...group(true) }), o)).toMatchObject({ userId: 1, role: 'admin' });
    // Now that there is an admin, everyone else can sign in again.
    expect(oidc.resolveOidcUser(identity({ subject: 'sub-bob', username: 'bob', ...group(false) }), o)).toMatchObject({ userId: 2, role: 'user' });
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
    const cookie = `${sessions.SESSION_COOKIE_NAME}=${encodeURIComponent(sessions.createSession(2))}`;
    const res = await auth.request('/logout', { method: 'POST', headers: { Cookie: cookie } });
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('Admin → Users', () => {
  it('tells password accounts, linked accounts and SSO-created accounts apart', async () => {
    oidc.resolveOidcUser(identity({ subject: 'sub-bob', username: 'bob' }), opts({ matchBy: 'username' }));
    const created = idOf(oidc.resolveOidcUser(identity({ subject: 'sub-ivy', username: 'ivy' }), opts({ autoProvision: true })));
    const cookie = `${sessions.SESSION_COOKIE_NAME}=${encodeURIComponent(sessions.createSession(1))}`;
    const res = await admin.request('/users', { headers: { Cookie: cookie } });
    const { users } = await res.json() as { users: { id: number; created_via: string; sso_linked: number }[] };
    const byId = Object.fromEntries(users.map((u) => [u.id, { created_via: u.created_via, sso_linked: u.sso_linked }]));
    expect(byId[1]).toEqual({ created_via: 'password', sso_linked: 0 });
    expect(byId[2]).toEqual({ created_via: 'password', sso_linked: 1 });
    expect(byId[created]).toEqual({ created_via: 'sso', sso_linked: 1 });
  });
});
