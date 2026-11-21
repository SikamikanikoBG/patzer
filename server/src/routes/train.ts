// Tactic Trainer — extracts personalized puzzles from the user's own analyzed
// games. A puzzle is the FEN before a user blunder/miss where the engine had a
// strong best move; the user retries it and we record solved/failed. When the
// engine's line goes on with forcing moves, so does the puzzle, and one you
// don't solve at the first try comes back the next day (chess/gamePuzzles.ts).
//
// This is the killer differentiator over chess.com (whose Tactic Trainer is a
// generic puzzle dump): your puzzles are *your mistakes*. Every solve is
// retraining a real pattern you got wrong.

import { Hono } from 'hono';
import { z } from 'zod';
import { Chess } from 'chess.js';
import { db } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { SCORING_VERSION, cpToWinPct, normalizeEval } from '../chess/classifier.js';
import { createAnalysisEngine } from '../chess/engine.js';
import { dayOf } from '../chess/openingTrainer.js';
import { afterTry, isDue, isPuzzleMove, positionAfter, puzzleLine, type QueueState } from '../chess/gamePuzzles.js';
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

type AttemptRow = QueueState & { game_id: number; ply: number };

// The browser's calendar day (?today= or { today }), like the opening trainer.
const todayOf = (v: unknown) => dayOf(typeof v === 'string' ? v : null);

const GAME_SQL = `
  SELECT g.id AS game_id, g.user_color, g.end_time, g.white, g.black, a.moves_json
  FROM analyses a JOIN games g ON g.id = a.game_id
  WHERE g.user_id = ? AND a.scoring_version >= ?`;

function toPuzzle(r: PuzzleCandidate, m: AnalyzedMove, review: boolean) {
  const line = puzzleLine(m.fen_before, m.best_move_uci!, m.best_pv ?? []);
  if (line.uci.length === 0) return null;
  return {
    game_id: r.game_id,
    ply: m.ply,
    fen: m.fen_before,
    side_to_move: m.ply % 2 === 1 ? 'white' : 'black',
    played_san: m.san,
    played_uci: m.uci,
    best_san: m.best_move_san,
    best_uci: m.best_move_uci,
    best_pv: m.best_pv,
    // The whole solution: yours, theirs, yours … (UCI and SAN).
    line: line.uci,
    line_san: line.san,
    classification: m.classification,
    centipawn_loss: m.centipawn_loss,
    eval_before_cp: m.eval_before_cp,
    // For the coach's "why the engine's move beats yours" (as in Game Review).
    eval_after_cp: m.eval_after_cp,
    end_time: r.end_time,
    white: r.white,
    black: r.black,
    // A puzzle you got wrong before, back for review.
    review,
  };
}

/** The user's puzzle move at `ply` of `gameId`, if it still is one. */
function loadPuzzleMove(userId: number, gameId: number, ply: number): { game: PuzzleCandidate; move: AnalyzedMove } | null {
  const game = db.prepare(`${GAME_SQL} AND g.id = ?`).get(userId, SCORING_VERSION, gameId) as PuzzleCandidate | undefined;
  if (!game) return null;
  const move = (JSON.parse(game.moves_json) as AnalyzedMove[]).find((m) => m.ply === ply);
  if (!move || !isPuzzleMove(move, game.user_color ?? 'white')) return null;
  return { game, move };
}

function dueCount(userId: number, today: string): number {
  const r = db.prepare(`
    SELECT COUNT(*) AS n FROM puzzle_attempts
    WHERE user_id = ? AND solved = 0
      AND (due_on IS NULL OR due_on <= ?) AND (last_day IS NULL OR last_day < ?)
  `).get(userId, today, today) as { n: number };
  return r.n;
}

