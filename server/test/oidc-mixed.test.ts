import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// SSO next to passwords (OIDC_ONLY off) on a fresh install: the setup wizard
// still creates the admin, and SSO waits for it.
const dir = mkdtempSync(join(tmpdir(), 'patzer-oidc-mixed-'));
process.env.DB_PATH = join(dir, 'mixed.db');
process.env.OIDC_ISSUER = 'http://127.0.0.1:1/application/o/patzer/';
process.env.OIDC_CLIENT_ID = 'patzer';
delete process.env.OIDC_ONLY;

type Router = { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
let db: typeof import('../src/db.js')['db'];
let oidc: typeof import('../src/auth/oidc.js');
let auth: Router;
let setup: Router;

beforeAll(async () => {
  ({ db } = await import('../src/db.js'));
  oidc = await import('../src/auth/oidc.js');
  auth = (await import('../src/routes/auth.js')).default;
  setup = (await import('../src/routes/setup.js')).default;
});

afterAll(() => {
  try { db.close(); } catch { /* ignore */ }
  rmSync(dir, { recursive: true, force: true });
});

describe('fresh install with SSO next to passwords', () => {
  it('runs the setup wizard as usual', async () => {
    expect(await (await setup.request('/status')).json()).toEqual({ setup_required: true });
    expect(oidc.prepareSsoOnlyFirstRun()).toBe(false);
  });

  it('shows both ways in on the login page', async () => {
    expect(await (await auth.request('/config')).json()).toMatchObject({ oidc_enabled: true, oidc_only: false });
  });

  it('an SSO callback before the wizard goes back to it instead of creating an account', async () => {
    const res = await auth.request('/oidc/callback?code=abc&state=def');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 0 });
  });

  it('the first SSO account is not an admin when the wizard is in charge', () => {
    db.prepare(`INSERT INTO users (id, username, password_hash, role) VALUES (1, 'wizard', 'x', 'admin')`).run();
    db.prepare(`INSERT INTO profiles (user_id, display_name) VALUES (1, 'Wizard')`).run();
    const r = oidc.resolveOidcUser(
      { issuer: 'https://auth.example.com/', subject: 's1', username: 'kid', email: null, emailVerified: false, displayName: null, groups: null, language: 'en' },
      { matchBy: 'none', autoProvision: true, adminGroup: null, ssoOnly: false },
    );
    expect(r).toMatchObject({ outcome: 'created', role: 'user' });
  });
});
