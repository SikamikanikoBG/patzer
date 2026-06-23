import { Hono } from 'hono';
import { z } from 'zod';
import { db, getSetting, setSetting } from '../db.js';
import { requireAdmin } from '../auth/middleware.js';
import { hashPassword } from '../auth/passwords.js';
import { testOllama, testModel, ollamaUrl, ollamaModel, ollamaStats } from '../coach/ollama.js';
import { StockfishEngine } from '../chess/stockfish.js';
import { isMailerConfigured, sendMail, verifyConnection, welcomeTemplate } from '../email/mailer.js';
import type { Profile, Role } from '../types.js';

const router = new Hono();
router.use('*', requireAdmin);

// ---- Users ----

router.get('/users', (c) => {
  const rows = db.prepare(`
    SELECT u.id, u.username, u.role, u.created_at, u.email, u.email_verified,
           p.display_name, p.avatar_emoji, p.language, p.audience
    FROM users u JOIN profiles p ON p.user_id = u.id
    ORDER BY u.id
  `).all();
  return c.json({ users: rows });
});

const createUserSchema = z.object({
  username: z.string().trim().min(2).max(40),
  password: z.string().min(10).max(200),
  display_name: z.string().trim().min(1).max(60),
  // Optional email so admins can pre-seed an address (enables that user's own
  // password resets later). Empty string is treated as "no email".
  email: z.union([z.string().trim().email().max(200), z.literal('')]).optional(),
  role: z.enum(['admin', 'user']).default('user'),
  language: z.enum(['en', 'bg']).default('en'),
  audience: z.enum(['kid', 'beginner', 'intermediate', 'advanced']).default('intermediate'),
  coach_behavior: z.enum(['silent', 'on_demand', 'always_on_pedagogical']).default('on_demand'),
  avatar_emoji: z.string().min(1).max(8).default('♟'),
  tts_enabled: z.boolean().default(false),
});