// GET /api/train/next — the next puzzle: one due for review first, else the
// newest one from your games you haven't tried yet.
//   ?exclude_solved=1     skip puzzles already done or not due yet (default 1)
//   ?game_id=N            only puzzles from this game
//   ?today=YYYY-MM-DD     the browser's calendar day
router.get('/next', (c) => {
  const me = c.get('user');
  const today = todayOf(c.req.query('today'));
  const excludeSolved = c.req.query('exclude_solved') !== '0';
  const gameIdQ = c.req.query('game_id');
  const filterGameId = gameIdQ ? Number(gameIdQ) : null;
  const due = dueCount(me.id, today);

  const tried = new Map<string, AttemptRow>();
  for (const r of db.prepare(`SELECT game_id, ply, solved, due_on, last_day FROM puzzle_attempts WHERE user_id = ?`).all(me.id) as AttemptRow[]) {
    tried.set(`${r.game_id}:${r.ply}`, r);
  }

  // Reviews first, oldest first — they may come from games older than the 60
  // scanned below.
  if (excludeSolved && filterGameId == null) {
    const dueRows = [...tried.values()]
      .filter((r) => isDue(r, today))
      .sort((a, b) => (a.due_on ?? '').localeCompare(b.due_on ?? ''));
    for (const r of dueRows) {
      const found = loadPuzzleMove(me.id, r.game_id, r.ply);
      const puzzle = found && toPuzzle(found.game, found.move, true);
      if (puzzle) return c.json({ puzzle, due });
    }
  }

  // Pull recent analyzed games (up to 60) and walk their moves looking for
  // the user's blunders/misses that have a usable best-move solution.
  const where = filterGameId != null ? 'AND g.id = ?' : '';
  const params: unknown[] = [me.id, SCORING_VERSION];
  if (filterGameId != null) params.push(filterGameId);
  const rows = db.prepare(`${GAME_SQL} ${where} ORDER BY g.end_time DESC, g.id DESC LIMIT 60`).all(...params) as PuzzleCandidate[];

  // Newest first so freshly analyzed games' lessons are the next puzzle.
  for (const r of rows) {
    const userColor = r.user_color ?? 'white';
    const moves = JSON.parse(r.moves_json) as AnalyzedMove[];
    for (const m of moves) {
      if (!isPuzzleMove(m, userColor)) continue;
      const before = tried.get(`${r.game_id}:${m.ply}`);
      if (excludeSolved && before && !isDue(before, today)) continue;
      const puzzle = toPuzzle(r, m, !!before && before.solved === 0);
      if (puzzle) return c.json({ puzzle, due });
    }
  }
  return c.json({ puzzle: null, due });
});

const uciSchema = z.string().regex(/^[a-h][1-8][a-h][1-8][nbrq]?$/i);

// POST /api/train/attempt — the first try at a puzzle: solved or not. The
// page checks the moves itself (it has the line); a second go the same day is
// practice and isn't sent.
const attemptSchema = z.object({
  game_id: z.number().int().positive(),
  ply: z.number().int().positive(),
  solved: z.boolean(),
  attempted_uci: uciSchema.optional(),
  today: z.string().max(10).optional(),
});

