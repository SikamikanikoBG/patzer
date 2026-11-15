import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { originalMoves } from './puzzleGame';

describe('original Lichess game history', () => {
  it('reconstructs every SAN, UCI and intermediate FEN', () => {
    const result = originalMoves({ pgn: '1. e4 e5 2. Nf3 Nc6', gameId: '1234abcd', initialPly: 4 });
    expect(result.map((m) => m.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
    expect(result.map((m) => m.uci)).toEqual(['e2e4', 'e7e5', 'g1f3', 'b8c6']);
    const chess = new Chess(); chess.loadPgn('1. e4 e5 2. Nf3 Nc6');
    expect(result[3]?.fen).toBe(chess.fen());
  });
});
