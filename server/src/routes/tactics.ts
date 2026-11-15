// Tactic puzzles (Train → Puzzles) — see chess/tactics.ts.
//
//   GET  /api/tactics/next?theme=fork   the next puzzle for you (or null)
//   POST /api/tactics/attempt           { id, solved } — your first try rates
//   GET  /api/tactics/stats             your puzzle rating and counts
//   GET  /api/tactics/daily?today=      the puzzle of the day, done or not, your streak
//
// The page checks your moves itself (it has the solution, like the Learn
// section); the server only keeps what has to outlive the page: which puzzles
// you tried, and your rating.

import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { THEME_FILTERS, dailyDone, dailyPuzzle, dailyStreak, nextPuzzle, recordAttempt, statsOf } from '../chess/tactics.js';
import { dayOf } from '../chess/openingTrainer.js';
import { originalPuzzleGame } from '../chess/puzzleGame.js';

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
  /** The browser's calendar day, when this is the puzzle of the day. */
  daily: z.string().max(10).optional(),
});

router.post('/attempt', async (c) => {
  const me = c.get('user');
  const parsed = attemptSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  const day = parsed.data.daily !== undefined ? dayOf(parsed.data.daily) : null;
  const result = recordAttempt(me.id, parsed.data.id, parsed.data.solved, day);
  if (!result) return c.json({ error: 'not_found' }, 404);
  return c.json({
    rated: result.rated,
    rating_before: Math.round(result.rating_before),
    rating_after: Math.round(result.rating_after),
    ...(day ? { streak: dailyStreak(me.id, day) } : {}),
  });
});

router.get('/daily', (c) => {
  const me = c.get('user');
  const day = dayOf(c.req.query('today') ?? null);
  return c.json({ day, puzzle: dailyPuzzle(me.id, day), done: dailyDone(me.id, day), streak: dailyStreak(me.id, day) });
});

// Optional game context, loaded only after the user asks to inspect a puzzle.
router.get('/game/:id', async (c) => {
  const id = c.req.param('id');
  if (!/^[A-Za-z0-9]{5}$/.test(id)) return c.json({ error: 'invalid_id' }, 400);
  try {
    const game = await originalPuzzleGame(id);
    return game ? c.json(game) : c.json({ error: 'not_found' }, 404);
  } catch {
    return c.json({ error: 'source_unavailable' }, 502);
  }
});

router.get('/stats', (c) => {
  const me = c.get('user');
  return c.json(statsOf(me.id));
});

export default router;