router.post('/attempt', async (c) => {
  const me = c.get('user');
  const parsed = attemptSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  const { game_id, ply, solved, attempted_uci } = parsed.data;
  const today = todayOf(parsed.data.today);

  const found = loadPuzzleMove(me.id, game_id, ply);
  if (!found) return c.json({ error: 'not_found' }, 404);
  const { move } = found;

  const before = db.prepare(`
    SELECT game_id, ply, solved, due_on, last_day FROM puzzle_attempts WHERE user_id = ? AND game_id = ? AND ply = ?
  `).get(me.id, game_id, ply) as AttemptRow | undefined;
  const next = afterTry(before ?? null, solved, today);

  if (!before) {
    db.prepare(`
      INSERT INTO puzzle_attempts (user_id, game_id, ply, fen, solution_uci, attempted_uci, solved, due_on, last_day)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(me.id, game_id, ply, move.fen_before, move.best_move_uci!.toLowerCase(), attempted_uci?.toLowerCase() ?? null, next.solved, next.due_on, next.last_day);
  } else if (next.counts) {
    db.prepare(`
      UPDATE puzzle_attempts SET solved = ?, due_on = ?, last_day = ?, attempted_uci = ?, created_at = datetime('now')
      WHERE user_id = ? AND game_id = ? AND ply = ?
    `).run(next.solved, next.due_on, next.last_day, attempted_uci?.toLowerCase() ?? null, me.id, game_id, ply);
  }

  return c.json({ counted: next.counts, done: next.solved === 1, due_on: next.due_on });
});

// POST /api/train/check — is a move that isn't the line's just as good? The
// engine compares the position after it with the position after the line's
// move; within ALT_MAX_DROP win-chance points (Patzer calls that "excellent")
// it counts as solved, so nobody is told a good move is wrong. Your own move
// from the game never counts.
const ALT_MAX_DROP = 2;
const CHECK_DEPTH = 14;
const checkInflight = new Set<number>();

const checkSchema = z.object({
  game_id: z.number().int().positive(),
  ply: z.number().int().positive(),
  step: z.number().int().min(0).max(8),
  uci: uciSchema,
});

router.post('/check', async (c) => {
  const me = c.get('user');
  const parsed = checkSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  const { game_id, ply, step } = parsed.data;
  const uci = parsed.data.uci.toLowerCase();

  const found = loadPuzzleMove(me.id, game_id, ply);
  if (!found) return c.json({ error: 'not_found' }, 404);
  const { move } = found;
  const line = puzzleLine(move.fen_before, move.best_move_uci!, move.best_pv ?? []).uci;
  if (step % 2 !== 0 || step >= line.length) return c.json({ error: 'invalid_input' }, 400);

  const fen = positionAfter(move.fen_before, line, step);
  if (!fen) return c.json({ error: 'not_found' }, 404);
  const expected = line[step]!;
  if (uci === expected || (expected.length === 5 && uci === expected.slice(0, 4) && expected.endsWith('q'))) return c.json({ ok: true });
  if (step === 0 && uci === move.uci.toLowerCase()) return c.json({ ok: false });

  const after = (u: string): Chess | null => {
    const chess = new Chess(fen);
    try {
      chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.slice(4, 5) || undefined });
      return chess;
    } catch {
      return null;
    }
  };
  const alt = after(uci);
  const want = after(expected);
  if (!alt || !want) return c.json({ ok: false });
  if (alt.isCheckmate()) return c.json({ ok: true });
  if (want.isCheckmate() || alt.isGameOver()) return c.json({ ok: false });

  if (checkInflight.has(me.id)) return c.json({ error: 'already_analyzing' }, 429);
  checkInflight.add(me.id);
  const engine = createAnalysisEngine();
  try {
    await engine.start();
    const threads = Math.max(1, Math.min(16, Number(process.env.STOCKFISH_THREADS) || 2));
    const hashMb = Math.max(16, Math.min(4096, Number(process.env.STOCKFISH_HASH) || 64));
    await engine.setOption('Threads', String(threads));
    await engine.setOption('Hash', String(hashMb));
    const mover = new Chess(fen).turn();
    // Win chance for the side that moved, from the engine's view of the
    // position after the move (where the other side is to move).
    const winFor = async (chess: Chess) => {
      const e = await engine.evaluateMulti(chess.fen(), CHECK_DEPTH, 1);
      const white = normalizeEval(e.cp, e.mate, chess.turn());
      return cpToWinPct(mover === 'w' ? white : -white);
    };
    const wantWin = await winFor(want);
    const altWin = await winFor(alt);
    return c.json({ ok: wantWin - altWin < ALT_MAX_DROP });
  } catch {
    // No engine: the line's move is the only one we can vouch for.
    return c.json({ ok: false, engine: false });
  } finally {
    checkInflight.delete(me.id);
    await engine.quit().catch(() => {});
  }
});

router.get('/stats', (c) => {
  const me = c.get('user');
  const today = todayOf(c.req.query('today'));
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
    due: dueCount(me.id, today),
    recent,
  });
});

export default router;
