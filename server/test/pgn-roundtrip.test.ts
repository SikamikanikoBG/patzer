import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';

// server/src/ws/play.ts persists a PvP game as `session.chess.pgn()` and
// hydrates a reconnecting client with `new Chess().loadPgn(pgn, { strict: false })`.
// A silent divergence there corrupts live games, so pin the round-trip.

function roundTrip(chess: Chess): Chess {
  const restored = new Chess();
  restored.loadPgn(chess.pgn(), { strict: false });
  return restored;
}

function expectSameGame(a: Chess, b: Chess) {
  expect(b.fen()).toBe(a.fen());
  expect(b.history()).toEqual(a.history());
  expect(b.pgn()).toBe(a.pgn());
  expect(b.turn()).toBe(a.turn());
  expect(b.isGameOver()).toBe(a.isGameOver());
}

describe('PGN save/restore round-trip', () => {
  it('empty game (no moves yet) survives', () => {
    const c = new Chess();
    expectSameGame(c, roundTrip(c));
  });

  it('a game with castling both sides, en passant, promotion and check', () => {
    const c = new Chess();
    for (const m of ['e4', 'd5', 'exd5', 'c5', 'dxc6', 'Nf6', 'cxb7', 'Bd7', 'bxa8=Q', 'Qc7', 'Nf3', 'e6', 'Be2', 'Be7', 'O-O', 'O-O', 'Qxb8', 'Rxb8']) {
      expect(c.move(m)).toBeTruthy();
    }
    expect(c.history()).toContain('bxa8=Q');
    expectSameGame(c, roundTrip(c));
  });

  it('a finished game keeps its terminal state', () => {
    const c = new Chess();
    for (const m of ['f3', 'e5', 'g4', 'Qh4#']) c.move(m);
    expect(c.isCheckmate()).toBe(true);
    const r = roundTrip(c);
    expect(r.isCheckmate()).toBe(true);
    expectSameGame(c, r);
  });

  it('headers set before saving (as play.ts does) come back intact', () => {
    const c = new Chess();
    c.header('Event', 'Local game vs bot');
    c.header('White', 'Player');
    c.header('Black', 'Stockfish (medium)');
    c.header('Result', '*');
    c.header('Date', '2026.09.18');
    for (const m of ['d4', 'Nf6', 'c4', 'e6']) c.move(m);
    const r = roundTrip(c);
    expect(r.header()).toMatchObject({ Event: 'Local game vs bot', White: 'Player', Black: 'Stockfish (medium)', Date: '2026.09.18' });
    expectSameGame(c, r);
  });

  it('restoring twice is stable (idempotent)', () => {
    const c = new Chess();
    for (const m of ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6']) c.move(m);
    const once = roundTrip(c);
    const twice = roundTrip(once);
    expectSameGame(once, twice);
  });

  it('a long game (200+ plies) with repetition round-trips move-for-move', () => {
    const c = new Chess();
    // Shuffle knights from a quiet position; exercises long move lists and the
    // threefold-repetition flag (derived from history, not serialized).
    for (const m of ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'd3', 'd6', 'Nc3', 'Nf6', 'Bg5', 'Bg4', 'h3', 'Bh5', 'g4', 'Bg6']) c.move(m);
    for (let i = 0; i < 50; i++) {
      for (const m of ['Nd5', 'Nd4', 'Nc3', 'Nc6']) expect(c.move(m)).toBeTruthy();
    }
    expect(c.history().length).toBeGreaterThan(200);
    expect(c.isThreefoldRepetition()).toBe(true);
    const r = roundTrip(c);
    expectSameGame(c, r);
    expect(r.isThreefoldRepetition()).toBe(true);
  });

  it('a mid-game restore continues to accept legal moves', () => {
    const c = new Chess();
    for (const m of ['e4', 'e5', 'Nf3']) c.move(m);
    const r = roundTrip(c);
    expect(r.turn()).toBe('b');
    expect(r.move('Nc6')).toBeTruthy();
    expect(() => r.move('Bc4', { strict: true })).not.toThrow(); // white replies
  });
});
