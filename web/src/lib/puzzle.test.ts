import { describe, expect, it } from 'vitest';
import { judgeMove, puzzleStart, solutionLine, solverColor, type LichessPuzzle } from './puzzle';

// Black's b7-b6 lets White mate on the back rank with Ra8.
const backRank: LichessPuzzle = {
  id: 'test1',
  fen: '6k1/1p3ppp/8/8/8/8/5PPP/R5K1 b - - 0 1',
  moves: ['b7b6', 'a1a8'],
  rating: 900, popularity: 90, plays: 10, themes: ['mateIn1'], game_url: null, opening: null,
};

describe('lichess puzzle play', () => {
  it('starts after the opponent move, with the solver on the other side', () => {
    const start = puzzleStart(backRank);
    expect(start.fen.startsWith('6k1/5ppp/1p6/')).toBe(true);
    expect(start).toMatchObject({ next: 1, lastMove: ['b7', 'b6'] });
    expect(solverColor(backRank)).toBe('white');
  });

  it('accepts the solution and rejects anything else', () => {
    const start = puzzleStart(backRank);
    expect(judgeMove(backRank, start, 'a1a8').kind).toBe('solved');
    expect(judgeMove(backRank, start, 'g1f1').kind).toBe('wrong');
    // Not even a legal move.
    expect(judgeMove(backRank, start, 'a1h8').kind).toBe('wrong');
  });

  it('accepts a different move that also mates', () => {
    const twoRooks: LichessPuzzle = { ...backRank, fen: '6k1/1p3ppp/8/8/8/8/5PPP/R3R1K1 b - - 0 1' };
    expect(judgeMove(twoRooks, puzzleStart(twoRooks), 'e1e8').kind).toBe('solved');
  });

  it('plays the opponent reply and waits for the next move', () => {
    const longer: LichessPuzzle = { ...backRank, moves: ['b7b6', 'g2g3', 'g8f8', 'a1a8'] };
    const v = judgeMove(longer, puzzleStart(longer), 'g2g3');
    expect(v.kind).toBe('continue');
    if (v.kind !== 'continue') return;
    expect(v.reply).toBe('g8f8');
    expect(v.position).toMatchObject({ next: 3, lastMove: ['g8', 'f8'] });
    expect(judgeMove(longer, v.position, 'a1a8').kind).toBe('solved');
  });

  it('lists the rest of the solution', () => {
    const longer: LichessPuzzle = { ...backRank, moves: ['b7b6', 'g2g3', 'g8f8', 'a1a8'] };
    expect(solutionLine(longer, puzzleStart(longer)).map((p) => p.lastMove)).toEqual([
      ['g2', 'g3'], ['g8', 'f8'], ['a1', 'a8'],
    ]);
  });
});
