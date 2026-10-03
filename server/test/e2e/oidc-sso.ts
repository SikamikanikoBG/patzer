// End-to-end proof that single sign-on works against a real OpenID Connect
// provider (panva/oidc-provider, an OpenID Certified implementation). It
// simulates a browser: per-host cookie jars, manual redirects, the provider's
// login form. Covers a fresh SSO-only install (no wizard, the admin group
// decides who goes first), provisioning, linking an account the admin made,
// roles following the provider group, the admin's user list, the IdP logout
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
process.env.OIDC_ADMIN_GROUP = 'patzer-admins';
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

// Mutable: the test moves people in and out of the admin group.
const ACCOUNTS: Record<string, Record<string, unknown>> = {
  alice: { preferred_username: 'alice', name: 'Alice Admin', email: 'alice@example.com', email_verified: true, groups: ['family', 'patzer-admins'] },
  bob: { preferred_username: 'bob', name: 'Bob Builder', email: 'bob@example.com', email_verified: true, groups: ['family'] },
  carol: { preferred_username: 'carol', name: 'Carol', email: 'carol@example.com', email_verified: true, groups: ['family'] },
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
    // Like Authentik: the groups come with the profile scope.
    claims: { openid: ['sub'], profile: ['preferred_username', 'name', 'groups'], email: ['email', 'email_verified'] },
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

// Ends the provider session without a Patzer session (after a refused login).
async function logoutAtProvider() {
  jar(IDP).clear();
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

  console.log('fresh install in SSO-only mode');
  check((await api('/api/setup/status')).json.setup_required === false, 'no setup wizard: the app goes straight to the login page');
  const init = await api('/api/setup/init', 'POST', { username: 'local', password: 'localpassword1', display_name: 'Local' });
  check(init.status === 403, 'the wizard endpoint refuses to create a password admin');
  let r = await ssoLogin('bob');
  check(r.landed === `${BASE}/login?sso_error=admin_first`, 'bob (not in the admin group) can\'t be first in');
  await logoutAtProvider();
  r = await ssoLogin('alice');
  let me = (await api('/api/auth/me')).json.user;
  check(me?.username === 'alice' && me.role === 'admin', 'alice (admin group) signs in first and is the admin');
  const pw = await api('/api/auth/login', 'POST', { username: 'alice', password: 'anything' });
  check(pw.status === 403 && pw.json.error === 'password_login_disabled', 'password login is refused');

  console.log('an account the admin created, then signed into with SSO');
  const made = await api('/api/admin/users', 'POST', { username: 'Carol', password: 'carolpassword1', display_name: 'Carol' });
  check(made.status === 200, 'admin creates "Carol" with a password and no email');

  console.log('logout ends the provider session too');
  const out = await logout();
  const u = new URL(out.out.json.logout_url);
  check(u.searchParams.get('id_token_hint')?.split('.').length === 3, 'logout_url carries the ID token as id_token_hint');
  check(u.searchParams.get('post_logout_redirect_uri') === `${BASE}/login`, 'and asks to come back to /login');
  check(out.landed === `${BASE}/login`, 'the provider sends the browser back to /login');
  check((await api('/api/auth/me')).json.user === null, 'the Patzer session is gone');

  r = await ssoLogin('carol');
  check(r.sawLoginForm, 'the next SSO login has to sign in at the provider again');
  me = (await api('/api/auth/me')).json.user;
  check(me?.username === 'Carol' && me.role === 'user', 'provider user "carol" is linked to the account "Carol"');
  await logout();

  console.log('provisioning and roles from the provider group');
  r = await ssoLogin('bob');
  me = (await api('/api/auth/me')).json.user;
  check(me?.username === 'bob' && me.role === 'user', 'unknown bob gets a new, ordinary account now that an admin exists');
  check(me?.profile.display_name === 'Bob Builder' && me.profile.language === 'de', 'name from the provider, language from the browser');
  await logout();
  ACCOUNTS.bob!.groups = ['family', 'patzer-admins'];
  await ssoLogin('bob');
  check((await api('/api/auth/me')).json.user?.role === 'admin', 'added to the admin group: bob is an admin at his next login');
  await logout();
  ACCOUNTS.bob!.groups = ['family'];
  await ssoLogin('bob');
  check((await api('/api/auth/me')).json.user?.role === 'user', 'removed from it: back to a normal user');
  await logout();

  console.log('the admin\'s user list');
  await ssoLogin('alice');
  const list = (await api('/api/admin/users')).json.users as { username: string; created_via: string; sso_linked: number; email: string | null }[];
  const row = (name: string) => list.find((x) => x.username === name);
  check(row('alice')?.created_via === 'sso' && row('bob')?.created_via === 'sso', 'alice and bob are marked as created by SSO');
  check(row('Carol')?.created_via === 'password' && row('Carol')?.sso_linked === 1, 'Carol is a password account linked to SSO');
  check(row('Carol')?.email === 'carol@example.com', 'and now has the email from the provider');
  await logout();

  console.log('cancelled login');
  r = await ssoLogin('bob', { cancel: true });
  check(r.landed === `${BASE}/login?sso_error=denied`, 'cancelling at the provider lands on /login with an error');
  check((await api('/api/auth/me')).json.user === null, 'and logs nobody in');

  console.log(failures === 0 ? '\nAll SSO checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
