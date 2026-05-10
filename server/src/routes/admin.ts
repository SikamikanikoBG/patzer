import { Hono } from 'hono';
import { z } from 'zod';
import { db, getSetting, setSetting } from '../db.js';
import { requireAdmin } from '../auth/middleware.js';
import { hashPassword } from '../auth/passwords.js';
import { testOllama, testModel, ollamaUrl, ollamaModel } from '../coach/ollama.js';
import { StockfishEngine } from '../chess/stockfish.js';
import type { Profile, Role } from '../types.js';

const router = new Hono();
router.use('*', requireAdmin);

// ---- Users ----

router.get('/users', (c) => {
  const rows = db.prepare(`
    SELECT u.id, u.username, u.role, u.created_at,
           p.display_name, p.avatar_emoji, p.language, p.audience
    FROM users u JOIN profiles p ON p.user_id = u.id
    ORDER BY u.id
  `).all();
  return c.json({ users: rows });
});

const createUserSchema = z.object({
  username: z.string().trim().min(2).max(40),
  password: z.string().min(6).max(200),
  display_name: z.string().trim().min(1).max(60),
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
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(d.username);
  if (existing) return c.json({ error: 'username_taken' }, 409);
  const passwordHash = await hashPassword(d.password);
  const tx = db.transaction(() => {
    const r = db.prepare(`INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)`).run(d.username, passwordHash, d.role);
    const id = Number(r.lastInsertRowid);
    db.prepare(`INSERT INTO profiles (user_id, display_name, language, audience, coach_behavior, avatar_emoji, tts_enabled)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, d.display_name, d.language, d.audience, d.coach_behavior, d.avatar_emoji, d.tts_enabled ? 1 : 0);
    return id;
  });
  return c.json({ id: tx() });
});

const updateUserSchema = z.object({
  role: z.enum(['admin', 'user']).optional(),
  password: z.string().min(6).max(200).optional(),
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
  const exists = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!exists) return c.json({ error: 'not_found' }, 404);

  if (d.password) {
    const hash = await hashPassword(d.password);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
  }
  if (d.role) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(d.role, id);

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
  return c.json({
    ollama_url: getSetting('ollama_url'),
    ollama_model: getSetting('ollama_model'),
    stockfish_path: getSetting('stockfish_path'),
  });
});

const systemSchema = z.object({
  ollama_url: z.string().url().or(z.literal('')).optional(),
  ollama_model: z.string().optional(),
  stockfish_path: z.string().optional(),
});

router.patch('/system', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = systemSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) setSetting(k, v);
  }
  return c.json({ ok: true });
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
