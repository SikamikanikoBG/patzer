import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import type { Profile } from '../types.js';

const router = new Hono();
router.use('*', requireAuth);

const profileSchema = z.object({
  display_name: z.string().trim().min(1).max(60).optional(),
  avatar_emoji: z.string().min(1).max(8).optional(),
  language: z.enum(['en', 'bg']).optional(),
  audience: z.enum(['kid', 'beginner', 'intermediate', 'advanced']).optional(),
  chesscom_username: z.string().trim().max(40).nullable().optional(),
  coach_behavior: z.enum(['silent', 'on_demand', 'always_on_pedagogical']).optional(),
  tts_enabled: z.boolean().optional(),
  tts_voice: z.string().nullable().optional(),
  tts_rate: z.number().min(0.5).max(2).optional(),
  tts_pitch: z.number().min(0).max(2).optional(),
  board_theme: z.enum(['wood', 'green', 'blue']).optional(),
  piece_set: z.string().optional(),
  site_theme: z.enum(['light', 'dark', 'auto']).optional(),
  blunder_warning: z.boolean().optional(),
  sound_enabled: z.boolean().optional(),
});

router.get('/profile', (c) => {
  const user = c.get('user');
  return c.json({ profile: user.profile });
});

router.patch('/profile', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input', details: parsed.error.flatten() }, 400);

  const updates = parsed.data;
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(updates)) {
    if (v === undefined) continue;
    fields.push(`${k} = ?`);
    values.push(typeof v === 'boolean' ? (v ? 1 : 0) : (v as string | number | null));
  }
  if (fields.length === 0) return c.json({ profile: user.profile });

  values.push(user.id);
  db.prepare(`UPDATE profiles SET ${fields.join(', ')} WHERE user_id = ?`).run(...values);
  const profile = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(user.id) as Profile;
  return c.json({ profile });
});

export default router;
