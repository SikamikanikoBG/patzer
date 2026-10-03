import { describe, expect, it } from 'vitest';
import { isRightMove, playerOf, positionAt, sanAt, type TacticsPuzzle } from './tactics';

// Lichess puzzle 9rwmT: Black plays Bxb2, and White mates with Rd8#.
const mateInOne: TacticsPuzzle = {
  id: '9rwmT', fen: '4k2r/1p2pp1p/1Bb3p1/4b3/4p3/8/PPP2PPP/3R2K1 b k - 2 17', moves: ['e5b2', 'd1d8'], rating: 400, themes: ['mate'],
};
// Lichess puzzle saPhZ: Black plays Re7, White Rd8+, Black Re8 — and Rxe8#.
const mateInTwo: TacticsPuzzle = {
  id: 'saPhZ', fen: '4r1k1/4Bppp/4p3/1n6/4nP2/8/1PP3PP/3R1RK1 b - - 0 24', moves: ['e8e7', 'd1d8', 'e7e8', 'd8e8'], rating: 400, themes: ['mate'],
};

describe('tactics helpers', () => {
  it('knows which side you play: the one after the opponent’s first move', () => {
    expect(playerOf(mateInOne)).toBe('white');
    expect(positionAt(mateInOne, 1).turn).toBe('white');
    expect(positionAt(mateInOne, 1).lastMove).toEqual(['e5', 'b2']);
  });

  it('accepts the move of the line and nothing else before the end', () => {
    expect(isRightMove(mateInTwo, 1, 'd1d8')).toBe(true);
    expect(isRightMove(mateInTwo, 1, 'f1f2')).toBe(false);
  });

  it('accepts any checkmate on the last move', () => {
    expect(isRightMove(mateInOne, 1, 'd1d8')).toBe(true);
    expect(isRightMove(mateInTwo, 3, 'd8e8')).toBe(true);
    // Not mate: wrong.
    expect(isRightMove(mateInOne, 1, 'd1d7')).toBe(false);
    // Illegal: wrong, not a crash.
    expect(isRightMove(mateInOne, 1, 'd1h5')).toBe(false);
  });

  it('writes a move of the line in SAN', () => {
    expect(sanAt(mateInOne, 1)).toBe('Rd8#');
  });
});
