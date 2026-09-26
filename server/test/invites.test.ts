import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The routes open the real database on import, so point it at a throwaway
// file first.
const dir = mkdtempSync(join(tmpdir(), 'patzer-invites-'));
process.env.DB_PATH = join(dir, 'invites.db');

type InvitesModule = typeof import('../src/auth/invites.js');
type DbModule = typeof import('../src/db.js');
type Router = { request: (path: string, init?: RequestInit) => Response | Promise<Response> };

let inv: InvitesModule;
let db: DbModule['db'];
let auth: Router;
let admin: Router;
let adminCookie: string;
let userCookie: string;

// Every signup runs a real bcrypt hash.
const SLOW = 30_000;

beforeAll(async () => {
  ({ db } = await import('../src/db.js'));
  inv = await import('../src/auth/invites.js');
  auth = (await import('../src/routes/auth.js')).default;
  admin = (await import('../src/routes/admin.js')).default;
  const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');
  db.prepare(`INSERT INTO users (id, username, password_hash, role) VALUES (1, 'boss', 'x', 'admin'), (2, 'pleb', 'x', 'user')`).run();
  db.prepare(`INSERT INTO profiles (user_id, display_name) VALUES (1, 'Boss'), (2, 'Pleb')`).run();
  adminCookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(1))}`;
  userCookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(2))}`;
});

afterAll(() => {
  try { db.close(); } catch { /* ignore */ }
  rmSync(dir, { recursive: true, force: true });
});

