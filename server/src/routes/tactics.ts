// Tactic puzzles (Train → Puzzles) — see chess/tactics.ts.
//
//   GET  /api/tactics/next?theme=fork   the next puzzle for you (or null)
//   POST /api/tactics/attempt           { id, solved } — your first try rates
//   GET  /api/tactics/stats             your puzzle rating and counts
//
// The page checks your moves itself (it has the solution, like the Learn
// section); the server only keeps what has to outlive the page: which puzzles
// you tried, and your rating.

import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { THEME_FILTERS, nextPuzzle, recordAttempt, statsOf } from '../chess/tactics.js';

const router = new Hono();
router.use('*', requireAuth);

router.get('/next', (c) => {
  const me = c.get('user');
  const theme = c.req.query('theme') || null;
  if (theme && !(theme in THEME_FILTERS)) return c.json({ error: 'invalid_theme' }, 400);
  return c.json({ puzzle: nextPuzzle(me.id, theme), themes: Object.keys(THEME_FILTERS) });
});

const attemptSchema = z.object({
  id: z.string().min(1).max(10),
  solved: z.boolean(),
});

router.post('/attempt', async (c) => {
  const me = c.get('user');
  const parsed = attemptSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  const result = recordAttempt(me.id, parsed.data.id, parsed.data.solved);
  if (!result) return c.json({ error: 'not_found' }, 404);
  return c.json({
    rated: result.rated,
    rating_before: Math.round(result.rating_before),
    rating_after: Math.round(result.rating_after),
  });
});

router.get('/stats', (c) => {
  const me = c.get('user');
  return c.json(statsOf(me.id));
});

export default router;
