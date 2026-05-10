// Insights v2 — the "Beyond Chess.com" analytics surface.
// Returns six aggregates so the frontend renders one fast page:
//   - activity_heatmap   year-of-games calendar
//   - rating_trajectory  per-time-class rating points
//   - opening_repertoire top openings × side with W/D/L + accuracy
//   - mistake_taxonomy   bucketed personal mistake patterns
//   - time_class_stats   per-time-class W/D/L + accuracy
//   - accuracy_trend     last-N-games accuracy series
//
// All templated (no LLM); fast page render.

import { Hono } from 'hono';
import { db } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { SCORING_VERSION } from '../chess/classifier.js';
import type { AnalyzedMove, GamePhase, PhaseSplit, Color } from '../types.js';

const router = new Hono();
router.use('*', requireAuth);

interface AnalysisRow {
  game_id: number;
  user_color: Color | null;
  end_time: string | null;
  result: string | null;
  time_class: string | null;
  eco: string | null;
  opening_name: string | null;
  moves_json: string;
  phase_split_json: string | null;
  accuracy_user: number | null;
}

router.get('/', (c) => {
  const me = c.get('user');
  const limit = Math.min(Number(c.req.query('limit') ?? 200), 500);

  // Activity heatmap — last 365 days. Aggregated server-side so the wire
  // payload is at most ~365 rows even on heavy users.
  interface DayRow { day: string; games: number; wins: number }
  const heatmap = db.prepare(`
    SELECT substr(end_time, 1, 10) AS day,
           COUNT(*) AS games,
           SUM(CASE WHEN result='win' THEN 1 ELSE 0 END) AS wins
    FROM games
    WHERE user_id = ? AND end_time IS NOT NULL
      AND end_time >= datetime('now','-365 days')
    GROUP BY day
    ORDER BY day ASC
  `).all(me.id) as DayRow[];

  // Rating trajectory — per time_class series of (date, rating_after).
  interface TrajRow { time_class: string; created_at: string; rating_after: number }
  const trajRows = db.prepare(`
    SELECT time_class, created_at, rating_after
    FROM rating_history
    WHERE user_id = ?
    ORDER BY created_at ASC
  `).all(me.id) as TrajRow[];
  const trajectory: Record<string, { t: string; r: number }[]> = { bullet: [], blitz: [], rapid: [], daily: [] };
  for (const r of trajRows) {
    const arr = trajectory[r.time_class];
    if (arr) arr.push({ t: r.created_at, r: Math.round(r.rating_after) });
  }

  // Per-time-class W/D/L + average accuracy from analyses (player's side).
  interface TcRow {
    time_class: string | null;
    wins: number; draws: number; losses: number; total: number;
    avg_acc: number | null;
  }
  const tcRows = db.prepare(`
    SELECT g.time_class,
           SUM(CASE WHEN g.result='win' THEN 1 ELSE 0 END) AS wins,
           SUM(CASE WHEN g.result='draw' THEN 1 ELSE 0 END) AS draws,
           SUM(CASE WHEN g.result='loss' THEN 1 ELSE 0 END) AS losses,
           COUNT(*) AS total,
           AVG(CASE WHEN g.user_color='white' AND a.scoring_version >= ? THEN a.accuracy_white
                    WHEN g.user_color='black' AND a.scoring_version >= ? THEN a.accuracy_black
                    ELSE NULL END) AS avg_acc
    FROM games g LEFT JOIN analyses a ON a.game_id = g.id
    WHERE g.user_id = ? AND g.result IS NOT NULL
    GROUP BY g.time_class
  `).all(SCORING_VERSION, SCORING_VERSION, me.id) as TcRow[];
  const time_class_stats: Record<string, { games: number; wins: number; draws: number; losses: number; avg_accuracy: number | null }> = {};
  for (const r of tcRows) {
    const k = r.time_class ?? 'other';
    time_class_stats[k] = {
      games: r.total,
      wins: r.wins,
      draws: r.draws,
      losses: r.losses,
      avg_accuracy: r.avg_acc != null ? Math.round(r.avg_acc * 10) / 10 : null,
    };
  }

  // Pull the most recent analyzed games for taxonomy + opening repertoire.
  // SCORING_VERSION gate so old analyses don't bleed v5 numbers in.
  const rows = db.prepare(`
    SELECT a.game_id, g.user_color, g.end_time, g.result, g.time_class,
           g.eco, g.opening_name, a.moves_json, a.phase_split_json,
           CASE WHEN g.user_color='white' THEN a.accuracy_white ELSE a.accuracy_black END AS accuracy_user
    FROM analyses a JOIN games g ON g.id = a.game_id
    WHERE g.user_id = ? AND a.scoring_version >= ?
    ORDER BY g.end_time DESC, g.id DESC
    LIMIT ?
  `).all(me.id, SCORING_VERSION, limit) as AnalysisRow[];

  // Taxonomy buckets — every bucket counts user-side moves only.
  const tax = {
    hung_pieces: 0,
    back_rank: 0,
    missed_mate: 0,
    opening_pitfalls: 0,
    endgame_drift: 0,
    one_move_blunders: 0,
    promising_to_losing: 0,
  };

  // Opening repertoire — keyed by `${color}|${eco}`.
  interface OpEntry { eco: string; name: string; color: Color; played: number; wins: number; draws: number; losses: number; acc_sum: number; acc_n: number }
  const ops = new Map<string, OpEntry>();

  // Phase accuracy avg over the user's side
  const phaseAcc: Record<GamePhase, { sum: number; n: number }> = {
    opening: { sum: 0, n: 0 }, middlegame: { sum: 0, n: 0 }, endgame: { sum: 0, n: 0 },
  };

  // Accuracy trend — most recent N games (ascending for the chart)
  const accTrend: { t: string; acc: number; result: string | null }[] = [];

  for (const r of rows) {
    const userColor: Color = r.user_color ?? 'white';
    const moves = JSON.parse(r.moves_json) as AnalyzedMove[];
    const split = r.phase_split_json ? (JSON.parse(r.phase_split_json) as PhaseSplit) : null;

    if (split?.opening) {
      const acc = userColor === 'white' ? split.opening.accuracy_white : split.opening.accuracy_black;
      phaseAcc.opening.sum += acc; phaseAcc.opening.n++;
    }
    if (split?.middlegame) {
      const acc = userColor === 'white' ? split.middlegame.accuracy_white : split.middlegame.accuracy_black;
      phaseAcc.middlegame.sum += acc; phaseAcc.middlegame.n++;
    }
    if (split?.endgame) {
      const acc = userColor === 'white' ? split.endgame.accuracy_white : split.endgame.accuracy_black;
      phaseAcc.endgame.sum += acc; phaseAcc.endgame.n++;
    }

    if (r.accuracy_user != null && r.end_time) {
      accTrend.push({ t: r.end_time, acc: r.accuracy_user, result: r.result });
    }

    // Opening repertoire
    if (r.eco) {
      const key = `${userColor}|${r.eco}`;
      let e = ops.get(key);
      if (!e) {
        e = { eco: r.eco, name: r.opening_name ?? r.eco, color: userColor, played: 0, wins: 0, draws: 0, losses: 0, acc_sum: 0, acc_n: 0 };
        ops.set(key, e);
      }
      e.played++;
      if (r.result === 'win') e.wins++;
      else if (r.result === 'draw') e.draws++;
      else if (r.result === 'loss') e.losses++;
      if (r.accuracy_user != null) { e.acc_sum += r.accuracy_user; e.acc_n++; }
    }

    // Per-move taxonomy
    let userBlundersThisGame = 0;
    for (const m of moves) {
      const side: Color = m.ply % 2 === 1 ? 'white' : 'black';
      if (side !== userColor) continue;
      const phase = phaseFor(m.ply, split);
      if (m.classification === 'blunder' || m.classification === 'mistake') {
        if (m.centipawn_loss >= 200) tax.hung_pieces++;
        if (m.classification === 'blunder' && hasBackRankSignature(m.fen_after, userColor)) tax.back_rank++;
        if (phase === 'opening') tax.opening_pitfalls++;
        if (phase === 'endgame') tax.endgame_drift++;
        if (m.classification === 'blunder') {
          userBlundersThisGame++;
          // "One-move blunder": cp_loss ≥ 300 and prior eval was at most slightly worse.
          if (m.centipawn_loss >= 300 && (m.eval_before_cp != null) && Math.abs(m.eval_before_cp) < 200) {
            tax.one_move_blunders++;
          }
        }
      }
      if (m.classification === 'miss') {
        // chess.com defines Miss as "you had a winning shot and didn't take it";
        // surface separately as missed-mate-or-win.
        tax.missed_mate++;
      }
      // Promising → losing flip: prior eval ≥ +150 (from user POV), now ≤ +50.
      if (m.eval_before_cp != null && m.eval_after_cp != null) {
        const sign = userColor === 'white' ? 1 : -1;
        const before = m.eval_before_cp * sign;
        const after = m.eval_after_cp * sign;
        if (before >= 150 && after <= 50) tax.promising_to_losing++;
      }
    }
    void userBlundersThisGame;
  }

  // Top openings: sort by `played` desc, keep top 10
  const opening_repertoire = Array.from(ops.values())
    .sort((a, b) => b.played - a.played)
    .slice(0, 10)
    .map((e) => ({
      eco: e.eco, name: e.name, color: e.color, played: e.played,
      wins: e.wins, draws: e.draws, losses: e.losses,
      avg_accuracy: e.acc_n > 0 ? Math.round((e.acc_sum / e.acc_n) * 10) / 10 : null,
    }));

  return c.json({
    games_analyzed: rows.length,
    activity_heatmap: heatmap,
    rating_trajectory: trajectory,
    time_class_stats,
    opening_repertoire,
    mistake_taxonomy: tax,
    phase_accuracy: {
      opening: phaseAcc.opening.n ? Math.round((phaseAcc.opening.sum / phaseAcc.opening.n) * 10) / 10 : 0,
      middlegame: phaseAcc.middlegame.n ? Math.round((phaseAcc.middlegame.sum / phaseAcc.middlegame.n) * 10) / 10 : 0,
      endgame: phaseAcc.endgame.n ? Math.round((phaseAcc.endgame.sum / phaseAcc.endgame.n) * 10) / 10 : 0,
    },
    accuracy_trend: accTrend.slice(0, 50).reverse(),
  });
});

function phaseFor(ply: number, split: PhaseSplit | null): GamePhase {
  if (!split) return ply <= 14 ? 'opening' : ply <= 40 ? 'middlegame' : 'endgame';
  if (split.opening && ply >= split.opening.from_ply && ply <= split.opening.to_ply) return 'opening';
  if (split.endgame && ply >= split.endgame.from_ply && ply <= split.endgame.to_ply) return 'endgame';
  return 'middlegame';
}

function hasBackRankSignature(fen: string, userColor: Color): boolean {
  const board = fen.split(' ')[0] ?? '';
  const ranks = board.split('/');
  const backRank = userColor === 'white' ? ranks[7] : ranks[0];
  if (!backRank) return false;
  const target = userColor === 'white' ? 'K' : 'k';
  if (!backRank.includes(target)) return false;
  let nonKing = 0;
  for (const ch of backRank) {
    if (/\d/.test(ch)) continue;
    if (ch !== target && ((userColor === 'white' && ch === ch.toUpperCase()) || (userColor === 'black' && ch === ch.toLowerCase()))) {
      nonKing++;
    }
  }
  return nonKing === 0;
}

export default router;
