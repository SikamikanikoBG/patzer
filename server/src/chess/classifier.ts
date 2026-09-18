import { Chess } from 'chess.js';
import type { Classification } from '../types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Scoring version. Bump when the classification thresholds, accuracy formula,
// or estimateElo curve changes — analyses cached at an older version will be
// silently re-run on next view.
//
// v9 — Brilliant was unreachable. The sacrifice test compared the player's
//   material before vs after *their own move*, which can never drop (only
//   captures change material, and you can't capture your own pieces). 4,482
//   classified moves on the reference DB, zero Brilliants. Now measured as the
//   material the opponent can win on the very next move, net of whatever the
//   played move captured (Bxf7+ = bishop hanging, pawn taken ⇒ net 2). The
//   PV replay recapture filter is unchanged; a PV in which the opponent
//   declines the capture counts as a sound sacrifice.
//
// v8 — calibrated against Hikaru April 2026 archive:
//   - Great tightened: gap threshold 150 → 200 cp, and the "near-best
//     (cpLoss ≤ 30) + only-good-move" pattern from v7 is removed entirely.
//     chess.com never tags Great unless the player picked engine #1, and we
//     were over-firing it (5 Greats per blitz game in benchmark game 2). Pure
//     #1-or-eval-flip now.
//   - Note: a parallel accuracy.ts softening was prototyped (volatility-weight
//     clamp) to fix single-blunder under-reading but introduced a +5 systemic
//     bias on multi-error games. Reverted — current MAE vs chess.com 5.32 on
//     the 10-game Hikaru benchmark, bias ~0.
//
// v7 — Brilliant replays engine PV 4 plies through chess.js (sacrifice must
//   survive recapture); cpLossForAcpl caps ACPL at 300.
// v6 — chess.com Game Review parity pass. See `.claude/specs/chess-math.md`.
// ─────────────────────────────────────────────────────────────────────────────
export const SCORING_VERSION = 9;

// Soft ceiling for ply-based book fallback when no ECO lookup is provided.
// With ECO-based detection (the analyzer passes `inBook` per ply), this is
// only a safety net. chess.com almost never tags "Book" past ply 20 even in
// deep theory; below 10 is too tight for normal play.
export const BOOK_PLIES = 12;

// Threshold above which a centipawn value is treated as a mate score (set by
// `mateToCp` to ±10000 ± 10·moves). Anything beyond this is "the engine sees
// mate", not a positional eval.
const MATE_CP_THRESHOLD = 9000;
function isMateCp(cp: number): boolean { return Math.abs(cp) >= MATE_CP_THRESHOLD; }

// Convert centipawn score (from white's perspective) to white's win percentage [0, 100].
// Lichess formula: winPct = 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)
export function cpToWinPct(cp: number): number {
  const v = 2 / (1 + Math.exp(-0.00368208 * cp)) - 1;
  return 50 + 50 * v;
}

// Lichess accuracy formula: 103.1668 * exp(-0.04354 * delta) - 3.1669
// where delta = winPctBefore - winPctAfter (from the player's perspective).
export function moveAccuracy(winBefore: number, winAfter: number): number {
  const delta = Math.max(0, winBefore - winAfter);
  const acc = 103.1668 * Math.exp(-0.04354 * delta) - 3.1669;
  return Math.max(0, Math.min(100, acc));
}

// chess.com-style move ladder by win-percentage drop. The thresholds match
// chess.com's published EP-loss ladder (0.02 / 0.05 / 0.10 / 0.20) when
// converted to Win%-drop in the central rating band:
//   isBest                            → best
//   < 2 wp drop  AND < 50 cpLoss      → excellent
//   < 5 wp drop  AND < 100 cpLoss     → good
//   < 10 wp drop                       → inaccuracy
//   < 20 wp drop                       → mistake
//   ≥ 20 wp drop                       → blunder
//
// cp-loss is kept as a *guard* so 0-cp-drop "best" moves in lopsided positions
// don't classify a 0.4-pawn deviation as Excellent. v5 used 30 / 60 — these
// were too tight for sharp middlegame positions where two top candidates sit
// within 30cp of each other. Loosened to 50 / 100 per spec §3.5 + §7.1.
export function classifyByWpDrop(winPctDrop: number, cpLoss: number, isBest: boolean): Classification {
  if (isBest) return 'best';
  if (winPctDrop < 2 && cpLoss < 50) return 'excellent';
  if (winPctDrop < 5 && cpLoss < 100) return 'good';
  if (winPctDrop < 10) return 'inaccuracy';
  if (winPctDrop < 20) return 'mistake';
  return 'blunder';
}

