import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { z } from 'zod';
import { db, userCount, setSetting } from '../db.js';
import { config } from '../config.js';
import { hashPassword } from '../auth/passwords.js';
import { createSession, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from '../auth/sessions.js';
import { testConnection } from '../coach/llm.js';

const router = new Hono();

router.get('/status', (c) => {
  return c.json({ setup_required: userCount() === 0 });
});

// Restrict the unauthenticated SSRF surface to hosts a sane Ollama deploy
// would actually live on: loopback, RFC1918, link-local, and `*.local` mDNS
// names. Without this, a freshly-deployed instance lets an attacker probe
// http://169.254.169.254/ (cloud metadata), http://10.0.0.5:8080/, etc.
// Public-Internet Ollama hosting is not a thing we want to enable here.
function isPrivateOllamaUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.local')) return true;
  // IPv4 ranges: 10/8, 172.16/12, 192.168/16, 127/8.  Reject 169.254/16 (link-local
  // metadata services) and 0.0.0.0.
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 169 && b === 254) return false; // link-local — denylist explicitly
    if (a === 127) return true;
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  }
  // IPv6 loopback / link-local / unique-local
  if (host === '::1' || host === '[::1]') return true;
  const stripped = host.replace(/^\[|\]$/g, '');
  if (stripped.startsWith('fe80:') || stripped.startsWith('fc') || stripped.startsWith('fd')) return true;
  return false;
}

// Public test endpoint, available only during setup. Returns whether Ollama
// answered, but never echoes its response body — the SSRF probe value of
// "what HTTP body did this internal host return" is exactly what we don't
// want to leak before any user has been created.
router.post('/test-ollama', async (c) => {
  if (userCount() > 0) return c.json({ error: 'already_initialized' }, 409);
  const body = await c.req.json().catch(() => null) as { url?: string } | null;
  const url = body?.url;
  if (!url) return c.json({ ok: false, error: 'no_url' });
  if (!isPrivateOllamaUrl(url)) return c.json({ ok: false, error: 'invalid_url' });
  const result = await testConnection(url, 'ollama');
  if (result.ok) return c.json({ ok: true, models: result.models });
  return c.json({ ok: false, error: 'unreachable' });
});

const setupSchema = z.object({
  username: z.string().trim().min(2).max(40),
  // 10-char minimum is reachable for non-technical family members but cuts off
  // the worst dictionary attacks. Pair with bcrypt cost 12 (passwords.ts).
  password: z.string().min(10).max(200),
  display_name: z.string().trim().min(1).max(60),
  language: z.enum(['en', 'bg']).default('en'),
  ollama_url: z.string().url().or(z.literal('')).optional(),
  ollama_model: z.string().optional(),
});

router.post('/init', async (c) => {
  if (userCount() > 0) return c.json({ error: 'already_initialized' }, 409);

  const body = await c.req.json().catch(() => null);
  const parsed = setupSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input', details: parsed.error.flatten() }, 400);

  const { username, password, display_name, language, ollama_url, ollama_model } = parsed.data;

  const passwordHash = await hashPassword(password);
  const insertUser = db.prepare(`INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')`);
  const insertProfile = db.prepare(
    `INSERT INTO profiles (user_id, display_name, language, audience, coach_behavior) VALUES (?, ?, ?, 'intermediate', 'on_demand')`
  );

  // The naive `userCount() > 0` check above races with concurrent /init calls:
  // two attackers reaching the freshly-deployed instance can both pass the
  // check before either commits. better-sqlite3's transaction() acquires an
  // immediate lock, so re-checking userCount() inside the tx is atomic.
  let userId: number | null = null;
  try {
    userId = db.transaction(() => {
      if (userCount() > 0) throw new Error('already_initialized');
      const result = insertUser.run(username, passwordHash);
      const id = Number(result.lastInsertRowid);
      insertProfile.run(id, display_name, language);
      return id;
    })();
  } catch (err) {
    if ((err as Error).message === 'already_initialized') return c.json({ error: 'already_initialized' }, 409);
    throw err;
  }

  if (ollama_url) setSetting('ollama_url', ollama_url);
  if (ollama_model) setSetting('ollama_model', ollama_model);
  setSetting('default_language', language);

  if (userId === null) return c.json({ error: 'init_failed' }, 500);
  const cookie = createSession(userId);
  setCookie(c, SESSION_COOKIE_NAME, cookie, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
    secure: config.cookieSecure,
  });

  return c.json({ ok: true });
});

export default router;
