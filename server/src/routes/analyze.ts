import { Hono } from 'hono';
import { z } from 'zod';
import { Chess } from 'chess.js';
import { db } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { StockfishEngine } from '../chess/stockfish.js';
import {
  classifyByWpDrop, refineClassification, normalizeEval, cpToWinPct,
  cpLossForPly, moveAccuracy, estimateElo, estimateGamePerformance, BOOK_PLIES,
  winDropForPly, SCORING_VERSION,
} from '../chess/classifier.js';
import { gameAccuracy, type MoveAccPoint } from '../chess/accuracy.js';
import { extractKeyMoments } from '../chess/keyMoments.js';
import { lookupOpeningByEpd, fenToEpd, lookupOpeningFromPgn } from '../chess/openings.js';
import type { AnalysisResult, AnalyzedMove, Color, KeyMomentSummary, PhaseSplit } from '../types.js';

const router = new Hono();
router.use('*', requireAuth);

const schema = z.object({
  game_id: z.number().int().positive(),
  depth: z.number().int().min(8).max(22).default(16),
  force: z.boolean().default(false),
});

// Single-flight guard: only one analysis per user at a time. Without this, a
// double-click on "Analyze" — or two browser tabs — spawns two concurrent
// Stockfish processes against the same PGN, doubling CPU and racing inserts.
const inflight = new Map<number, Promise<unknown>>();

interface AnalysisRow {
  depth: number;
  accuracy_white: number;
  accuracy_black: number;
  estimated_elo_white: number | null;
  estimated_elo_black: number | null;
  performance_white: number | null;
  performance_black: number | null;
  opening_eco: string | null;
  opening_name: string | null;
  key_moments_json: string | null;
  phase_split_json: string | null;
  moves_json: string;
}

interface GameRow {
  pgn: string;
  user_color: 'white' | 'black' | null;
  opponent_user_id: number | null;
  time_class: string | null;
  user_rating_before: number | null;
  opponent_rating_before: number | null;
  user_rd_before: number | null;
  result: 'win' | 'loss' | 'draw' | string | null;
}

function rowToAnalysis(row: AnalysisRow): AnalysisResult {
  return {
    depth: row.depth,
    accuracy_white: row.accuracy_white,
    accuracy_black: row.accuracy_black,
    estimated_elo_white: row.estimated_elo_white,
    estimated_elo_black: row.estimated_elo_black,
    performance_white: row.performance_white,
    performance_black: row.performance_black,
    opening_eco: row.opening_eco,
    opening_name: row.opening_name,
    key_moments: row.key_moments_json ? (JSON.parse(row.key_moments_json) as KeyMomentSummary[]) : [],
    phase_split: row.phase_split_json ? (JSON.parse(row.phase_split_json) as PhaseSplit) : null,
    moves: JSON.parse(row.moves_json) as AnalyzedMove[],
  };
}

