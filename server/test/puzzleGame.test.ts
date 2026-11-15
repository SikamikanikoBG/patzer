import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { parsePuzzleGame } from '../src/chess/puzzleGame.js';

const before = new Chess();
before.move('e4'); before.move('e5'); before.move('Nf3');
const puzzle = { id: 'abc12', fen: before.fen(), moves: ['b8c6', 'f1b5'] };
const source = { game: { id: '1234abcd', pgn: '1. e4 e5 2. Nf3 Nc6' }, puzzle: { id: 'abc12', initialPly: 4 } };

describe('Lichess puzzle game import', () => {
  it('accepts a game reaching the bundled puzzle setup move', () => {
    expect(parsePuzzleGame(source, puzzle)).toEqual({ pgn: source.game.pgn, gameId: '1234abcd', initialPly: 4 });
  });
  it('rejects a different game or puzzle ID', () => {
    expect(() => parsePuzzleGame({ ...source, game: { ...source.game, pgn: '1. d4 d5' } }, puzzle)).toThrow('does not match');
    expect(() => parsePuzzleGame({ ...source, puzzle: { ...source.puzzle, id: 'wrong' } }, puzzle)).toThrow();
  });
  it('rejects invalid metadata and PGN', () => {
    expect(() => parsePuzzleGame({ ...source, game: { ...source.game, id: 'https://other.site' } }, puzzle)).toThrow();
    expect(() => parsePuzzleGame({ ...source, game: { ...source.game, pgn: 'not pgn' } }, puzzle)).toThrow();
  });
});