// Compute material totals (in pawn-equivalents) for both sides from a FEN.
// Excludes king (uncountable). Returns { white, black } scores.
export function materialFromFen(fen: string): { white: number; black: number } {
  const board = fen.split(' ')[0] ?? '';
  const values: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  let white = 0;
  let black = 0;
  for (const ch of board) {
    if (ch === '/' || /\d/.test(ch)) continue;
    const v = values[ch.toLowerCase()];
    if (!v) continue;
    if (ch === ch.toLowerCase()) black += v;
    else white += v;
  }
  return { white, black };
}

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function uciToMove(uci: string): { from: string; to: string; promotion?: string } {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined };
}

// Static exchange evaluation on one square: how much material does the side
// to move net by starting a capture sequence there, assuming both sides keep
// capturing with their least valuable attacker and either may stop when
// continuing would lose. Uses chess.js legal-move generation, so pins, checks
// and king safety are respected. Bounded by the number of attackers.
export function staticExchange(fen: string, square: string): number {
  let chess: Chess;
  try { chess = new Chess(fen); } catch { return 0; }
  const captures = chess.moves({ verbose: true }).filter((m) => m.to === square && m.captured);
  if (captures.length === 0) return 0;
  const attacker = captures.reduce((best, m) => (PIECE_VALUE[m.piece]! < PIECE_VALUE[best.piece]! ? m : best));
  const gain = PIECE_VALUE[attacker.captured!]!;
  chess.move(attacker);
  // The opponent may recapture (recursively) or decline; we may stop after our
  // capture, so the sequence value is never negative for the initiator.
  return Math.max(0, gain - staticExchange(chess.fen(), square));
}

// How much material (pawn-equivalents) did the played move put en prise, net of
// what it captured? Runs a static exchange on every square the opponent can
// capture on in the position after the move and takes the best one. A player's
// own move can never lower their own material, so this — not a before/after
// diff — is what a "sacrifice" looks like at the moment it is offered.
export function hangingMaterial(fenBefore: string, fenAfter: string, sideToMove: 'white' | 'black'): number {
  const matBefore = materialFromFen(fenBefore);
  const matAfter = materialFromFen(fenAfter);
  const oppBefore = sideToMove === 'white' ? matBefore.black : matBefore.white;
  const oppAfter = sideToMove === 'white' ? matAfter.black : matAfter.white;
  const gained = oppBefore - oppAfter; // what our move captured
  let biggest = 0;
  try {
    const targets = new Set(new Chess(fenAfter).moves({ verbose: true }).filter((m) => m.captured).map((m) => m.to));
    for (const sq of targets) biggest = Math.max(biggest, staticExchange(fenAfter, sq));
  } catch {
    return 0;
  }
  return biggest - gained;
}

// Does the engine's PV resolve into an equalising recapture sequence?
// Brilliant requires a *real* sacrifice — if the opponent's PV reply trades
// back, we replay 4 plies through chess.js and compare the end material
// balance to the pre-move balance. If we're back within 1 pawn, the sacrifice
// was illusory and the move should classify as Best, not Brilliant.
function isTrivialRecapture(args: {
  sideToMove: 'white' | 'black';
  fenBefore: string;            // FEN before the played move
  pv: string[];                 // engine PV from the position AFTER the played move, in UCI
  fenAfterPlayed: string;       // FEN after the played move (chess.js wants this)
}): boolean {
  // Compare material *balance* (ours minus theirs), not our own count: a
  // recapture restores the balance by lowering the opponent's material.
  const balance = (fen: string) => {
    const m = materialFromFen(fen);
    return args.sideToMove === 'white' ? m.white - m.black : m.black - m.white;
  };
  const balanceBefore = balance(args.fenBefore);

  // No PV, or the engine's reply is not a capture: the opponent declines the
  // offer, which is exactly what a sound sacrifice looks like. Not trivial.
  if (args.pv.length < 1) return false;
  try {
    const replay = new Chess(args.fenAfterPlayed);
    const reply = replay.move(uciToMove(args.pv[0]!));
    if (!reply.captured) return false;
    // Replay up to 3 more plies (our recapture, opponent's follow-up, our
    // second tempo) and re-check material.
    for (const uci of args.pv.slice(1, 4)) {
      replay.move(uciToMove(uci));
    }
    // Recovered to within 1 pawn of the starting balance ⇒ trivial trade, not a sac.
    return (balanceBefore - balance(replay.fen())) <= 1;
  } catch {
    return false;
  }
}

