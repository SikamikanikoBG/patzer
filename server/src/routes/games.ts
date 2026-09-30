import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { getPlayer } from '../chess/chesscom.js';
import { importChessComGames } from '../chess/chesscomImport.js';
import { importLichessGames } from '../chess/lichessImport.js';
import { importPgnGames } from '../chess/pgnImport.js';
import { SCORING_VERSION } from '../chess/classifier.js';
import { GAME_SOURCES } from '../dbMigrations.js';
import { Chess } from 'chess.js';
import { clearLiveBotGame, loadLiveBotGame, resumableSummary } from '../chess/liveBotGames.js';

const TIME_CLASSES = ['bullet', 'blitz', 'rapid', 'daily'] as const;

const router = new Hono();
router.use('*', requireAuth);

router.get('/', (c) => {
  const user = c.get('user');
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
  const offset = Math.max(0, Math.floor(Number(c.req.query('offset') ?? 0)) || 0);
  const bookmarked = c.req.query('bookmarked') === '1';
  const q = (c.req.query('q') ?? '').trim().toLowerCase();
  // An analysis cached at an older scoring_version reads as "not analyzed" in
  // the list — accuracy values from the old scoring would mislead the user.
  const filters: string[] = ['g.user_id = ?'];
  const params: unknown[] = [user.id];
  if (bookmarked) filters.push('g.bookmarked = 1');
  // Review-list filters. Unknown values are ignored rather than rejected so a
  // stale bookmarked URL still shows games.
  const source = c.req.query('source');
  if (source && (GAME_SOURCES as readonly string[]).includes(source)) {
    filters.push('g.source = ?');
    params.push(source);
  }
  const result = c.req.query('result');
  if (result === 'win' || result === 'loss' || result === 'draw') {
    filters.push('g.result = ?');
    params.push(result);
  }
  const color = c.req.query('color');
  if (color === 'white' || color === 'black') {
    filters.push('g.user_color = ?');
    params.push(color);
  }
  const timeClass = c.req.query('time_class');
  if (timeClass && (TIME_CLASSES as readonly string[]).includes(timeClass)) {
    filters.push('g.time_class = ?');
    params.push(timeClass);
  }
  // Period in days back from now. end_time is an ISO-8601 UTC string, so a
  // plain string comparison orders it correctly.
  const days = Number(c.req.query('days'));
  if (Number.isFinite(days) && days > 0) {
    filters.push('g.end_time >= ?');
    params.push(new Date(Date.now() - Math.min(days, 36_500) * 86_400_000).toISOString());
  }
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
    LIMIT ? OFFSET ?
  `).all(SCORING_VERSION, SCORING_VERSION, SCORING_VERSION, SCORING_VERSION, SCORING_VERSION, ...params, limit, offset);
  // Totals over every matching game, not just this page — a full import can
  // hold thousands of games and the list only loads them a page at a time.
  const totals = db.prepare(`
    SELECT COUNT(*) AS total, COALESCE(SUM(g.bookmarked), 0) AS starred
    FROM games g WHERE ${filters.join(' AND ')}
  `).get(...params) as { total: number; starred: number };
  return c.json({ games: rows, total: totals.total, starred: totals.starred });
});

// Games you can walk back into: the bot game you left mid-move, and any PvP
// game with a friend that hasn't finished. Registered BEFORE `/:id` — Hono
// matches in order, and `/:id` would otherwise swallow `/live`.
//
// This is the entry point that didn't exist before v7.14.0: leaving a game and
// coming back had no route through the UI at all. You had to still have the
// original URL.
interface UnfinishedPvpRow {
  id: number; white: string; black: string; user_color: 'white' | 'black';
  time_control: string; pgn: string; last_move_at: string | null; created_at: string;
}

router.get('/live', (c) => {
  const user = c.get('user');

  const pvpRows = db.prepare(`
    SELECT id, white, black, user_color, time_control, pgn, last_move_at, created_at
    FROM games
    WHERE user_id = ? AND source = 'pvp' AND end_time IS NULL
      AND COALESCE(last_move_at, created_at) > datetime('now','-14 days')
    ORDER BY COALESCE(last_move_at, created_at) DESC
    LIMIT 20
  `).all(user.id) as UnfinishedPvpRow[];

  const pvp = [];
  for (const row of pvpRows) {
    let ply = 0;
    try {
      const probe = new Chess();
      if (row.pgn && row.pgn.trim()) probe.loadPgn(row.pgn, { strict: false });
      // A finished position with no end_time means the game ended in a way we
      // failed to record. Don't invite the user back into a game they cannot play.
      if (probe.isGameOver()) continue;
      ply = probe.history().length;
    } catch {
      continue;
    }
    pvp.push({
      game_id: row.id,
      opponent: row.user_color === 'white' ? row.black : row.white,
      user_color: row.user_color,
      time_control: row.time_control,
      ply,
      updated_at: row.last_move_at ?? row.created_at,
    });
  }

  return c.json({ bot: resumableSummary(loadLiveBotGame(user.id)), pvp });
});

/** "Start a new one instead" — throw away the stored bot game. */
router.delete('/live/bot', (c) => {
  const user = c.get('user');
  clearLiveBotGame(user.id);
  return c.json({ ok: true });
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
  // The whole history instead of the most recent `limit` games.
  all: z.boolean().default(false),
});

// A whole-history import walks every monthly archive and can take minutes;
// one per account at a time, so repeated clicks don't stack up requests.
const chesscomImportsRunning = new Set<number>();

router.post('/import/chesscom', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const parsed = importSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  const username = parsed.data.username ?? user.profile.chesscom_username;
  if (!username) return c.json({ error: 'no_chesscom_username' }, 400);
  if (chesscomImportsRunning.has(user.id)) return c.json({ error: 'import_in_progress' }, 429);

  chesscomImportsRunning.add(user.id);
  try {
    const player = await getPlayer(username);
    if (!player) return c.json({ error: 'player_not_found' }, 404);
    return c.json(await importChessComGames(user.id, username, parsed.data.all ? undefined : parsed.data.limit));
  } catch (e) {
    if ((e as Error).message === 'not_found') return c.json({ error: 'player_not_found' }, 404);
    return c.json({ error: 'chesscom_unavailable' }, 502);
  } finally {
    chesscomImportsRunning.delete(user.id);
  }
});

const lichessImportSchema = z.object({
  username: z.string().trim().regex(/^[A-Za-z0-9_-]{2,30}$/).optional(),
  limit: z.number().int().min(1).max(200).default(20),
  // Only games that ended after this moment (ms since epoch).
  since: z.number().int().positive().optional(),
  // The whole history instead of the most recent `limit` games.
  all: z.boolean().default(false),
});

// Requests to Lichess go out one at a time for the whole server, so one
// account may only have one import waiting — a user clicking "Import" over and
// over must not hold up everyone else's.
const lichessImportsRunning = new Set<number>();

router.post('/import/lichess', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const parsed = lichessImportSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  const username = parsed.data.username ?? user.profile.lichess_username;
  if (!username) return c.json({ error: 'no_lichess_username' }, 400);
  if (lichessImportsRunning.has(user.id)) return c.json({ error: 'import_in_progress' }, 429);

  lichessImportsRunning.add(user.id);
  try {
    return c.json(await importLichessGames(user.id, username, parsed.data.all ? undefined : parsed.data.limit, parsed.data.since));
  } catch (e) {
    const code = (e as Error).message;
    if (code === 'not_found') return c.json({ error: 'player_not_found' }, 404);
    if (code === 'rate_limited') return c.json({ error: 'lichess_rate_limited' }, 429);
    if (code === 'invalid_username') return c.json({ error: 'invalid_input' }, 400);
    return c.json({ error: 'lichess_unavailable' }, 502);
  } finally {
    lichessImportsRunning.delete(user.id);
  }
});

// Pasted PGN text or an uploaded .pgn file — one game or a whole database.
// 10 MB of PGN is tens of thousands of games; anything bigger is not a paste.
const pgnImportSchema = z.object({
  pgn: z.string().min(1).max(10_000_000),
});

router.post('/import/pgn', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const parsed = pgnImportSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  const r = importPgnGames(user.id, parsed.data.pgn);
  if (r.ids.length === 0) return c.json({ error: 'no_valid_games', ...r }, 400);
  return c.json(r);
});

export default router;
