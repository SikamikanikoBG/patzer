import { describe, it, expect } from 'vitest';
import {
  cpToWinPct, moveAccuracy, classifyByWpDrop, materialFromFen, refineClassification,
  mateToCp, normalizeEval, eloFromAcpl, estimateElo, estimateGamePerformance,
  cpLossForPly, cpLossForAcpl, winDropForPly, BOOK_PLIES, hangingMaterial, staticExchange,
} from '../src/chess/classifier.js';
import { Chess } from 'chess.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('cpToWinPct (Lichess sigmoid)', () => {
  it('is 50% at equality and symmetric around it', () => {
    expect(cpToWinPct(0)).toBeCloseTo(50, 10);
    expect(cpToWinPct(100) + cpToWinPct(-100)).toBeCloseTo(100, 10);
    expect(cpToWinPct(300) + cpToWinPct(-300)).toBeCloseTo(100, 10);
  });
  it('matches known Lichess anchor points', () => {
    // +100cp ≈ 59.1%, +300cp ≈ 75.1%, +1000cp ≈ 97.5%
    expect(cpToWinPct(100)).toBeCloseTo(59.1, 0);
    expect(cpToWinPct(300)).toBeCloseTo(75.1, 0);
    expect(cpToWinPct(1000)).toBeCloseTo(97.5, 0);
  });
  it('is monotone and bounded in [0, 100]', () => {
    let prev = -1;
    for (let cp = -20000; cp <= 20000; cp += 250) {
      const w = cpToWinPct(cp);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(100);
      expect(w).toBeGreaterThanOrEqual(prev);
      prev = w;
    }
  });
});

describe('moveAccuracy (Lichess formula)', () => {
  it('tops out at 103.1668 - 3.1669 when the move loses nothing', () => {
    expect(moveAccuracy(60, 60)).toBeCloseTo(99.9999, 4);
    expect(moveAccuracy(60, 70)).toBeCloseTo(99.9999, 4); // gaining win% is treated as no loss
  });
  it('decays with the win-% drop and never goes negative', () => {
    expect(moveAccuracy(60, 55)).toBeCloseTo(103.1668 * Math.exp(-0.04354 * 5) - 3.1669, 6);
    expect(moveAccuracy(60, 50)).toBeLessThan(moveAccuracy(60, 55));
    expect(moveAccuracy(100, 0)).toBe(0);
  });
});

describe('classifyByWpDrop ladder', () => {
  it('follows the documented thresholds', () => {
    expect(classifyByWpDrop(30, 500, true)).toBe('best'); // isBest wins regardless
    expect(classifyByWpDrop(1, 10, false)).toBe('excellent');
    expect(classifyByWpDrop(1, 60, false)).toBe('good'); // cp guard demotes
    expect(classifyByWpDrop(4, 90, false)).toBe('good');
    expect(classifyByWpDrop(4, 150, false)).toBe('inaccuracy'); // cp guard demotes
    expect(classifyByWpDrop(9.9, 0, false)).toBe('inaccuracy');
    expect(classifyByWpDrop(10, 0, false)).toBe('mistake');
    expect(classifyByWpDrop(19.9, 0, false)).toBe('mistake');
    expect(classifyByWpDrop(20, 0, false)).toBe('blunder');
    expect(classifyByWpDrop(80, 1000, false)).toBe('blunder');
  });
});

describe('materialFromFen', () => {
  it('counts pawn-equivalents per side, ignoring kings', () => {
    expect(materialFromFen(START)).toEqual({ white: 39, black: 39 });
    expect(materialFromFen('4k3/8/8/8/8/8/8/4K2R w K - 0 1')).toEqual({ white: 5, black: 0 });
    expect(materialFromFen('r3k3/8/8/8/8/8/8/4KQ2 w q - 0 1')).toEqual({ white: 9, black: 5 });
  });
});

