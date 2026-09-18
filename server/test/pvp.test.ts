import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';
import { resolveTimeControl, normaliseTimeControl, classifyTimeControl } from '../src/chess/timeClass.js';
import { applyTakeback } from '../src/chess/takeback.js';

describe('resolveTimeControl', () => {
  it('accepts preset keywords', () => {
    expect(resolveTimeControl('rapid')).toEqual({ initial: 600_000, increment: 0 });
    expect(resolveTimeControl('Bullet')).toEqual({ initial: 60_000, increment: 0 });
    expect(resolveTimeControl('untimed')).toBeNull();
  });
  it('accepts the "<base>+<inc>" seconds string the games row actually stores', () => {
    // This is what challenge-accept writes; the play socket used to look it
    // up as a keyword and silently ran every timed PvP game without clocks.
    expect(resolveTimeControl('600+0')).toEqual({ initial: 600_000, increment: 0 });
    expect(resolveTimeControl('180+2')).toEqual({ initial: 180_000, increment: 2_000 });
    expect(resolveTimeControl('900')).toEqual({ initial: 900_000, increment: 0 });
  });
  it('treats garbage as untimed', () => {
    expect(resolveTimeControl(null)).toBeNull();
    expect(resolveTimeControl('')).toBeNull();
    expect(resolveTimeControl('1/86400')).toBeNull();
    expect(resolveTimeControl('0+5')).toBeNull();
  });
});

describe('normaliseTimeControl', () => {
  it('stores presets as their real seconds (classical keeps its 30 minutes)', () => {
    expect(normaliseTimeControl('rapid')).toBe('600+0');
    expect(normaliseTimeControl('classical')).toBe('1800+0');
    expect(normaliseTimeControl('untimed')).toBe('untimed');
    expect(classifyTimeControl(normaliseTimeControl('classical'))).toBe('rapid'); // same rating pool as before
  });
  it('passes real strings through and rejects junk', () => {
    expect(normaliseTimeControl('300+3')).toBe('300+3');
    expect(normaliseTimeControl('whenever')).toBe('untimed');
  });
  it('round-trips: what we store is what the socket resolves', () => {
    for (const k of ['bullet', 'blitz', 'rapid', 'classical']) {
      const stored = normaliseTimeControl(k);
      expect(resolveTimeControl(stored)).toEqual(resolveTimeControl(k));
    }
  });
});

describe('applyTakeback', () => {
  function game(moves: string[]) {
    const chess = new Chess();
    for (const m of moves) chess.move(m);
    return { chess, lastMoveAt: 0 };
  }
  it('undoes one ply when the requester just moved', () => {
    const s = game(['e4', 'e5', 'Nf3']); // white just played Nf3, black to move
    expect(applyTakeback(s, 'white')).toBe(1);
    expect(s.chess.history()).toEqual(['e4', 'e5']);
    expect(s.chess.turn()).toBe('w');
    expect(s.lastMoveAt).toBeGreaterThan(0);
  });
  it('undoes two plies when the opponent has already replied', () => {
    const s = game(['e4', 'e5', 'Nf3', 'Nc6']); // white to move; white wants Nf3 back
    expect(applyTakeback(s, 'white')).toBe(2);
    expect(s.chess.history()).toEqual(['e4', 'e5']);
    expect(s.chess.turn()).toBe('w');
  });
  it('works for black on both parities', () => {
    const a = game(['e4', 'e5']);
    expect(applyTakeback(a, 'black')).toBe(1);
    expect(a.chess.history()).toEqual(['e4']);
    const b = game(['e4', 'e5', 'Nf3']);
    expect(applyTakeback(b, 'black')).toBe(2);
    expect(b.chess.history()).toEqual(['e4']);
    expect(b.chess.turn()).toBe('b');
  });
  it('is safe on an empty or one-ply game', () => {
    const empty = game([]);
    expect(applyTakeback(empty, 'white')).toBe(0);
    const one = game(['e4']);
    expect(applyTakeback(one, 'black')).toBe(1); // nothing of black's, but rolls to black's turn: caller guards this
    expect(one.chess.history()).toEqual([]);
  });
});
