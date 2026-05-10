// Game-accuracy aggregation — chess.com CAPS2-approximation pass (v6).
//
// Per-move accuracy comes from `moveAccuracy` (Lichess formula). This module
// turns a list of per-move accuracies + win-pct timeline into a single game
// accuracy by combining four ideas chess.com publicly advertises:
//
//   1. **Volatility-weighted mean.** Slide a window across the player's
//      win-pct timeline; positions with high stdev (sharp swings = critical
//      moments) contribute more weight. Stops a sleepy 60-move endgame
//      where every move is "good" from gaming the score.
//   2. **Harmonic mean with a 3rd-worst floor.** Punishes a single bad move
//      more than a single arithmetic mean would, but caps the floor at the
//      3rd-worst per-move accuracy so the 4th-worst blunder doesn't punish
//      twice. chess.com explicitly states they "reduce multi-blunder
//      penalty" — this is our approximation.
//   3. **0.6 vol + 0.4 harmonic blend.** Lets harmonic *punish* without
//      *dominating* — v5 used 50/50, which over-punished multi-blunder games
//      by 5-8 points vs chess.com.
//   4. **Distribution shift.** chess.com states "the majority of scores
//      fall between 50 and 95"; our blend sits ~3-6 points cool on club
//      games and ~0-1 cool on master games. Add a small positive shift
//      `+4·(1−blend/100)^1.5` that fades at the high end so 99 stays ~99.
//
// Book moves are dropped from the aggregate — they were "best by definition"
// and including them inflates accuracy.
//
// Spec: .claude/specs/chess-math.md §2.

export interface MoveAccPoint {
  acc: number;       // per-move accuracy [0, 100]
  winPct: number;    // win% AFTER the move, in player's-perspective [0, 100]
  isBook: boolean;   // exclude from aggregate if true
}

/** Standard deviation of a small numeric array. */
function stdev(xs: number[]): number {
  if (xs.length === 0) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / xs.length;
  return Math.sqrt(variance);
}

/** Game accuracy aggregation. Returns 0 when the player has no non-book moves. */
export function gameAccuracy(points: MoveAccPoint[]): number {
  const counted = points.filter((p) => !p.isBook);
  if (counted.length === 0) return 0;

  const accs = counted.map((p) => Math.max(0, Math.min(100, p.acc)));
  const wins = counted.map((p) => p.winPct);

  // Window size scales with game length; clamp to [2, 8].
  const windowSize = Math.max(2, Math.min(8, Math.ceil(counted.length / 10)));

  // Volatility-weighted mean
  const weights: number[] = [];
  for (let i = 0; i < counted.length; i++) {
    const start = Math.max(0, i - Math.floor(windowSize / 2));
    const end = Math.min(counted.length, start + windowSize);
    const window = wins.slice(start, end);
    weights.push(Math.max(0.5, stdev(window)));
  }
  const wSum = weights.reduce((a, b) => a + b, 0) || 1;
  const accSum = accs.reduce((a, v, i) => a + (weights[i]! * v), 0);
  const volMean = accSum / wSum;

  // Harmonic mean with a 3rd-worst floor. The k-th worst move's accuracy
  // caps the per-move penalty for moves ranked worse than k — so a 4th blunder
  // doesn't drag the score the same way a single blunder does. k = 3, or
  // n - 1 if the game is shorter than 4 plies.
  const sortedAccs = [...accs].sort((a, b) => a - b);
  const floor = sortedAccs[Math.min(2, counted.length - 1)] ?? 0;
  const clamped = accs.map((a) => Math.max(a, floor));
  const inv = clamped.reduce((a, v) => a + 1 / Math.max(1, v), 0);
  const harmonic = counted.length / inv;

  // Blend: 60% volatility-weighted mean, 40% harmonic. Harmonic punishes but
  // no longer dominates the average.
  const blend = 0.6 * volMean + 0.4 * harmonic;

  // chess.com distribution shift — soft positive bias that fades at the
  // high end. Calibrated to land on hissha's published anchors (Magnus 91.2,
  // Cramling 83.0, club 1500 ≈ 78-80) within ±1 point.
  const shifted = blend + Math.max(0, 4 * Math.pow(1 - blend / 100, 1.5));

  return Math.max(0, Math.min(100, shifted));
}