describe('refineClassification', () => {
  const base = {
    base: 'good' as const, isBest: false, cpLoss: 20, fenBefore: START, fenAfter: START,
    sideToMove: 'white' as const, playerEvalBeforeCp: 0, playerEvalAfterCp: 0,
    ply: 30, legalMoveCount: 20, candidatePlayerCps: [] as number[],
  };
  it('forced beats everything', () => {
    expect(refineClassification({ ...base, legalMoveCount: 1, base: 'blunder' })).toBe('forced');
  });
  it('book via ECO flag, but never over a mistake/blunder', () => {
    expect(refineClassification({ ...base, inBook: true })).toBe('book');
    expect(refineClassification({ ...base, inBook: true, base: 'blunder' })).toBe('blunder');
    expect(refineClassification({ ...base, inBook: true, base: 'mistake' })).toBe('mistake');
    expect(refineClassification({ ...base, inBook: false, ply: 2 })).toBe('good');
  });
  it('falls back to ply-based book when inBook is undefined', () => {
    expect(refineClassification({ ...base, ply: BOOK_PLIES })).toBe('book');
    expect(refineClassification({ ...base, ply: BOOK_PLIES + 1 })).toBe('good');
  });
  it('great: only-good-move when #1 dominates #2 by 200cp', () => {
    expect(refineClassification({ ...base, base: 'best', isBest: true, candidatePlayerCps: [150, -60] })).toBe('great');
    expect(refineClassification({ ...base, base: 'best', isBest: true, candidatePlayerCps: [150, 0] })).toBe('best');
  });
  it('great: eval-flip from losing to equal', () => {
    expect(refineClassification({ ...base, base: 'best', isBest: true, playerEvalBeforeCp: -200, playerEvalAfterCp: -20 })).toBe('great');
  });
  it('miss: squandered win and lost mate line', () => {
    expect(refineClassification({ ...base, base: 'inaccuracy', playerEvalBeforeCp: 200, playerEvalAfterCp: 30 })).toBe('miss');
    expect(refineClassification({ ...base, base: 'mistake', playerEvalBeforeCp: mateToCp(3), playerEvalAfterCp: 400 })).toBe('miss');
    // Not at least an inaccuracy → stays as-is
    expect(refineClassification({ ...base, base: 'good', playerEvalBeforeCp: 200, playerEvalAfterCp: 30 })).toBe('good');
  });

  // Brilliant needs real positions: the sacrifice is measured as what the
  // opponent can capture after the move, so we build FENs with chess.js.
  function play(moves: string[]): { fenBefore: string; fenAfter: string } {
    const c = new Chess();
    for (const m of moves.slice(0, -1)) c.move(m);
    const fenBefore = c.fen();
    c.move(moves[moves.length - 1]!);
    return { fenBefore, fenAfter: c.fen() };
  }
  const brilliantArgs = { ...base, base: 'best' as const, isBest: true, cpLoss: 0, ply: 20, inBook: false };

  it('staticExchange: defended pieces are not en prise, undefended ones are', () => {
    // Knight on f3 defended by the g2 pawn, attacked by a bishop from g4: Bxf3 gxf3 → 0 for Black.
    const c = new Chess();
    for (const m of ['e4', 'e5', 'Nf3', 'd6', 'Bc4', 'Bg4']) c.move(m);
    c.move('a3'); // hand the move to Black
    expect(staticExchange(c.fen(), 'f3')).toBe(0);
    // Undefended knight: 1.e4 e5 2.Nf3 Nc6 3.Nxe5 — Nxe5 wins 3 for Black outright.
    const g = play(['e4', 'e5', 'Nf3', 'Nc6', 'Nxe5']);
    expect(staticExchange(g.fenAfter, 'e5')).toBe(3);
    // Pawn takes a knight defended by a pawn: still nets 3 - 1 = 2 for the attacker.
    const d = play(['e4', 'e5', 'Nf3', 'd6', 'd4', 'Nc6', 'd5', 'Nb4', 'Nxe5']); // Ne5 defended by nothing but d6 attacks it
    expect(staticExchange(d.fenAfter, 'e5')).toBeGreaterThanOrEqual(2);
    // No capture available on the square → 0
    expect(staticExchange(g.fenAfter, 'a1')).toBe(0);
  });

  it('hangingMaterial: what the opponent can win next move, net of what we took', () => {
    // A defended knight is not hanging: 1.e4 e5 2.Nf3 Nc6 3.Nc3 Nf6 4.d3 — nothing en prise
    const q2 = play(['e4', 'e5', 'Nf3', 'Nc6', 'Nc3', 'Nf6', 'd3']);
    expect(hangingMaterial(q2.fenBefore, q2.fenAfter, 'white')).toBe(0);
    // 6.Nxf7 in the Fried Liver: knight (3) hangs to Kxf7, we took a pawn (1) → 2
    const fl = play(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5', 'd5', 'exd5', 'Nxd5', 'Nxf7']);
    expect(hangingMaterial(fl.fenBefore, fl.fenAfter, 'white')).toBe(2);
    // Quiet developing move, nothing en prise → 0
    const q = play(['e4', 'e5', 'Nf3']);
    expect(hangingMaterial(q.fenBefore, q.fenAfter, 'white')).toBe(0);
    // Bxc6 in the Ruy Lopez: took a knight (3), bishop (3) hangs → 0, an exchange not a sac
    const rl = play(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6']);
    expect(hangingMaterial(rl.fenBefore, rl.fenAfter, 'white')).toBe(0);
    // Works from Black's side too: ...Nxe4 after 1.e4 e5 2.Nf3 Nf6 3.Nxe5 Nxe4 — knight hangs to nothing here
    const bl = play(['e4', 'e5', 'Nf3', 'Nf6', 'Nxe5', 'Nxe4']);
    expect(hangingMaterial(bl.fenBefore, bl.fenAfter, 'black')).toBeLessThan(2);
  });

  it('brilliant: a genuine piece sacrifice the engine PV does not win back', () => {
    // 3.Nxe5?! dxe5: PV where White never recovers the material.
    const g = play(['e4', 'e5', 'Nf3', 'd6', 'Nxe5']);
    const r = refineClassification({ ...brilliantArgs, ...g, pvAfterPlayed: ['d6e5', 'd2d3', 'b8c6', 'c2c3'] });
    expect(r).toBe('brilliant');
    // Opponent declines the capture in the PV → the sacrifice stands → brilliant
    expect(refineClassification({ ...brilliantArgs, ...g, pvAfterPlayed: ['f8e7', 'd2d4'] })).toBe('brilliant');
    // No PV at all → cannot prove it is trivial → brilliant
    expect(refineClassification({ ...brilliantArgs, ...g, pvAfterPlayed: [] })).toBe('brilliant');
  });

  it('brilliant is denied when the PV wins the material straight back', () => {
    // 3.Nxe5 dxe5 4.Qh5 Nc6 5.Qxe5+: down a knight for two pawns → within 1 → trivial
    const g = play(['e4', 'e5', 'Nf3', 'd6', 'Nxe5']);
    expect(refineClassification({ ...brilliantArgs, ...g, pvAfterPlayed: ['d6e5', 'd1h5', 'b8c6', 'h5e5'] })).toBe('best');
  });

  it('brilliant is denied for an even exchange and for quiet moves', () => {
    const rl = play(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6']);
    expect(refineClassification({ ...brilliantArgs, ...rl, pvAfterPlayed: ['d7c6'] })).toBe('best');
    const q = play(['e4', 'e5', 'Nf3']);
    expect(refineClassification({ ...brilliantArgs, ...q })).toBe('best');
  });

  it('brilliant is denied inside book, when already crushing, when the position goes bad, or off the engine #1', () => {
    const g = play(['e4', 'e5', 'Nf3', 'd6', 'Nxe5']);
    const args = { ...brilliantArgs, ...g, pvAfterPlayed: ['d6e5', 'd2d3'] };
    expect(refineClassification({ ...args, ply: 5 })).toBe('best');
    expect(refineClassification({ ...args, playerEvalBeforeCp: 800 })).toBe('best');
    expect(refineClassification({ ...args, playerEvalAfterCp: -100 })).toBe('best');
    expect(refineClassification({ ...args, cpLoss: 40 })).toBe('best');
    expect(refineClassification({ ...args, isBest: false, base: 'good' })).toBe('good');
  });
});

describe('mate handling', () => {
  it('mateToCp: closer mates dominate', () => {
    expect(mateToCp(1)).toBeGreaterThan(mateToCp(5));
    expect(mateToCp(-1)).toBeLessThan(mateToCp(-5));
    expect(mateToCp(1)).toBe(9990);
    expect(mateToCp(-1)).toBe(-9990);
  });
  it('normalizeEval flips to white perspective', () => {
    expect(normalizeEval(50, null, 'w')).toBe(50);
    expect(normalizeEval(50, null, 'b')).toBe(-50);
    expect(normalizeEval(null, 2, 'b')).toBe(-mateToCp(2));
    expect(normalizeEval(null, null, 'w')).toBe(0);
  });
  it('cpLossForPly: same-sign mate transitions are free, flips are maximal', () => {
    expect(cpLossForPly(mateToCp(3), mateToCp(5))).toBe(0);
    expect(cpLossForPly(mateToCp(-3), mateToCp(-2))).toBe(0);
    expect(cpLossForPly(mateToCp(3), mateToCp(-3))).toBe(1000);
    expect(cpLossForPly(100, 40)).toBe(60);
    expect(cpLossForPly(40, 100)).toBe(0);
    expect(cpLossForPly(5000, 0)).toBe(1000);
  });
  it('cpLossForAcpl caps at 300', () => {
    expect(cpLossForAcpl(mateToCp(3), mateToCp(-3))).toBe(300);
    expect(cpLossForAcpl(100, 40)).toBe(60);
  });
  it('winDropForPly mirrors the mate smoothing', () => {
    expect(winDropForPly(mateToCp(3), mateToCp(5), 99.9, 99.8)).toBe(0);
    expect(winDropForPly(mateToCp(3), mateToCp(-3), 99.9, 0.1)).toBe(100);
    expect(winDropForPly(100, 40, 59, 55)).toBe(4);
  });
});

describe('Elo estimation', () => {
  it('eloFromAcpl hits the calibration anchors', () => {
    expect(eloFromAcpl(8)).toBe(2700);
    expect(eloFromAcpl(12)).toBe(2500);
    expect(eloFromAcpl(18)).toBe(2200);
    expect(eloFromAcpl(25)).toBe(1900);
    expect(eloFromAcpl(35)).toBe(1600);
    expect(eloFromAcpl(50)).toBe(1400);
    expect(eloFromAcpl(70)).toBe(1200);
    expect(eloFromAcpl(100)).toBe(900);
    expect(eloFromAcpl(150)).toBe(600);
    expect(eloFromAcpl(250)).toBe(400);
  });
  it('eloFromAcpl is monotone non-increasing and clamped', () => {
    let prev = Infinity;
    for (let a = 0; a <= 1000; a += 1) {
      const e = eloFromAcpl(a);
      expect(e).toBeLessThanOrEqual(prev);
      expect(e).toBeGreaterThanOrEqual(300);
      expect(e).toBeLessThanOrEqual(2900);
      prev = e;
    }
    expect(eloFromAcpl(-50)).toBe(2900);
  });
  it('estimateElo nudges by accuracy within ±20', () => {
    expect(estimateElo(75, 35)).toBe(1600);
    expect(estimateElo(95, 35)).toBe(1620);
    expect(estimateElo(55, 35)).toBe(1580);
    expect(estimateElo(100, 35)).toBe(1620); // clamp on the nudge
  });
  it('estimateGamePerformance: no opponent → own strength', () => {
    expect(estimateGamePerformance({ accuracy: 75, acpl: 35, opponentRating: null, opponentRd: null, score: 1 })).toBe(1600);
  });
  it('estimateGamePerformance: confident opponent pulls toward opp ± 200', () => {
    const win = estimateGamePerformance({ accuracy: 75, acpl: 35, opponentRating: 1800, opponentRd: 50, score: 1 });
    const loss = estimateGamePerformance({ accuracy: 75, acpl: 35, opponentRating: 1800, opponentRd: 50, score: 0 });
    expect(win).toBeGreaterThan(loss);
    // oppConf = (350-50)/250 = 1 (clamped) → blend = 0.65*1600 + 0.35*2000 = 1740
    expect(win).toBe(1740);
    // An RD-350 opponent carries zero confidence → pure own strength.
    expect(estimateGamePerformance({ accuracy: 75, acpl: 35, opponentRating: 2800, opponentRd: 350, score: 1 })).toBe(1600);
  });
  it('estimateGamePerformance: ±600 gap clamp', () => {
    // 1600 own vs 600 opp (loss → 400): delta = -1200 → clamped to -600 → 1000
    const v = estimateGamePerformance({ accuracy: 75, acpl: 35, opponentRating: 600, opponentRd: 50, score: 0 });
    expect(v).toBe(Math.round(0.65 * 1600 + 0.35 * 1000));
  });
});
