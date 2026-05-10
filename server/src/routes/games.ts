import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { fetchRecentGames, getPlayer, type ChessComGame } from '../chess/chesscom.js';
import { SCORING_VERSION } from '../chess/classifier.js';

const router = new Hono();
router.use('*', requireAuth);

router.get('/', (c) => {
  const user = c.get('user');
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
  const bookmarked = c.req.query('bookmarked') === '1';
  const q = (c.req.query('q') ?? '').trim().toLowerCase();
  // An analysis cached at an older scoring_version reads as "not analyzed" in
  // the list — accuracy values from the old scoring would mislead the user.
  const filters: string[] = ['g.user_id = ?'];
  const params: unknown[] = [user.id];
  if (bookmarked) filters.push('g.bookmarked = 1');
  if (q) {
    filters.push('(LOWER(g.white) LIKE ? OR LOWER(g.black) LIKE ? OR LOWER(g.opening_name) LIKE ? OR LOWER(g.notes) LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  const rows = db.prepare(`
    SELECT g.id, g.source, g.external_id, g.white, g.black, g.result, g.time_control, g.time_class,
           g.eco, g.opening_name, g.end_time, g.user_color, g.rated,
           g.user_rating_after, g.opponent_rating_after,
           g.bookmarked, g.notes,
           CASE WHEN a.game_id IS NOT NULL AND a.scoring_version >= ? THEN 1 ELSE 0 END as analyzed,
           CASE WHEN a.scoring_version >= ? THEN a.accuracy_white ELSE NULL END as accuracy_white,
           CASE WHEN a.scoring_version >= ? THEN a.accuracy_black ELSE NULL END as accuracy_black,
           CASE WHEN a.scoring_version >= ? THEN a.performance_white ELSE NULL END as performance_white,
           CASE WHEN a.scoring_version >= ? THEN a.performance_black ELSE NULL END as performance_black
    FROM games g LEFT JOIN analyses a ON a.game_id = g.id
    WHERE ${filters.join(' AND ')}
    ORDER BY g.end_time DESC NULLS LAST, g.id DESC
    LIMIT ?
  `).all(SCORING_VERSION, SCORING_VERSION, SCORING_VERSION, SCORING_VERSION, SCORING_VERSION, ...params, limit);
  return c.json({ games: rows });
});

const notesSchema = z.object({ notes: z.string().max(4000) });
router.patch('/:id/notes', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));
  const parsed = notesSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  const r = db.prepare('UPDATE games SET notes = ? WHERE id = ? AND user_id = ?').run(parsed.data.notes, id, user.id);
  if (r.changes === 0) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});

const bookmarkSchema = z.object({ bookmarked: z.boolean() });
router.patch('/:id/bookmark', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));
  const parsed = bookmarkSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  const r = db.prepare('UPDATE games SET bookmarked = ? WHERE id = ? AND user_id = ?').run(parsed.data.bookmarked ? 1 : 0, id, user.id);
  if (r.changes === 0) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true, bookmarked: parsed.data.bookmarked });
});

router.get('/:id', (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const game = db.prepare('SELECT * FROM games WHERE id = ? AND user_id = ?').get(id, user.id);
  if (!game) return c.json({ error: 'not_found' }, 404);
  const analysis = db.prepare('SELECT * FROM analyses WHERE game_id = ?').get(id) as
    | { scoring_version: number }
    | undefined;
  // If the analysis was made at an older scoring_version, hide it — UI will
  // show the Analyze CTA (and we set a flag so the frontend can auto-fire it).
  const stale = !!(analysis && analysis.scoring_version < SCORING_VERSION);
  return c.json({
    game,
    analysis: stale ? null : analysis,
    analysis_stale: stale,
  });
});

router.delete('/:id', (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const r = db.prepare('DELETE FROM games WHERE id = ? AND user_id = ?').run(id, user.id);
  if (r.changes === 0) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});

const importSchema = z.object({
  username: z.string().trim().regex(/^[A-Za-z0-9_-]{2,40}$/).optional(),
  limit: z.number().int().min(1).max(200).default(20),
});

router.post('/import/chesscom', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const parsed = importSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  const username = parsed.data.username ?? user.profile.chesscom_username;
  if (!username) return c.json({ error: 'no_chesscom_username' }, 400);

  const player = await getPlayer(username);
  if (!player) return c.json({ error: 'player_not_found' }, 404);

  const games = await fetchRecentGames(username, parsed.data.limit);
  // Imported chess.com games are NEVER rated in Patzer's pool — they have their
  // own chess.com rating that lives there. Only PvP games inside Patzer count.
  const stmt = db.prepare(`
    INSERT INTO games (user_id, source, external_id, pgn, white, black, result, time_control, time_class, end_time, user_color, rated)
    VALUES (?, 'chesscom', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(user_id, source, external_id) DO NOTHING
  `);

  const lcUsername = username.toLowerCase();
  let imported = 0;
  for (const g of games) {
    const userColor: 'white' | 'black' | null =
      g.white.username.toLowerCase() === lcUsername ? 'white' :
      g.black.username.toLowerCase() === lcUsername ? 'black' : null;
    const result = resultFor(g, userColor);
    // chess.com sends `time_class` directly — use it as the source of truth.
    const timeClass = ['bullet', 'blitz', 'rapid', 'daily'].includes(g.time_class) ? g.time_class : null;
    const r = stmt.run(
      user.id,
      g.url,
      g.pgn,
      g.white.username,
      g.black.username,
      result,
      g.time_control,
      timeClass,
      new Date(g.end_time * 1000).toISOString(),
      userColor,
    );
    if (r.changes > 0) imported++;
  }

  return c.json({ imported, total: games.length });
});

function resultFor(g: ChessComGame, userColor: 'white' | 'black' | null): string {
  if (!userColor) return g.white.result;
  const r = userColor === 'white' ? g.white.result : g.black.result;
  if (r === 'win') return 'win';
  if (['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'].includes(r)) return 'draw';
  return 'loss';
}

export default router;
