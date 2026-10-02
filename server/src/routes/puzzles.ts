// Puzzles — the Lichess puzzle database, filtered by theme and difficulty.
// (The Train page is the other kind of puzzle: positions from your own games.)
//
// Two sources: 'online' asks Hugging Face per puzzle, 'local' reads a copy an
// admin downloaded to this server. Both serve the same LichessPuzzle shape.

import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAdmin, requireAuth } from '../auth/middleware.js';
import {
  localPuzzleDb, localPuzzleStatus, pickPuzzle, removeLocalPuzzles, startPuzzleDownload,
  type PickOptions,
} from '../chess/puzzleDb.js';
import { pickOnlinePuzzle } from '../chess/puzzleOnline.js';
import {
  PUZZLE_DIFFICULTIES, PUZZLE_THEME_GROUPS, isPuzzleDifficulty, isPuzzleTheme,
} from '../chess/puzzleThemes.js';

const router = new Hono();

export const START_PUZZLE_RATING = 1500;

/**
 * Elo update against the puzzle's rating. K starts high so a new player finds
 * their level in a few dozen puzzles, then settles.
 */
export function nextPuzzleRating(rating: number, puzzleRating: number, solved: boolean, played: number): number {
  const k = played < 20 ? 40 : 20;
  const expected = 1 / (1 + 10 ** ((puzzleRating - rating) / 400));
  const next = Math.round(rating + k * ((solved ? 1 : 0) - expected));
  return Math.min(3500, Math.max(400, next));
}

function currentRating(userId: number): { rating: number; played: number } {
  const row = db.prepare(`
    SELECT (SELECT rating_after FROM lichess_puzzle_attempts WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1) AS rating,
           (SELECT COUNT(*) FROM lichess_puzzle_attempts WHERE user_id = ?) AS played
  `).get(userId, userId) as { rating: number | null; played: number };
  return { rating: row.rating ?? START_PUZZLE_RATING, played: row.played };
}

function excludeTried(userId: number) {
  return (ids: string[]): Set<string> => {
    if (!ids.length) return new Set();
    const rows = db.prepare(`SELECT puzzle_id FROM lichess_puzzle_attempts
      WHERE user_id = ? AND puzzle_id IN (${ids.map(() => '?').join(',')})`).all(userId, ...ids) as { puzzle_id: string }[];
    return new Set(rows.map((r) => r.puzzle_id));
  };
}

router.get('/status', requireAuth, (c) => {
  const me = c.get('user');
  const { rating, played } = currentRating(me.id);
  const totals = db.prepare(`SELECT COUNT(*) AS played, COALESCE(SUM(solved), 0) AS solved
    FROM lichess_puzzle_attempts WHERE user_id = ?`).get(me.id) as { played: number; solved: number };
  const recent = db.prepare(`SELECT puzzle_id, puzzle_rating, solved, rating_after, created_at
    FROM lichess_puzzle_attempts WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 12`).all(me.id);
  return c.json({
    local: localPuzzleStatus(),
    themes: PUZZLE_THEME_GROUPS,
    difficulties: Object.keys(PUZZLE_DIFFICULTIES),
    rating,
    played,
    solved: totals.solved,
    recent,
  });
});

router.get('/next', requireAuth, async (c) => {
  const me = c.get('user');
  const source = c.req.query('source') === 'local' ? 'local' : 'online';
  const themeQ = c.req.query('theme') ?? 'mix';
  const diffQ = c.req.query('difficulty') ?? 'normal';
  if (!isPuzzleTheme(themeQ) || !isPuzzleDifficulty(diffQ)) return c.json({ error: 'invalid_input' }, 400);

  const { rating } = currentRating(me.id);
  const centre = rating + PUZZLE_DIFFICULTIES[diffQ];
  const exclude = excludeTried(me.id);

  // Narrow window first so the puzzle really is at the chosen difficulty; rare
  // themes (under-promotion, Boden's mate…) may have nothing that close, so
  // widen before giving up.
  const windows: PickOptions[] = [100, 250, 600].map((half) => ({
    theme: themeQ, min: Math.max(0, centre - half), max: centre + half, exclude,
  }));
  if (source === 'local') {
    const local = localPuzzleDb();
    if (!local) return c.json({ error: 'local_missing' }, 409);
    for (const w of windows) {
      const p = pickPuzzle(local, w);
      if (p) return c.json({ puzzle: p, source });
    }
  } else {
    try {
      const p = await pickOnlinePuzzle(windows);
      if (p) return c.json({ puzzle: p, source });
    } catch (e) {
      const code = (e as Error).message;
      return c.json({ error: code === 'online_rate_limited' ? code : 'online_unavailable' }, 502);
    }
  }
  return c.json({ puzzle: null, source });
});

const attemptSchema = z.object({
  puzzle_id: z.string().regex(/^[A-Za-z0-9]{3,10}$/),
  puzzle_rating: z.number().int().min(0).max(4000),
  themes: z.array(z.string().max(40)).max(20).default([]),
  solved: z.boolean(),
});

router.post('/attempt', requireAuth, async (c) => {
  const me = c.get('user');
  const parsed = attemptSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  const { puzzle_id, puzzle_rating, themes, solved } = parsed.data;

  const before = currentRating(me.id);
  const already = db.prepare('SELECT 1 FROM lichess_puzzle_attempts WHERE user_id = ? AND puzzle_id = ?').get(me.id, puzzle_id);
  // A retry of a puzzle already tried leaves the rating alone — otherwise
  // failing, then replaying the now-known answer, would win the points back.
  if (already) return c.json({ rating: before.rating, delta: 0, counted: false });

  const after = nextPuzzleRating(before.rating, puzzle_rating, solved, before.played);
  db.prepare(`INSERT INTO lichess_puzzle_attempts (user_id, puzzle_id, puzzle_rating, themes, solved, rating_after)
    VALUES (?, ?, ?, ?, ?, ?)`).run(me.id, puzzle_id, puzzle_rating, themes.filter(isPuzzleTheme).join(' '), solved ? 1 : 0, after);
  return c.json({ rating: after, delta: after - before.rating, counted: true });
});

// Local copy — admin only: it is a ~300 MB download and ~1 GB on disk shared
// by every profile on this server.
router.post('/local/download', requireAdmin, (c) => {
  if (!startPuzzleDownload()) return c.json({ error: 'already_running' }, 409);
  return c.json({ ok: true, local: localPuzzleStatus() });
});

router.delete('/local', requireAdmin, (c) => {
  removeLocalPuzzles();
  return c.json({ ok: true, local: localPuzzleStatus() });
});

export default router;
