import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A fresh install started with OIDC_ONLY=true: no setup wizard, sign-up
// closed, and the first SSO login creates the admin.
const dir = mkdtempSync(join(tmpdir(), 'patzer-oidc-first-'));
process.env.DB_PATH = join(dir, 'first.db');
process.env.OIDC_ISSUER = 'http://127.0.0.1:1/application/o/patzer/';
process.env.OIDC_CLIENT_ID = 'patzer';
process.env.OIDC_ONLY = 'true';

type Router = { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
let db: typeof import('../src/db.js')['db'];
let oidc: typeof import('../src/auth/oidc.js');
let invites: typeof import('../src/auth/invites.js');
let setup: Router;

const identity = (subject: string, username: string, groups: string[] | null = null) => ({
  issuer: 'https://auth.example.com/', subject, username, email: `${username}@example.com`,
  emailVerified: true, displayName: username, groups, language: 'en' as const,
});
const post = (path: string, body: unknown) => setup.request(path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

beforeAll(async () => {
  ({ db } = await import('../src/db.js'));
  oidc = await import('../src/auth/oidc.js');
  invites = await import('../src/auth/invites.js');
  setup = (await import('../src/routes/setup.js')).default;
});

afterAll(() => {
  try { db.close(); } catch { /* ignore */ }
  rmSync(dir, { recursive: true, force: true });
});

describe('fresh install with OIDC_ONLY', () => {
  it('skips the setup wizard: the web app goes straight to the login page', async () => {
    expect(await (await setup.request('/status')).json()).toEqual({ setup_required: false });
  });

  it('refuses the wizard endpoints, including the unauthenticated Ollama probe', async () => {
    const init = await post('/init', { username: 'local', password: 'long-enough-pw', display_name: 'Local' });
    expect(init.status).toBe(403);
    expect(await init.json()).toEqual({ error: 'password_login_disabled' });
    expect((await post('/test-ollama', { url: 'http://127.0.0.1:11434' })).status).toBe(403);
  });

  it('closes sign-up and leaves the coach unconfigured at startup', () => {
    expect(oidc.prepareSsoOnlyFirstRun()).toBe(true);
    expect(invites.signupMode()).toBe('closed');
    expect(db.prepare(`SELECT value FROM settings WHERE key = 'ollama_url'`).get()).toBeUndefined();
  });

  it('without OIDC_ADMIN_GROUP the first person to sign in is the admin, even with provisioning off', () => {
    const o = { matchBy: 'none' as const, autoProvision: false, adminGroup: null, ssoOnly: true };
    expect(oidc.resolveOidcUser(identity('s1', 'first'), o)).toMatchObject({ outcome: 'created', role: 'admin' });
    // Only the very first: provisioning off applies again from now on.
    expect(oidc.resolveOidcUser(identity('s2', 'second'), o)).toEqual({ error: 'not_provisioned' });
    // And the startup step is a no-op once someone exists.
    expect(oidc.prepareSsoOnlyFirstRun()).toBe(false);
  });

  it('with OIDC_ADMIN_GROUP, nobody but a group member gets in until the first admin exists', () => {
    db.exec('DELETE FROM users');
    const o = { matchBy: 'none' as const, autoProvision: false, adminGroup: 'patzer-admins', ssoOnly: true };
    expect(oidc.resolveOidcUser(identity('s3', 'kid', ['family']), o)).toEqual({ error: 'admin_first' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 0 });
    expect(oidc.resolveOidcUser(identity('s4', 'parent', ['family', 'patzer-admins']), o)).toMatchObject({ outcome: 'created', role: 'admin' });
    expect(oidc.resolveOidcUser(identity('s3', 'kid', ['family']), { ...o, autoProvision: true })).toMatchObject({ outcome: 'created', role: 'user' });
  });
});