// After the basic classification, upgrade to Brilliant/Great or downgrade to
// Miss based on context. `playerEvalAfterCp` is from THIS player's perspective.
export function refineClassification(args: {
  base: Classification;
  isBest: boolean;
  cpLoss: number;
  fenBefore: string;
  fenAfter: string;
  sideToMove: 'white' | 'black';
  playerEvalBeforeCp: number;
  playerEvalAfterCp: number;
  ply: number;             // 1-based ply within the game
  legalMoveCount: number;  // # of legal moves in fenBefore (1 ⇒ Forced)
  // Top engine candidates from MultiPV (sorted best-first, player's perspective).
  // Index 0 is the engine's best move, index 1 the second-best, etc. Pass [] if
  // unavailable — Brilliant/Great rules will degrade gracefully.
  candidatePlayerCps: number[];
  // Engine PV from the position after the played move (in UCI), used for
  // trivial-recapture detection on Brilliant candidates.
  pvAfterPlayed?: string[];
  // ECO-based book detection. If provided and true, classify as `book`
  // unconditionally (subject to the "no book over a blunder" rule below).
  // If undefined, fall back to ply-based detection (`ply <= BOOK_PLIES`).
  inBook?: boolean;
}): Classification {
  const {
    base, isBest, cpLoss, fenBefore, fenAfter, sideToMove,
    playerEvalBeforeCp, playerEvalAfterCp,
    ply, legalMoveCount, candidatePlayerCps,
  } = args;

  // FORCED: only one legal move. Wins over every other label including `best`
  // because it isn't the player's *choice* — there's nothing else to play.
  if (legalMoveCount === 1) return 'forced';

  // BOOK: prefer ECO-based detection (passed in by the analyzer); fall back to
  // ply-based if the caller didn't compute it. In both cases an outright
  // blunder / mistake out of book stays as the actual classification — an
  // opening trap played wrong is not "book".
  const isBookPosition = args.inBook !== undefined
    ? args.inBook
    : ply <= BOOK_PLIES;
  const winDropApprox = base === 'blunder' || base === 'mistake';
  if (isBookPosition && !winDropApprox) return 'book';

  // BRILLIANT (chess.com rules + trivial-recapture filter):
  //   - engine's #1 choice
  //   - outside opening (ply > BOOK_PLIES, consistent with the book rule above)
  //   - player is NOT already crushing (eval ≤ +500cp before)
  //   - resulting position is not bad (eval ≥ −50cp after)
  //   - move leaves ≥ 2 pawns of material en prise, net of what it captured
  //     (i.e. ≥ a minor piece hangs, or a rook for a pawn, …)
  //   - cp_loss ≤ 20 (it's still the engine's #1, just sometimes ties with #2)
  //   - sacrifice is genuine — not a recapture sequence that nets to zero
  if (isBest && ply > BOOK_PLIES && playerEvalBeforeCp <= 500 && playerEvalAfterCp >= -50 && cpLoss <= 20) {
    const sacrificed = hangingMaterial(fenBefore, fenAfter, sideToMove);
    if (sacrificed >= 2) {
      const trivial = isTrivialRecapture({
        sideToMove,
        fenBefore,
        pv: args.pvAfterPlayed ?? [],
        fenAfterPlayed: fenAfter,
      });
      if (!trivial) return 'brilliant';
    }
  }

  // GREAT — chess.com's "critical only-good move". Two patterns (v8):
  //   1. ONLY-GOOD-MOVE (engine #1) — multipv #1 dominates #2 by ≥200cp.
  //   2. EVAL-FLIP — engine #1 move that lifts a losing position to equality
  //      (before ≤ -150cp, after ≥ -50cp). Resourceful-defence moves.
  // The v7 "near-best alt within 30cp" pattern is dropped — chess.com Great
  // requires the engine's literal #1, and that rule was firing too eagerly.
  if (ply > BOOK_PLIES) {
    if (isBest && candidatePlayerCps.length >= 2) {
      const top = candidatePlayerCps[0]!;
      const second = candidatePlayerCps[1]!;
      if (top - second >= 200) return 'great';
    }
    if (isBest && playerEvalBeforeCp <= -150 && playerEvalAfterCp >= -50) return 'great';
  }

  // MISS — two patterns:
  //   1. SQUANDERED-WIN: had a clearly winning eval (+150cp), no longer do.
  //   2. MATE-LINE MISS: engine saw mate before, no longer sees mate, and
  //      the move was at least an inaccuracy.
  const isAtLeastInaccuracy =
    base === 'inaccuracy' || base === 'mistake' || base === 'blunder';
  if (isAtLeastInaccuracy) {
    if (playerEvalBeforeCp >= 150 && playerEvalAfterCp < 50) return 'miss';
    if (isMateCp(playerEvalBeforeCp) && playerEvalBeforeCp > 0
        && !isMateCp(playerEvalAfterCp)) {
      return 'miss';
    }
  }

  return base;
}