router.post('/users', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input', details: parsed.error.flatten() }, 400);
  const d = parsed.data;
  const email = d.email ? d.email : null;
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(d.username);
  if (existing) return c.json({ error: 'username_taken' }, 409);
  if (email && db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(email)) {
    return c.json({ error: 'email_taken' }, 409);
  }
  const passwordHash = await hashPassword(d.password);
  // Admin-created accounts are trusted as verified — the admin set the email,
  // not the end user, so there's no inbox to confirm before first login.
  const tx = db.transaction(() => {
    const r = db.prepare(`INSERT INTO users (username, password_hash, role, email, email_verified) VALUES (?, ?, ?, ?, 1)`)
      .run(d.username, passwordHash, d.role, email);
    const id = Number(r.lastInsertRowid);
    db.prepare(`INSERT INTO profiles (user_id, display_name, language, audience, coach_behavior, avatar_emoji, tts_enabled)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, d.display_name, d.language, d.audience, d.coach_behavior, d.avatar_emoji, d.tts_enabled ? 1 : 0);
    return id;
  });
  let id: number;
  try {
    id = tx();
  } catch (err) {
    const msg = (err as Error).message || '';
    if (/users\.email|idx_users_email/i.test(msg)) return c.json({ error: 'email_taken' }, 409);
    throw err;
  }
  // Courtesy welcome email so the new user knows their account exists and where
  // to log in. Best-effort — an admin create never fails on a mail problem.
  if (email && isMailerConfigured()) {
    const origin = new URL(c.req.url).origin;
    const base = getSetting('public_base_url')?.replace(/\/+$/, '') || process.env.PUBLIC_BASE_URL?.replace(/\/+$/, '') || origin;
    const tpl = welcomeTemplate(d.display_name, `${base}/login`);
    void sendMail({ to: email, ...tpl });
  }
  return c.json({ id });
});

const updateUserSchema = z.object({
  role: z.enum(['admin', 'user']).optional(),
  password: z.string().min(10).max(200).optional(),
  display_name: z.string().trim().min(1).max(60).optional(),
  avatar_emoji: z.string().min(1).max(8).optional(),
  language: z.enum(['en', 'bg']).optional(),
  audience: z.enum(['kid', 'beginner', 'intermediate', 'advanced']).optional(),
  coach_behavior: z.enum(['silent', 'on_demand', 'always_on_pedagogical']).optional(),
  tts_enabled: z.boolean().optional(),
});

router.patch('/users/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => null);
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  const d = parsed.data;
  const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id) as { id: number; role: Role } | undefined;
  if (!target) return c.json({ error: 'not_found' }, 404);

  if (d.password) {
    const hash = await hashPassword(d.password);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
  }
  if (d.role) {
    // Block demoting the only admin — the same guard DELETE has — otherwise a
    // single misclick on the last admin permanently locks the console.
    if (d.role === 'user' && target.role === 'admin') {
      const adminCount = (db.prepare(`SELECT COUNT(*) c FROM users WHERE role = 'admin'`).get() as { c: number }).c;
      if (adminCount <= 1) return c.json({ error: 'last_admin' }, 400);
    }
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(d.role, id);
  }

  const profileFields: string[] = [];
  const profileValues: (string | number)[] = [];
  for (const k of ['display_name', 'avatar_emoji', 'language', 'audience', 'coach_behavior'] as const) {
    if (d[k] !== undefined) { profileFields.push(`${k} = ?`); profileValues.push(d[k] as string); }
  }
  if (d.tts_enabled !== undefined) { profileFields.push('tts_enabled = ?'); profileValues.push(d.tts_enabled ? 1 : 0); }
  if (profileFields.length) {
    profileValues.push(id);
    db.prepare(`UPDATE profiles SET ${profileFields.join(', ')} WHERE user_id = ?`).run(...profileValues);
  }
  return c.json({ ok: true });
});

router.delete('/users/:id', (c) => {
  const id = Number(c.req.param('id'));
  const me = c.get('user');
  if (id === me.id) return c.json({ error: 'cannot_delete_self' }, 400);
  // Prevent deleting last admin
  const adminCount = (db.prepare(`SELECT COUNT(*) c FROM users WHERE role = 'admin'`).get() as { c: number }).c;
  const target = db.prepare('SELECT role FROM users WHERE id = ?').get(id) as { role: Role } | undefined;
  if (!target) return c.json({ error: 'not_found' }, 404);
  if (target.role === 'admin' && adminCount <= 1) return c.json({ error: 'last_admin' }, 400);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return c.json({ ok: true });
});

// ---- System settings ----

router.get('/system', async (c) => {
  const stats = ollamaStats();
  return c.json({
    ollama_url: getSetting('ollama_url'),
    ollama_model: getSetting('ollama_model'),
    stockfish_path: getSetting('stockfish_path'),
    // Live runtime stats so admins can confirm which model the coach is
    // actually calling (the saved setting vs. what runtime resolved to may
    // diverge if the saved model isn't pulled on the Ollama host).
    last_model_used: stats.lastModelUsed,
    last_error: stats.lastError,
    p95_ms: stats.p95Ms,
    call_count: stats.count,

    // ---- Signup + email (v7.7.0) ----
    allow_signup: getSetting('allow_signup') !== '0',
    require_email_verification: getSetting('require_email_verification') === '1',
    notify_admin_on_signup: getSetting('notify_admin_on_signup') !== '0',
    public_base_url: getSetting('public_base_url') ?? '',
    // SMTP — note we never return the stored password, only whether one is set,
    // and whether env vars are overriding the DB (in which case the UI fields
    // are informational and the env wins).
    smtp_host: getSetting('smtp_host') ?? '',
    smtp_port: getSetting('smtp_port') ?? '',
    smtp_secure: getSetting('smtp_secure') === '1',
    smtp_user: getSetting('smtp_user') ?? '',
    smtp_from: getSetting('smtp_from') ?? '',
    smtp_pass_set: !!(getSetting('smtp_pass') || process.env.SMTP_PASS),
    smtp_env_override: !!process.env.SMTP_HOST,
    email_enabled: isMailerConfigured(),
  });
});

const systemSchema = z.object({
  ollama_url: z.string().url().or(z.literal('')).optional(),
  ollama_model: z.string().optional(),
  stockfish_path: z.string().optional(),
  // Signup + email config
  allow_signup: z.boolean().optional(),
  require_email_verification: z.boolean().optional(),
  notify_admin_on_signup: z.boolean().optional(),
  public_base_url: z.string().url().or(z.literal('')).optional(),
  smtp_host: z.string().max(255).optional(),
  smtp_port: z.union([z.number().int().positive().max(65535), z.literal('')]).optional(),
  smtp_secure: z.boolean().optional(),
  smtp_user: z.string().max(255).optional(),
  smtp_from: z.string().max(255).optional(),
  // Only written when a non-empty string is sent; empty/omitted leaves the
  // stored secret untouched (so re-saving the form doesn't wipe the password).
  smtp_pass: z.string().max(255).optional(),
  // Explicit opt-in to clear the stored password.
  smtp_pass_clear: z.boolean().optional(),
});

router.patch('/system', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = systemSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input', details: parsed.error.flatten() }, 400);
  const d = parsed.data;

  const setStr = (k: string, v: string | undefined) => { if (v !== undefined) setSetting(k, v); };
  const setBool = (k: string, v: boolean | undefined) => { if (v !== undefined) setSetting(k, v ? '1' : '0'); };

  setStr('ollama_url', d.ollama_url);
  setStr('ollama_model', d.ollama_model);
  setStr('stockfish_path', d.stockfish_path);

  setBool('allow_signup', d.allow_signup);
  setBool('require_email_verification', d.require_email_verification);
  setBool('notify_admin_on_signup', d.notify_admin_on_signup);
  setStr('public_base_url', d.public_base_url);
  setStr('smtp_host', d.smtp_host);
  if (d.smtp_port !== undefined) setSetting('smtp_port', d.smtp_port === '' ? '' : String(d.smtp_port));
  setBool('smtp_secure', d.smtp_secure);
  setStr('smtp_user', d.smtp_user);
  setStr('smtp_from', d.smtp_from);
  if (d.smtp_pass_clear) setSetting('smtp_pass', '');
  else if (d.smtp_pass) setSetting('smtp_pass', d.smtp_pass);

  return c.json({ ok: true });
});

// Send a real test message to the given address using the *saved* SMTP config
// (env or settings). The admin should Save before testing. We verify the
// connection first so a creds/host error reports cleanly instead of as a send
// failure.
const testEmailSchema = z.object({ to: z.string().trim().email() });
router.post('/test/email', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = testEmailSchema.safeParse(body);
  if (!parsed.success) return c.json({ ok: false, error: 'invalid_email' }, 400);
  if (!isMailerConfigured()) return c.json({ ok: false, error: 'smtp_not_configured' });
  const conn = await verifyConnection();
  if (!conn.ok) return c.json({ ok: false, error: conn.error ?? 'connection_failed' });
  const res = await sendMail({
    to: parsed.data.to,
    subject: 'Patzer SMTP test',
    text: 'This is a test email from your Patzer server. SMTP is working.',
    html: '<p>This is a test email from your <b>Patzer</b> server. SMTP is working. ♟</p>',
  });
  return c.json({ ok: res.ok, error: res.error });
});

// ---- Health checks ----

router.post('/test/ollama', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const url = (body && typeof body === 'object' && 'url' in body && typeof body.url === 'string')
    ? body.url
    : ollamaUrl();
  if (!url) return c.json({ ok: false, error: 'no_url_configured' });
  return c.json(await testOllama(url));
});

router.post('/test/ollama-models', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const url = (body && typeof body === 'object' && 'url' in body && typeof body.url === 'string')
    ? body.url
    : ollamaUrl();
  if (!url) return c.json({ ok: false, error: 'no_url_configured' }, 400);
  const tags = await testOllama(url);
  if (!tags.ok) return c.json({ ok: false, error: tags.error });
  // Test each model serially with a 30s budget per model.
  const results: Array<{ model: string; ok: boolean; latencyMs: number; sample?: string; error?: string }> = [];
  for (const m of tags.models) {
    const r = await testModel(url, m.name, 30_000);
    results.push({ model: m.name, ...r });
  }
  return c.json({ ok: true, results });
});

router.post('/test/stockfish', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const path = (body && typeof body === 'object' && 'path' in body && typeof body.path === 'string' && body.path)
    ? body.path
    : undefined;
  return c.json(await StockfishEngine.test(path));
});

export default router;
