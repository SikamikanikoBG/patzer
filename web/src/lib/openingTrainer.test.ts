import { describe, expect, it } from 'vitest';
import { formatMoves, isExpectedMove, isUserPly, moveSquares, positionAfter, userMoveCount } from './openingTrainer';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('opening trainer helpers', () => {
  it('knows whose move each ply is', () => {
    expect([0, 1, 2, 3].map((p) => isUserPly(p, 'white'))).toEqual([true, false, true, false]);
    expect([0, 1, 2, 3].map((p) => isUserPly(p, 'black'))).toEqual([false, true, false, true]);
    expect(userMoveCount(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'], 'white')).toBe(3);
    expect(userMoveCount(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'], 'black')).toBe(2);
  });

  it('replays a line to a position with the last move highlighted', () => {
    expect(positionAfter(['e4', 'e5'], 0)).toEqual({ fen: START, lastMove: undefined });
    const after = positionAfter(['e4', 'e5', 'Nf3'], 3);
    expect(after.lastMove).toEqual(['g1', 'f3']);
    expect(after.fen.split(' ')[1]).toBe('b');
  });

  it('accepts exactly the line’s move, whatever the board sends', () => {
    expect(isExpectedMove(START, 'e2e4', 'e4')).toBe(true);
    expect(isExpectedMove(START, 'd2d4', 'e4')).toBe(false);
    expect(isExpectedMove(START, 'e2e5', 'e4')).toBe(false); // illegal
    const castle = positionAfter(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'], 6).fen;
    expect(isExpectedMove(castle, 'e1g1', 'O-O')).toBe(true);
    const check = positionAfter(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5', 'd5', 'exd5', 'Na5'], 10).fen;
    expect(isExpectedMove(check, 'c4b5', 'Bb5+')).toBe(true);
  });

  it('finds the squares for a hint arrow', () => {
    expect(moveSquares(START, 'Nf3')).toEqual(['g1', 'f3']);
    expect(moveSquares(START, 'Nf6')).toBeNull();
  });

  it('writes a line in the usual notation', () => {
    expect(formatMoves(['e4', 'e5', 'Nf3'])).toBe('1. e4 e5 2. Nf3');
    expect(formatMoves([])).toBe('');
  });
});