router.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  const { game_id, depth, force } = parsed.data;

  const game = db.prepare(`
    SELECT pgn, user_color, opponent_user_id, time_class,
           user_rating_before, opponent_rating_before, user_rd_before, result
      FROM games WHERE id = ? AND user_id = ?
  `).get(game_id, user.id) as GameRow | undefined;
  if (!game) return c.json({ error: 'not_found' }, 404);

  if (inflight.has(user.id)) return c.json({ error: 'already_analyzing' }, 429);

  if (!force) {
    const existing = db.prepare('SELECT depth, scoring_version FROM analyses WHERE game_id = ?').get(game_id) as
      | { depth: number; scoring_version: number }
      | undefined;
    if (existing && existing.depth >= depth && existing.scoring_version >= SCORING_VERSION) {
      const cached = db.prepare(`SELECT depth, accuracy_white, accuracy_black,
                                        estimated_elo_white, estimated_elo_black,
                                        performance_white, performance_black,
                                        opening_eco, opening_name,
                                        key_moments_json, phase_split_json, moves_json
                                   FROM analyses WHERE game_id = ?`).get(game_id) as AnalysisRow;
      return c.json({ analysis: rowToAnalysis(cached), cached: true });
    }
  }

  const work = (async () => {
    const result = await analyzePgnFull(game.pgn, depth, {
      score: scoreFromResultForUser(game.result, game.user_color ?? 'white'),
      userColor: game.user_color ?? 'white',
      opponentRating: game.opponent_rating_before,
      opponentRd: game.user_rd_before, // best available for opponent if not stored separately
    });
    db.prepare(`
      INSERT INTO analyses (game_id, depth, accuracy_white, accuracy_black,
        estimated_elo_white, estimated_elo_black,
        performance_white, performance_black,
        opening_eco, opening_name,
        key_moments_json, phase_split_json,
        moves_json, scoring_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(game_id) DO UPDATE SET
        depth = excluded.depth,
        accuracy_white = excluded.accuracy_white, accuracy_black = excluded.accuracy_black,
        estimated_elo_white = excluded.estimated_elo_white, estimated_elo_black = excluded.estimated_elo_black,
        performance_white = excluded.performance_white, performance_black = excluded.performance_black,
        opening_eco = excluded.opening_eco, opening_name = excluded.opening_name,
        key_moments_json = excluded.key_moments_json, phase_split_json = excluded.phase_split_json,
        moves_json = excluded.moves_json, scoring_version = excluded.scoring_version,
        created_at = datetime('now')
    `).run(
      game_id, depth,
      result.accuracy_white, result.accuracy_black,
      result.estimated_elo_white, result.estimated_elo_black,
      result.performance_white, result.performance_black,
      result.opening_eco, result.opening_name,
      JSON.stringify(result.key_moments),
      result.phase_split ? JSON.stringify(result.phase_split) : null,
      JSON.stringify(result.moves), SCORING_VERSION,
    );
    // Backfill `games.eco` + `games.opening_name` so list endpoints can show
    // openings without joining the analyses row.
    if (result.opening_eco || result.opening_name) {
      db.prepare(`UPDATE games SET eco = ?, opening_name = ? WHERE id = ?`)
        .run(result.opening_eco, result.opening_name, game_id);
    }
    return result;
  })();

  inflight.set(user.id, work);
  try {
    const result = await work;
    return c.json({ analysis: result, cached: false });
  } finally {
    inflight.delete(user.id);
  }
});

function scoreFromResultForUser(result: string | null, color: 'white' | 'black'): 0 | 0.5 | 1 | null {
  if (!result) return null;
  if (result === 'win') return 1;
  if (result === 'loss') return 0;
  if (result === 'draw') return 0.5;
  // PGN-style result strings (1-0, 0-1, ½-½) — convert to player perspective.
  if (result === '1-0') return color === 'white' ? 1 : 0;
  if (result === '0-1') return color === 'black' ? 1 : 0;
  if (result === '1/2-1/2') return 0.5;
  return null;
}

interface PerformanceContext {
  score: 0 | 0.5 | 1 | null;
  userColor: 'white' | 'black';
  opponentRating: number | null;
  opponentRd: number | null;
}

// Backwards-compatible export: callers in ws/play.ts use this signature.
export async function analyzePgn(pgn: string, depth: number): Promise<AnalysisResult> {
  return analyzePgnFull(pgn, depth, {
    score: null,
    userColor: 'white',
    opponentRating: null,
    opponentRd: null,
  });
}