export const CLASSIFICATION_ORDER: Classification[] = [
  'brilliant', 'great', 'best', 'excellent', 'good', 'book', 'forced', 'inaccuracy', 'mistake', 'blunder', 'miss',
];

// Convert mate score to a large centipawn equivalent for comparisons.
// Use ±10000 - 10*moves so closer mates dominate.
export function mateToCp(mate: number): number {
  if (mate > 0) return 10000 - mate * 10;
  return -10000 - mate * 10;
}

// Resolve an engine eval into a single white-perspective centipawn number.
// `sideToMove` is the side about to move in the position the eval was for.
export function normalizeEval(
  cp: number | null,
  mate: number | null,
  sideToMove: 'w' | 'b',
): number {
  let val: number;
  if (mate !== null) val = mateToCp(mate);
  else if (cp !== null) val = cp;
  else val = 0;
  return sideToMove === 'w' ? val : -val;
}

// Estimate playing strength from average centipawn loss (ACPL).
//
// v6 calibration (chess.com-aligned, per spec §4.1):
//   ACPL    8 → 2700  (super-GM rapid; Magnus 1-yr rapid ACPL ~12 → 2840 extrapolates)
//   ACPL   12 → 2500  (strong IM/GM rapid)
//   ACPL   18 → 2200  (NM / club master)
//   ACPL   25 → 1900  (Cramling-tier rapid, accuracy ~83)
//   ACPL   35 → 1600  (club rapid, accuracy ~80)
//   ACPL   50 → 1400
//   ACPL   70 → 1200
//   ACPL  100 →  900
//   ACPL  150 →  600
//   ACPL  250 →  400 (floor-ish)
//
// vs v5: this curve runs ~290 Elo higher at ACPL 5 (super-GM band was too cool)
// and ~150 Elo lower at ACPL 150 (weak band was too hot). See spec §4.1's diff
// table.
export function eloFromAcpl(acpl: number): number {
  const a = Math.max(0, acpl);
  let elo: number;
  if (a <= 8)        elo = 2900 - (a / 8) * 200;            // 2900 → 2700
  else if (a <= 12)  elo = 2700 - ((a - 8) / 4) * 200;      // 2700 → 2500
  else if (a <= 18)  elo = 2500 - ((a - 12) / 6) * 300;     // 2500 → 2200
  else if (a <= 25)  elo = 2200 - ((a - 18) / 7) * 300;     // 2200 → 1900
  else if (a <= 35)  elo = 1900 - ((a - 25) / 10) * 300;    // 1900 → 1600
  else if (a <= 50)  elo = 1600 - ((a - 35) / 15) * 200;    // 1600 → 1400
  else if (a <= 70)  elo = 1400 - ((a - 50) / 20) * 200;    // 1400 → 1200
  else if (a <= 100) elo = 1200 - ((a - 70) / 30) * 300;    // 1200 → 900
  else if (a <= 150) elo = 900  - ((a - 100) / 50) * 300;   //  900 → 600
  else if (a <= 250) elo = 600  - ((a - 150) / 100) * 200;  //  600 → 400
  else               elo = Math.max(300, 400 - (a - 250) * 0.4);
  return Math.round(Math.max(300, Math.min(2900, elo)));
}

// Public Elo estimator. ACPL drives the result; accuracy serves only as a
// tiebreaker at the margins (it's monotone in ACPL anyway, so over-weighting
// it doubles the same signal). v6 drops the accuracy nudge weight from 0.4 to
// 0.2 per spec §4.2 — the v5 weight was demonstrably noise on club games.
export function estimateElo(accuracy: number, avgCpl: number): number {
  const fromAcpl = eloFromAcpl(avgCpl);
  const accAdjust = Math.max(-100, Math.min(100, (accuracy - 75) * 10));
  return Math.round(Math.max(300, Math.min(2900, fromAcpl + accAdjust * 0.2)));
}