// The signup limiter allows 10 attempts per IP, so each call gets its own.
let ipCounter = 0;
async function register(body: Record<string, unknown>) {
  const res = await auth.request('/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.0.0.${++ipCounter}` },
    body: JSON.stringify({ password: 'long-enough-pw', display_name: 'New Player', ...body }),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function adminCall(method: string, path: string, body?: unknown, cookie = adminCookie) {
  const res = await admin.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

function usesOf(id: number): number {
  return (db.prepare('SELECT uses FROM invites WHERE id = ?').get(id) as { uses: number }).uses;
}

function profileOf(username: string) {
  return db.prepare(
    `SELECT u.invite_id, p.language, p.audience FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.username = ?`,
  ).get(username) as { invite_id: number | null; language: string; audience: string } | undefined;
}

describe('invite codes', () => {
  it('are 12 characters without look-alikes, and differ every time', () => {
    const codes = new Set(Array.from({ length: 200 }, () => inv.generateInviteCode()));
    expect(codes.size).toBe(200);
    for (const code of codes) expect(code).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);
  });

  it('survive dashes, spaces and lower case when typed back in', () => {
    expect(inv.formatInviteCode('ABCDEFGHJKLM')).toBe('ABCD-EFGH-JKLM');
    expect(inv.normalizeInviteCode(' abcd-efgh jklm ')).toBe('ABCDEFGHJKLM');
    const code = inv.generateInviteCode();
    expect(inv.normalizeInviteCode(inv.formatInviteCode(code).toLowerCase())).toBe(code);
  });
});

describe('inviteStatus', () => {
  const now = new Date('2026-09-25T12:00:00.000Z');
  const base = { revoked_at: null, expires_at: null, max_uses: null, uses: 0 };

  it('is active with no limits at all, however often it was used', () => {
    expect(inv.inviteStatus({ ...base, uses: 500 }, now)).toBe('active');
  });

  it('expires at the stated moment, not a day later', () => {
    expect(inv.inviteStatus({ ...base, expires_at: '2026-09-25T12:00:01.000Z' }, now)).toBe('active');
    expect(inv.inviteStatus({ ...base, expires_at: '2026-09-25T12:00:00.000Z' }, now)).toBe('expired');
  });

  it('is used up once uses reach the limit', () => {
    expect(inv.inviteStatus({ ...base, max_uses: 2, uses: 1 }, now)).toBe('active');
    expect(inv.inviteStatus({ ...base, max_uses: 2, uses: 2 }, now)).toBe('used_up');
  });

  it('reports a revoke before anything else', () => {
    const everything = { revoked_at: '2026-09-20T00:00:00.000Z', expires_at: '2026-09-21T00:00:00.000Z', max_uses: 1, uses: 1 };
    expect(inv.inviteStatus(everything, now)).toBe('revoked');
  });
});

describe('signup mode', () => {
  it('falls back to the old on/off switch on installs from before invites', () => {
    db.prepare(`DELETE FROM settings WHERE key = 'signup_mode'`).run();
    db.prepare(`UPDATE settings SET value = '0' WHERE key = 'allow_signup'`).run();
    expect(inv.signupMode()).toBe('closed');
    db.prepare(`UPDATE settings SET value = '1' WHERE key = 'allow_signup'`).run();
    expect(inv.signupMode()).toBe('open');
  });

  it('turns the old switch off for invite-only, so a downgrade fails closed', () => {
    inv.setSignupMode('invite');
    expect(inv.signupMode()).toBe('invite');
    expect(db.prepare(`SELECT value FROM settings WHERE key = 'allow_signup'`).get()).toEqual({ value: '0' });
    inv.setSignupMode('open');
    expect(db.prepare(`SELECT value FROM settings WHERE key = 'allow_signup'`).get()).toEqual({ value: '1' });
  });
});

describe('registration when invite-only', () => {
  beforeEach(() => inv.setSignupMode('invite'));

  it('refuses a signup without a code', async () => {
    expect(await register({ username: 'nocode' })).toMatchObject({ status: 403, json: { error: 'invite_required' } });
    expect(profileOf('nocode')).toBeUndefined();
  });

  it('refuses a code that does not exist', async () => {
    expect(await register({ username: 'badcode', invite: 'AAAA-BBBB-CCCC' }))
      .toMatchObject({ status: 403, json: { error: 'invite_invalid' } });
  });

  it('accepts a good code, counts the use, applies its presets and records it', async () => {
    const invite = inv.createInvite({ max_uses: 1, language: 'es', audience: 'kid' }, 1);
    const res = await register({ username: 'guest1', invite: inv.formatInviteCode(invite.code).toLowerCase(), language: 'en' });
    expect(res.status).toBe(200);
    expect(usesOf(invite.id)).toBe(1);
    expect(profileOf('guest1')).toEqual({ invite_id: invite.id, language: 'es', audience: 'kid' });
  }, SLOW);

  it('refuses a used-up, an expired and a revoked code', async () => {
    const usedUp = inv.createInvite({ max_uses: 1 }, 1);
    db.prepare('UPDATE invites SET uses = 1 WHERE id = ?').run(usedUp.id);
    const expired = inv.createInvite({ expires_in_days: 1 }, 1, new Date(Date.now() - 2 * 86_400_000));
    const revoked = inv.createInvite({}, 1);
    inv.revokeInvite(revoked.id);

    expect(await register({ username: 'late1', invite: usedUp.code })).toMatchObject({ status: 403, json: { error: 'invite_used_up' } });
    expect(await register({ username: 'late2', invite: expired.code })).toMatchObject({ status: 403, json: { error: 'invite_expired' } });
    expect(await register({ username: 'late3', invite: revoked.code })).toMatchObject({ status: 403, json: { error: 'invite_revoked' } });
    expect(usesOf(usedUp.id)).toBe(1);
  });

  it('gives the last use to exactly one of two simultaneous signups', async () => {
    const invite = inv.createInvite({ max_uses: 1 }, 1);
    const results = await Promise.all([
      register({ username: 'racer1', invite: invite.code }),
      register({ username: 'racer2', invite: invite.code }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 403]);
    expect(results.find((r) => r.status === 403)!.json.error).toBe('invite_used_up');
    expect(usesOf(invite.id)).toBe(1);
  }, SLOW);

  it('gives the use back when the account cannot be created after all', async () => {
    // Both pass the username pre-check; the second one only fails on INSERT,
    // after it has already spent a use of its own invite.
    const a = inv.createInvite({}, 1);
    const b = inv.createInvite({}, 1);
    const results = await Promise.all([
      register({ username: 'twin', invite: a.code }),
      register({ username: 'twin', invite: b.code }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(usesOf(a.id) + usesOf(b.id)).toBe(1);
  }, SLOW);
});

describe('registration in the other modes', () => {
  it('open: works without a code, as before', async () => {
    inv.setSignupMode('open');
    expect((await register({ username: 'walkin', language: 'de' })).status).toBe(200);
    expect(profileOf('walkin')).toEqual({ invite_id: null, language: 'de', audience: 'beginner' });
  }, SLOW);

  it('open: a code is optional but still checked', async () => {
    inv.setSignupMode('open');
    expect(await register({ username: 'typo', invite: 'ZZZZ-ZZZZ-ZZZZ' })).toMatchObject({ status: 403, json: { error: 'invite_invalid' } });
  });

  it('closed: even a good code does not open the door', async () => {
    inv.setSignupMode('closed');
    const invite = inv.createInvite({}, 1);
    expect(await register({ username: 'shut', invite: invite.code })).toMatchObject({ status: 403, json: { error: 'signup_disabled' } });
    expect(usesOf(invite.id)).toBe(0);
  });
});

describe('public invite check', () => {
  it('reports validity and the preset language, never the admin note', async () => {
    const invite = inv.createInvite({ note: 'for aunt Erna', language: 'bg' }, 1);
    const ok = await (await auth.request(`/invite?code=${inv.formatInviteCode(invite.code)}`)).json();
    expect(ok).toEqual({ valid: true, language: 'bg' });

    inv.revokeInvite(invite.id);
    expect(await (await auth.request(`/invite?code=${invite.code}`)).json()).toEqual({ valid: false, reason: 'revoked' });
    expect(await (await auth.request('/invite?code=nope')).json()).toEqual({ valid: false, reason: 'invalid' });
    expect(await (await auth.request('/invite')).json()).toEqual({ valid: false, reason: 'invalid' });
  });

  it('tells the login page which mode is on', async () => {
    inv.setSignupMode('invite');
    expect(await (await auth.request('/config')).json()).toMatchObject({ signup_enabled: true, signup_mode: 'invite' });
    inv.setSignupMode('closed');
    expect(await (await auth.request('/config')).json()).toMatchObject({ signup_enabled: false, signup_mode: 'closed' });
  });
});

describe('admin invite endpoints', () => {
  it('are admin-only', async () => {
    expect((await adminCall('GET', '/invites', undefined, userCookie)).status).toBe(403);
    expect((await adminCall('POST', '/invites', {}, userCookie)).status).toBe(403);
  });

  it('create with cautious defaults: one account, one week', async () => {
    const { status, json } = await adminCall('POST', '/invites', {});
    expect(status).toBe(200);
    expect(json.invite).toMatchObject({ max_uses: 1, uses: 0, status: 'active', language: null, audience: null, used_by: [] });
    expect(json.invite.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(json.invite.link).toMatch(new RegExp(`/signup\\?invite=${json.invite.code}$`));
    const days = (Date.parse(json.invite.expires_at) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);
  });

  it('build links from the public URL setting when there is one', async () => {
    db.prepare(`INSERT INTO settings (key, value) VALUES ('public_base_url', 'https://chess.example.org/') ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run();
    const { json } = await adminCall('POST', '/invites', {});
    expect(json.invite.link).toBe(`https://chess.example.org/signup?invite=${json.invite.code}`);
    db.prepare(`DELETE FROM settings WHERE key = 'public_base_url'`).run();
  });

  it('accept unlimited uses and no expiry, and reject nonsense', async () => {
    const { json } = await adminCall('POST', '/invites', { max_uses: null, expires_in_days: null, note: '  Club  ', language: 'de', audience: 'advanced' });
    expect(json.invite).toMatchObject({ max_uses: null, expires_at: null, note: 'Club', language: 'de', audience: 'advanced' });
    expect((await adminCall('POST', '/invites', { max_uses: 0 })).status).toBe(400);
    expect((await adminCall('POST', '/invites', { language: 'xx' })).status).toBe(400);
  });

  it('list who signed up with which invite, and revoke and delete', async () => {
    inv.setSignupMode('invite');
    const { json: created } = await adminCall('POST', '/invites', { max_uses: 5 });
    expect((await register({ username: 'clubber', invite: created.invite.code })).status).toBe(200);

    const listed = (await adminCall('GET', '/invites')).json;
    expect(listed.signup_mode).toBe('invite');
    expect(listed.invites.find((i: { id: number }) => i.id === created.invite.id)).toMatchObject({ uses: 1, used_by: ['clubber'] });
    const users = (await adminCall('GET', '/users')).json.users;
    expect(users.find((u: { username: string }) => u.username === 'clubber')).toMatchObject({ invite_code: created.invite.code });

    expect((await adminCall('POST', `/invites/${created.invite.id}/revoke`)).status).toBe(200);
    expect(await register({ username: 'toolate', invite: created.invite.code })).toMatchObject({ json: { error: 'invite_revoked' } });

    expect((await adminCall('DELETE', `/invites/${created.invite.id}`)).status).toBe(200);
    expect((await adminCall('DELETE', `/invites/${created.invite.id}`)).status).toBe(404);
    expect(profileOf('clubber')).toMatchObject({ invite_id: null });
  }, SLOW);

  it('switch the signup mode from Admin → System', async () => {
    expect((await adminCall('PATCH', '/system', { signup_mode: 'invite' })).status).toBe(200);
    expect((await adminCall('GET', '/system')).json.signup_mode).toBe('invite');
    // The pre-invite switch still works for anything that sends it.
    await adminCall('PATCH', '/system', { allow_signup: false });
    expect(inv.signupMode()).toBe('closed');
  });
});