export async function analyzePgnFull(
  pgn: string,
  depth: number,
  perf: PerformanceContext,
): Promise<AnalysisResult> {
  const chess = new Chess();
  chess.loadPgn(pgn, { strict: false });
  const history = chess.history({ verbose: true });

  const engine = new StockfishEngine();
  await engine.start();
  await engine.setOption('Skill Level', 20);
  await engine.setOption('Threads', '2');
  await engine.setOption('Hash', '128');

  // Replay through positions
  const replay = new Chess();
  const moves: AnalyzedMove[] = [];

  // Pre-evaluate starting position with MultiPV=3 so we can detect "Great"
  // (only-good-move) and gap-aware "Brilliant" via the second-best candidate.
  let prevEval = await engine.evaluateMulti(replay.fen(), depth, 3);
  let prevWhiteCp = normalizeEval(prevEval.cp, prevEval.mate, replay.turn());

  // Per-side per-move accuracy + win-pct timeline for the new aggregator.
  const whitePoints: MoveAccPoint[] = [];
  const blackPoints: MoveAccPoint[] = [];
  let whiteCplSum = 0, whiteCplN = 0;
  let blackCplSum = 0, blackCplN = 0;

  // ECO-based book tracking. Once a position falls out of the bundled ECO map,
  // every subsequent ply is non-book even if it transposes back into a known
  // line (chess.com's behaviour — book ends as soon as you leave theory).
  let stillInBook = true;

  for (let i = 0; i < history.length; i++) {
    const move = history[i];
    if (!move) continue;
    const sideToMove: Color = replay.turn() === 'w' ? 'white' : 'black';
    const fenBefore = replay.fen();
    const bestUci = prevEval.bestMoveUci;

    let bestSan: string | null = null;
    if (bestUci) {
      const probe = new Chess(fenBefore);
      const m = probe.move({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), promotion: bestUci.slice(4) || undefined });
      if (m) bestSan = m.san;
    }

    const pvSan: string[] = [];
    if (prevEval.pv.length) {
      const pvProbe = new Chess(fenBefore);
      for (const u of prevEval.pv.slice(0, 6)) {
        const m = pvProbe.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.slice(4) || undefined });
        if (!m) break;
        pvSan.push(m.san);
      }
    }

    const legalMoveCount = new Chess(fenBefore).moves().length;

    const candidatePlayerCps: number[] = prevEval.candidates.map((cand) => {
      if (cand.mate !== null) return cand.mate > 0 ? 10000 - cand.mate * 10 : -10000 - cand.mate * 10;
      return cand.cp ?? 0;
    });

    replay.move({ from: move.from, to: move.to, promotion: move.promotion });
    const fenAfter = replay.fen();

    const nextEval = await engine.evaluateMulti(fenAfter, depth, 3);
    const nextWhiteCp = normalizeEval(nextEval.cp, nextEval.mate, replay.turn());

    const wpBefore = cpToWinPct(prevWhiteCp);
    const wpAfter = cpToWinPct(nextWhiteCp);

    const playerWinBefore = sideToMove === 'white' ? wpBefore : 100 - wpBefore;
    const playerWinAfter = sideToMove === 'white' ? wpAfter : 100 - wpAfter;
    // `acc` is recomputed below from wpDrop, which is mate-aware. Holding the
    // value here keeps the existing flow but the consumer uses the corrected
    // input.

    const playerEvalBeforeCp = sideToMove === 'white' ? prevWhiteCp : -prevWhiteCp;
    const playerEvalAfterCp = sideToMove === 'white' ? nextWhiteCp : -nextWhiteCp;
    const cpLoss = cpLossForPly(playerEvalBeforeCp, playerEvalAfterCp);
    // Mate-aware win-drop: a "+M3 → +M2" sequence is still mating, so the
    // 0.5% drift through the sigmoid shouldn't bleed into accuracy. Spec bug #4.
    const wpDrop = winDropForPly(playerEvalBeforeCp, playerEvalAfterCp, playerWinBefore, playerWinAfter);
    const isBest = bestUci === move.from + move.to + (move.promotion ?? '');
    const baseCls = classifyByWpDrop(wpDrop, cpLoss, isBest);

    // ECO-based book: probe the position BEFORE the played move against the
    // bundled map. Once we fall out, we stay out for the rest of the game.
    let inBookEpd = false;
    if (stillInBook) {
      const epdBefore = fenToEpd(fenBefore);
      if (lookupOpeningByEpd(epdBefore)) {
        inBookEpd = true;
      } else {
        stillInBook = false;
      }
    }
    // Safety ceiling — chess.com almost never tags book past ply 20.
    if ((i + 1) > 20) inBookEpd = false;

    const cls = refineClassification({
      base: baseCls,
      isBest,
      cpLoss,
      fenBefore,
      fenAfter,
      sideToMove,
      playerEvalBeforeCp,
      playerEvalAfterCp,
      ply: i + 1,
      legalMoveCount,
      candidatePlayerCps,
      pvAfterPlayed: nextEval.pv,
      inBook: inBookEpd,
    });

    const isBookMove = cls === 'book';
    const acc = moveAccuracy(playerWinBefore, playerWinBefore - wpDrop);
    const point: MoveAccPoint = { acc, winPct: playerWinAfter, isBook: isBookMove };
    if (sideToMove === 'white') {
      whitePoints.push(point);
      if (!isBookMove) { whiteCplSum += cpLoss; whiteCplN++; }
    } else {
      blackPoints.push(point);
      if (!isBookMove) { blackCplSum += cpLoss; blackCplN++; }
    }

    moves.push({
      ply: i + 1,
      san: move.san,
      uci: move.from + move.to + (move.promotion ?? ''),
      fen_before: fenBefore,
      fen_after: fenAfter,
      eval_before_cp: prevWhiteCp,
      eval_after_cp: nextWhiteCp,
      best_move_uci: bestUci,
      best_move_san: bestSan,
      best_pv: pvSan,
      centipawn_loss: cpLoss,
      classification: cls,
    });

    prevEval = nextEval;
    prevWhiteCp = nextWhiteCp;
  }

  await engine.quit();

  // CAPS-style game accuracy (volatility-weighted + harmonic mean).
  const accuracy_white = Math.round(gameAccuracy(whitePoints) * 10) / 10;
  const accuracy_black = Math.round(gameAccuracy(blackPoints) * 10) / 10;
  const acplWhite = whiteCplN ? whiteCplSum / whiteCplN : 0;
  const acplBlack = blackCplN ? blackCplSum / blackCplN : 0;

  const estimated_elo_white = whitePoints.length ? estimateElo(accuracy_white, acplWhite) : null;
  const estimated_elo_black = blackPoints.length ? estimateElo(accuracy_black, acplBlack) : null;

  // Per-game performance rating (chess.com Game Review "Your performance").
  // Only computed on the user's side when we know the score + opponent rating.
  let performance_white: number | null = null;
  let performance_black: number | null = null;
  if (perf.score !== null) {
    const userPerf = estimateGamePerformance({
      accuracy: perf.userColor === 'white' ? accuracy_white : accuracy_black,
      acpl: perf.userColor === 'white' ? acplWhite : acplBlack,
      opponentRating: perf.opponentRating,
      opponentRd: perf.opponentRd,
      score: perf.score,
    });
    if (perf.userColor === 'white') performance_white = userPerf;
    else performance_black = userPerf;
  }
  // Fallback for the side without a known opponent rating: own-strength estimate.
  if (performance_white === null && whitePoints.length) {
    performance_white = estimateGamePerformance({
      accuracy: accuracy_white, acpl: acplWhite,
      opponentRating: null, opponentRd: null, score: perf.score ?? 0.5,
    });
  }
  if (performance_black === null && blackPoints.length) {
    performance_black = estimateGamePerformance({
      accuracy: accuracy_black, acpl: acplBlack,
      opponentRating: null, opponentRd: null, score: perf.score ?? 0.5,
    });
  }

  const opening = lookupOpeningFromPgn(pgn);
  const phase_split = computePhaseSplit(moves, opening?.plies ?? 0);
  const km = extractKeyMoments(moves, 5);
  const key_moments: KeyMomentSummary[] = km.map((m) => ({
    ply: m.ply,
    side: m.side,
    san: m.san,
    fen_before: m.fen_before,
    classification: m.classification,
    cp_loss: m.cp_loss,
    win_pct_delta: m.win_pct_delta,
    best_san: m.best_san,
    best_pv: m.best_pv,
  }));

  return {
    depth,
    moves,
    accuracy_white,
    accuracy_black,
    estimated_elo_white,
    estimated_elo_black,
    performance_white,
    performance_black,
    opening_eco: opening?.eco ?? null,
    opening_name: opening?.name ?? null,
    key_moments,
    phase_split,
  };
}

