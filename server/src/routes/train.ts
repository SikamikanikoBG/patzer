// Tactic Trainer — extracts personalized puzzles from the user's own analyzed
// games. A puzzle is the FEN before a user blunder/miss where the engine had a
// strong best move; the user retries it and we record solved/failed.
//
// This is the killer differentiator over chess.com (whose Tactic Trainer is a
// generic puzzle dump): your puzzles are *your mistakes*. Every solve is
// retraining a real pattern you got wrong.

import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { SCORING_VERSION } from '../chess/classifier.js';
import type { AnalyzedMove } from '../types.js';

const router = new Hono();
router.use('*', requireAuth);

interface PuzzleCandidate {
  game_id: number;
  user_color: 'white' | 'black' | null;
  end_time: string | null;
  white: string;
  black: string;
  moves_json: string;
}

// GET /api/train/next — return one fresh puzzle the user hasn't solved yet.
//   ?exclude_solved=1     skip puzzles already solved (default 1)
//   ?game_id=N            only puzzles from this game
router.get('/next', (c) => {
  const me = c.get('user');
  const excludeSolved = c.req.query('exclude_solved') !== '0';
  const gameIdQ = c.req.query('game_id');
  const filterGameId = gameIdQ ? Number(gameIdQ) : null;

  // Pull recent analyzed games (up to 60) and walk their moves looking for
  // the user's blunders/misses that have a usable best-move solution.
  const where = filterGameId != null ? 'AND g.id = ?' : '';
  const params: unknown[] = [me.id, SCORING_VERSION];
  if (filterGameId != null) params.push(filterGameId);
  const rows = db.prepare(`
    SELECT g.id AS game_id, g.user_color, g.end_time, g.white, g.black, a.moves_json
    FROM analyses a JOIN games g ON g.id = a.game_id
    WHERE g.user_id = ? AND a.scoring_version >= ?
    ${where}
    ORDER BY g.end_time DESC, g.id DESC
    LIMIT 60
  `).all(...params) as PuzzleCandidate[];

  // Cache solved (game_id, ply) so we can skip in O(1).
  const solved = new Set<string>();
  if (excludeSolved) {
    const solvedRows = db.prepare(`
      SELECT game_id, ply FROM puzzle_attempts
      WHERE user_id = ? AND solved = 1
    `).all(me.id) as { game_id: number; ply: number }[];
    for (const r of solvedRows) solved.add(`${r.game_id}:${r.ply}`);
  }

  // Pick the most recent qualifying blunder/miss across rows. Newest-first so
  // freshly analyzed games' lessons are the next puzzle.
  for (const r of rows) {
    const userColor = r.user_color ?? 'white';
    const moves = JSON.parse(r.moves_json) as AnalyzedMove[];
    for (const m of moves) {
      const side: 'white' | 'black' = m.ply % 2 === 1 ? 'white' : 'black';
      if (side !== userColor) continue;
      if (!isPuzzleClass(m.classification)) continue;
      if (!m.best_move_uci || !m.best_move_san) continue;
      if (m.best_move_uci === m.uci) continue;
      // Avoid 1-move puzzles where the user's own move was already best.
      if (excludeSolved && solved.has(`${r.game_id}:${m.ply}`)) continue;

      return c.json({
        puzzle: {
          game_id: r.game_id,
          ply: m.ply,
          fen: m.fen_before,
          side_to_move: side,
          played_san: m.san,
          played_uci: m.uci,
          best_san: m.best_move_san,
          best_uci: m.best_move_uci,
          best_pv: m.best_pv,
          classification: m.classification,
          centipawn_loss: m.centipawn_loss,
          eval_before_cp: m.eval_before_cp,
          end_time: r.end_time,
          white: r.white,
          black: r.black,
        },
      });
    }
  }
  return c.json({ puzzle: null });
});

const attemptSchema = z.object({
  game_id: z.number().int().positive(),
  ply: z.number().int().positive(),
  attempted_uci: z.string().regex(/^[a-h][1-8][a-h][1-8][nbrq]?$/i),
});

router.post('/attempt', async (c) => {
  const me = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const parsed = attemptSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  const { game_id, ply, attempted_uci } = parsed.data;

  // Load the analyzed move to compare against.
  const row = db.prepare(`
    SELECT a.moves_json
    FROM analyses a JOIN games g ON g.id = a.game_id
    WHERE a.game_id = ? AND g.user_id = ? AND a.scoring_version >= ?
  `).get(game_id, me.id, SCORING_VERSION) as { moves_json: string } | undefined;
  if (!row) return c.json({ error: 'not_found' }, 404);

  const moves = JSON.parse(row.moves_json) as AnalyzedMove[];
  const target = moves.find((m) => m.ply === ply);
  if (!target || !target.best_move_uci) return c.json({ error: 'not_found' }, 404);

  const expected = target.best_move_uci.toLowerCase();
  const got = attempted_uci.toLowerCase();
  // Accept any move in the engine's PV continuation (sometimes the engine has
  // multiple equally-best moves and chess.js will produce a different SAN).
  const okFromBest = got === expected;
  const okFromPv = (target.best_pv?.[0]?.toLowerCase() ?? '') === got;
  const solved = okFromBest || okFromPv ? 1 : 0;

  db.prepare(`
    INSERT INTO puzzle_attempts (user_id, game_id, ply, fen, solution_uci, attempted_uci, solved)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, game_id, ply) DO UPDATE SET
      attempted_uci = excluded.attempted_uci,
      solved = MAX(puzzle_attempts.solved, excluded.solved),
      created_at = datetime('now')
  `).run(me.id, game_id, ply, target.fen_before, expected, got, solved);

  return c.json({
    solved: !!solved,
    expected_uci: expected,
    expected_san: target.best_move_san,
    explanation_pv: target.best_pv,
  });
});

router.get('/stats', (c) => {
  const me = c.get('user');
  const stats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN solved = 1 THEN 1 ELSE 0 END) AS solved,
      SUM(CASE WHEN solved = 0 THEN 1 ELSE 0 END) AS failed
    FROM puzzle_attempts WHERE user_id = ?
  `).get(me.id) as { total: number; solved: number; failed: number };
  // Recent attempt stream
  const recent = db.prepare(`
    SELECT game_id, ply, solved, attempted_uci, solution_uci, created_at
    FROM puzzle_attempts
    WHERE user_id = ? ORDER BY created_at DESC LIMIT 20
  `).all(me.id);
  return c.json({
    total: stats.total ?? 0,
    solved: stats.solved ?? 0,
    failed: stats.failed ?? 0,
    accuracy: stats.total > 0 ? Math.round(((stats.solved ?? 0) / stats.total) * 100) : 0,
    recent,
  });
});

function isPuzzleClass(c: AnalyzedMove['classification']): boolean {
  return c === 'blunder' || c === 'miss' || c === 'mistake';
}

export default router;
