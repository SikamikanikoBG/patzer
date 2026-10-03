// End-to-end proof that single sign-on works against a real OpenID Connect
// provider (panva/oidc-provider, an OpenID Certified implementation). It
// simulates a browser: per-host cookie jars, manual redirects, the provider's
// login form. Covers login, account linking, provisioning, the IdP logout
// round trip and a cancelled login.
//
// Not part of `npm test` (it binds two ports and starts the whole server).
// Run it with `npm run test:oidc`.

import Provider from 'oidc-provider';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

// Different hostnames for the two sides, so their cookies stay apart like
// they would in a browser.
const IDP_PORT = Number(process.env.IDP_PORT ?? 8894);
const PORT = Number(process.env.PORT ?? 8893);
const IDP = `http://localhost:${IDP_PORT}`;
const BASE = `http://127.0.0.1:${PORT}`;

process.env.PORT = String(PORT);
process.env.HOST = '127.0.0.1';
process.env.PUBLIC_BASE_URL = BASE;
process.env.OIDC_ISSUER = IDP;
process.env.OIDC_CLIENT_ID = 'patzer';
process.env.OIDC_CLIENT_SECRET = 'patzer-secret';
process.env.OIDC_ONLY = 'true';
process.env.OIDC_AUTO_PROVISION = 'true';
process.env.OIDC_MATCH_BY = 'username';
process.env.OIDC_BUTTON_TEXT = 'Sign in with the test IdP';
const dbPath = process.env.DB_PATH ?? join(tmpdir(), `patzer-oidc-${process.pid}.db`);
process.env.DB_PATH = dbPath;
for (const suffix of ['', '-wal', '-shm']) { try { rmSync(dbPath + suffix, { force: true }); } catch { /* ignore */ } }

let failures = 0;
function check(cond: unknown, label: string) {
  if (cond) console.log(`  ok   ${label}`);
  else { failures++; console.log(`  FAIL ${label}`); }
}

// ---- The identity provider ---------------------------------------------------

const ACCOUNTS: Record<string, Record<string, unknown>> = {
  alice: { preferred_username: 'alice', name: 'Alice Admin', email: 'alice@example.com', email_verified: true },
  bob: { preferred_username: 'bob', name: 'Bob Builder', email: 'bob@example.com', email_verified: true },
};

function startProvider() {
  const provider = new Provider(IDP, {
    clients: [{
      client_id: 'patzer',
      client_secret: 'patzer-secret',
      redirect_uris: [`${BASE}/api/auth/oidc/callback`],
      post_logout_redirect_uris: [`${BASE}/login`],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
    }],
    claims: { openid: ['sub'], profile: ['preferred_username', 'name'], email: ['email', 'email_verified'] },
    async findAccount(_ctx, id) {
      const claims = ACCOUNTS[id] ?? { preferred_username: id, name: id };
      return { accountId: id, claims: () => ({ sub: `idp-${id}`, ...claims }) };
    },
    cookies: { keys: ['e2e-only-key'] },
  });
  return new Promise<void>((resolve) => provider.listen(IDP_PORT, () => resolve()));
}

// ---- A tiny browser ----------------------------------------------------------

const jars = new Map<string, Map<string, string>>();
function jar(url: string) {
  const host = new URL(url).host;
  if (!jars.has(host)) jars.set(host, new Map());
  return jars.get(host)!;
}

async function request(url: string, init: RequestInit = {}) {
  const cookie = [...jar(url)].map(([k, v]) => `${k}=${v}`).join('; ');
  const res = await fetch(url, {
    ...init,
    redirect: 'manual',
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      ...(cookie ? { Cookie: cookie } : {}),
      'Accept-Language': 'de-DE,de;q=0.9,en;q=0.5',
    },
  });
  for (const sc of res.headers.getSetCookie()) {
    const [pair, ...attrs] = sc.split(';');
    const eq = pair!.indexOf('=');
    const name = pair!.slice(0, eq).trim();
    const value = pair!.slice(eq + 1).trim();
    const gone = value === '' || attrs.some((a) => /max-age=0/i.test(a) || /expires=thu, 01 jan 1970/i.test(a));
    if (gone) jar(url).delete(name); else jar(url).set(name, value);
  }
  return res;
}

// Follows redirects; returns the final response and every URL visited.
async function browse(url: string, init?: RequestInit) {
  const visited = [url];
  let res = await request(url, init);
  while ([301, 302, 303, 307, 308].includes(res.status)) {
    url = new URL(res.headers.get('location')!, url).href;
    visited.push(url);
    res = await request(url);
  }
  return { res, url, visited };
}

function parseForm(html: string, base: string) {
  const form = html.match(/<form[^>]*action="([^"]+)"[^>]*>([\s\S]*?)<\/form>/i);
  if (!form) throw new Error(`no form on ${base}:\n${html.slice(0, 300)}`);
  const fields: Record<string, string> = {};
  for (const input of form[2]!.matchAll(/<input[^>]*>/gi)) {
    const name = input[0].match(/name="([^"]+)"/)?.[1];
    if (name) fields[name] = input[0].match(/value="([^"]*)"/)?.[1] ?? '';
  }
  return { action: new URL(form[1]!.replace(/&amp;/g, '&'), base).href, fields };
}