// Phase split: opening = first N plies (ECO depth, fallback BOOK_PLIES);
// endgame = first ply where total non-pawn material ≤ 12 AND queens absent
// or material ≤ ~23 (roughly: a rook + minor on each side or less).
// Each phase gets per-side accuracy + ACPL. Phases shorter than 4 plies
// are returned as null (chess.com hides them).
function computePhaseSplit(moves: AnalyzedMove[], openingPlies: number): PhaseSplit {
  const totalPlies = moves.length;
  if (totalPlies === 0) {
    return { opening: null, middlegame: null, endgame: null };
  }
  const openingTo = Math.min(totalPlies, Math.max(BOOK_PLIES, openingPlies || BOOK_PLIES));

  // Find endgame start: first ply where non-pawn material totals ≤ 13 AND
  // either side has lost their queen (or both sides have ≤ 1 minor + rook).
  let endgameFrom = totalPlies + 1; // sentinel "no endgame"
  for (let i = 0; i < moves.length; i++) {
    const fen = moves[i]!.fen_after.split(' ')[0] ?? '';
    let whiteMin = 0, whiteRook = 0, whiteQueen = 0;
    let blackMin = 0, blackRook = 0, blackQueen = 0;
    for (const ch of fen) {
      if (ch === '/' || /\d/.test(ch)) continue;
      if (ch === 'N' || ch === 'B') whiteMin++;
      else if (ch === 'R') whiteRook++;
      else if (ch === 'Q') whiteQueen++;
      else if (ch === 'n' || ch === 'b') blackMin++;
      else if (ch === 'r') blackRook++;
      else if (ch === 'q') blackQueen++;
    }
    const nonPawnMaterial =
      (whiteMin * 3 + whiteRook * 5 + whiteQueen * 9) +
      (blackMin * 3 + blackRook * 5 + blackQueen * 9);
    const noQueens = whiteQueen === 0 && blackQueen === 0;
    if (nonPawnMaterial <= 26 && (noQueens || nonPawnMaterial <= 16)) {
      endgameFrom = i + 1;
      break;
    }
  }

  const middleFrom = openingTo + 1;
  const middleTo = Math.min(totalPlies, endgameFrom - 1);

  function summarize(fromPly: number, toPly: number) {
    if (fromPly > toPly) return null;
    const slice = moves.filter((m) => m.ply >= fromPly && m.ply <= toPly);
    if (slice.length < 4) return null;
    const wPoints: MoveAccPoint[] = [];
    const bPoints: MoveAccPoint[] = [];
    let wAcpl = 0, wN = 0, bAcpl = 0, bN = 0;
    for (const m of slice) {
      const isWhite = m.ply % 2 === 1;
      const isBook = m.classification === 'book';
      const wpBeforeWhite = cpToWinPct(m.eval_before_cp ?? 0);
      const wpAfterWhite = cpToWinPct(m.eval_after_cp ?? 0);
      const wpBefore = isWhite ? wpBeforeWhite : 100 - wpBeforeWhite;
      const wpAfter = isWhite ? wpAfterWhite : 100 - wpAfterWhite;
      // Mate-aware: skip the sigmoid drift on "+M3 → +M2" sequences.
      const playerEvalBefore = isWhite ? (m.eval_before_cp ?? 0) : -(m.eval_before_cp ?? 0);
      const playerEvalAfter = isWhite ? (m.eval_after_cp ?? 0) : -(m.eval_after_cp ?? 0);
      const wpDrop = winDropForPly(playerEvalBefore, playerEvalAfter, wpBefore, wpAfter);
      const acc = moveAccuracy(wpBefore, wpBefore - wpDrop);
      const point: MoveAccPoint = { acc, winPct: wpAfter, isBook };
      if (isWhite) {
        wPoints.push(point);
        if (!isBook) { wAcpl += m.centipawn_loss; wN++; }
      } else {
        bPoints.push(point);
        if (!isBook) { bAcpl += m.centipawn_loss; bN++; }
      }
    }
    return {
      from_ply: fromPly,
      to_ply: toPly,
      accuracy_white: Math.round(gameAccuracy(wPoints) * 10) / 10,
      accuracy_black: Math.round(gameAccuracy(bPoints) * 10) / 10,
      acpl_white: wN ? Math.round(wAcpl / wN) : 0,
      acpl_black: bN ? Math.round(bAcpl / bN) : 0,
    };
  }

  return {
    opening: summarize(1, openingTo),
    middlegame: summarize(middleFrom, middleTo),
    endgame: endgameFrom <= totalPlies ? summarize(endgameFrom, totalPlies) : null,
  };
}

export default router;