// Per-game performance rating, chess.com Game Review style. Blends the
// player's own strength signal (ACPL + accuracy) with an opponent-anchor that
// scales with confidence in the opponent's rating. A strong perf vs a 1800
// opponent means more than the same perf vs a 600.
//
// v6: opponent weight 0.4 → 0.35; accuracy nudge weight 0.4 → 0.2 (matches
// `estimateElo`); ±600 Elo clamp on the opp_perf minus own_strength delta —
// addresses chess.com's stated "harder to assess with a large rating gap"
// caveat so a 1500 destroying a 600 doesn't anchor down to 1200.
export function estimateGamePerformance(args: {
  accuracy: number;
  acpl: number;
  opponentRating: number | null;
  opponentRd: number | null;
  // 1 = win, 0.5 = draw, 0 = loss
  score: 0 | 0.5 | 1;
}): number {
  const { accuracy, acpl, opponentRating, opponentRd, score } = args;
  const fromAcpl = eloFromAcpl(acpl);
  const accNudge = Math.max(-100, Math.min(100, (accuracy - 75) * 10));
  const ownStrength = fromAcpl + 0.2 * accNudge;

  // Without a confident opponent rating, fall back to the own-strength estimate.
  if (opponentRating == null || !Number.isFinite(opponentRating)) {
    return Math.round(Math.max(300, Math.min(2900, ownStrength)));
  }
  // Confidence in the opponent rating shrinks as their RD grows.
  const rd = opponentRd ?? 350;
  const oppConf = Math.max(0, Math.min(1, (350 - rd) / 250));
  const result = score === 1 ? 200 : score === 0 ? -200 : 0;
  const oppPerf = opponentRating + result;
  // Clamp the gap between opp_perf and own_strength to ±600 — past that, the
  // blend is suspect (chess.com's "large rating gap" caveat).
  const delta = Math.max(-600, Math.min(600, oppPerf - ownStrength));
  const oppPerfClamped = ownStrength + delta;
  const blend = ownStrength * (1 - 0.35 * oppConf) + oppPerfClamped * (0.35 * oppConf);
  return Math.round(Math.max(300, Math.min(2900, blend)));
}

// Centipawn-loss reducer for a single ply. Mate-vs-mate transitions used to
// pollute ACPL by treating ±M3 → ∓M5 as a 1000-cp loss along a forced line —
// any game that ended in a mating attack tanked the loser's Elo. We now treat
// "still mating" / "still being mated" same-sign mate transitions as cp_loss=0.
// A flip from "I'm mating" → "I'm being mated" (sign change between mate scores)
// is still treated as a maximal loss so a real squander shows up.
export function cpLossForPly(playerEvalBeforeCp: number, playerEvalAfterCp: number): number {
  const beforeMate = isMateCp(playerEvalBeforeCp);
  const afterMate = isMateCp(playerEvalAfterCp);
  if (beforeMate && afterMate) {
    const sameSign = (playerEvalBeforeCp > 0) === (playerEvalAfterCp > 0);
    if (sameSign) return 0;
    return 1000;
  }
  return Math.min(1000, Math.max(0, playerEvalBeforeCp - playerEvalAfterCp));
}

// Centipawn-loss for ACPL aggregation. Same as `cpLossForPly` but capped at
// 300 instead of 1000 so a single mate-flip ply doesn't drag the player's
// average down by ~25 ACPL points (≈ 300-400 Elo) on an otherwise-clean game.
// chess.com applies a similar cap when aggregating ACPL.
export function cpLossForAcpl(playerEvalBeforeCp: number, playerEvalAfterCp: number): number {
  return Math.min(300, cpLossForPly(playerEvalBeforeCp, playerEvalAfterCp));
}

// Win-% drop for a single ply with the same mate-aware smoothing as
// `cpLossForPly`. Use this in the analyzer instead of the raw
// `playerWinBefore - playerWinAfter` so a "+M3 → +M2" sequence doesn't bleed
// 0.5% into the player's accuracy aggregator. Spec §7 bug #4.
export function winDropForPly(playerEvalBeforeCp: number, playerEvalAfterCp: number, winBefore: number, winAfter: number): number {
  const beforeMate = isMateCp(playerEvalBeforeCp);
  const afterMate = isMateCp(playerEvalAfterCp);
  if (beforeMate && afterMate) {
    const sameSign = (playerEvalBeforeCp > 0) === (playerEvalAfterCp > 0);
    if (sameSign) return 0;
    return 100;
  }
  return Math.max(0, winBefore - winAfter);
}