function post(form: { action: string; fields: Record<string, string> }, extra: Record<string, string> = {}) {
  return browse(form.action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...form.fields, ...extra }).toString(),
  });
}

// Clicks the SSO button and gets through the provider. `sawLoginForm` tells
// whether the provider had to ask for credentials (no session there yet).
async function ssoLogin(account: string, { cancel = false } = {}) {
  let { res, url } = await browse(`${BASE}/api/auth/oidc/start`);
  let sawLoginForm = false;
  while (url.startsWith(IDP)) {
    if (cancel && url.includes('/interaction/')) {
      ({ res, url } = await browse(`${url.split('?')[0]}/abort`));
      continue;
    }
    const form = parseForm(await res.text(), url);
    const isLogin = 'login' in form.fields;
    sawLoginForm ||= isLogin;
    ({ res, url } = await post(form, isLogin ? { login: account, password: 'any' } : {}));
  }
  return { landed: url, sawLoginForm };
}

async function api(path: string, method = 'GET', body?: unknown) {
  const res = await request(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'patzer' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

// Logs out of Patzer and follows the provider's logout page back home.
async function logout() {
  const out = await api('/api/auth/logout', 'POST');
  const logoutUrl: string | undefined = out.json?.logout_url;
  if (!logoutUrl) return { out, landed: null };
  let { res, url } = await browse(logoutUrl);
  if (url.startsWith(IDP)) ({ url } = await post(parseForm(await res.text(), url), { logout: 'yes' }));
  return { out, landed: url };
}

// ---- The checks ----------------------------------------------------------------

async function main() {
  await startProvider();
  await import('../../src/index.js');
  await sleep(800);

  console.log('config');
  const cfg = await api('/api/auth/config');
  check(cfg.json.oidc_enabled && cfg.json.oidc_only && cfg.json.oidc_button_text === 'Sign in with the test IdP', 'login page is told: SSO only, custom button text');
  check(cfg.json.signup_enabled === false && cfg.json.email_enabled === false, 'signup and password reset are hidden');

  console.log('fresh install');
  let r = await ssoLogin('alice');
  check(r.landed === `${BASE}/`, 'SSO before setup goes back to the wizard');
  check((await api('/api/setup/status')).json.setup_required === true, 'and creates no account');
  await logout();
  jar(IDP).clear();

  const setup = await api('/api/setup/init', 'POST', { username: 'Alice', password: 'alicepassword1', display_name: 'Alice' });
  check(setup.status === 200, 'setup wizard creates the admin');
  jar(BASE).clear();
  const pw = await api('/api/auth/login', 'POST', { username: 'Alice', password: 'alicepassword1' });
  check(pw.status === 403 && pw.json.error === 'password_login_disabled', 'OIDC_ONLY refuses password login');

  console.log('linking by username');
  r = await ssoLogin('alice');
  check(r.sawLoginForm && r.landed === `${BASE}/`, 'provider asks for credentials, then back to Patzer');
  let me = (await api('/api/auth/me')).json.user;
  check(me?.username === 'Alice' && me.role === 'admin', 'provider user "alice" is linked to the admin "Alice"');

  console.log('logout ends the provider session too');
  const out = await logout();
  const u = new URL(out.out.json.logout_url);
  check(u.searchParams.get('id_token_hint')?.split('.').length === 3, 'logout_url carries the ID token as id_token_hint');
  check(u.searchParams.get('post_logout_redirect_uri') === `${BASE}/login`, 'and asks to come back to /login');
  check(out.landed === `${BASE}/login`, 'the provider sends the browser back to /login');
  check((await api('/api/auth/me')).json.user === null, 'the Patzer session is gone');
  r = await ssoLogin('alice');
  check(r.sawLoginForm, 'the next SSO login has to sign in at the provider again');
  me = (await api('/api/auth/me')).json.user;
  check(me?.username === 'Alice', 'and returns to the same account');
  await logout();

  console.log('provisioning');
  r = await ssoLogin('bob');
  me = (await api('/api/auth/me')).json.user;
  check(me?.username === 'bob' && me.role === 'user', 'unknown "bob" gets a new, ordinary account');
  check(me?.profile.display_name === 'Bob Builder' && me.profile.language === 'de', 'name from the provider, language from the browser');
  await logout();

  console.log('cancelled login');
  r = await ssoLogin('bob', { cancel: true });
  check(r.landed === `${BASE}/login?sso_error=denied`, 'cancelling at the provider lands on /login with an error');
  check((await api('/api/auth/me')).json.user === null, 'and logs nobody in');

  console.log(failures === 0 ? '\nAll SSO checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
