import { describe, it, expect } from 'vitest';
import { gFunction, inflateRd, updateGlicko, updatePair, GLICKO_DEFAULTS } from '../src/chess/glicko.js';

describe('gFunction', () => {
  it('is 1 at RD 0 and shrinks as RD grows', () => {
    expect(gFunction(0)).toBe(1);
    expect(gFunction(30)).toBeCloseTo(0.9955, 3);
    expect(gFunction(100)).toBeCloseTo(0.9531, 3);
    expect(gFunction(300)).toBeCloseTo(0.7242, 3);
    expect(gFunction(350)).toBeLessThan(gFunction(300));
  });
});

describe('inflateRd', () => {
  it('leaves RD alone for zero/negative idle time (capped at 350)', () => {
    expect(inflateRd(50, 0)).toBe(50);
    expect(inflateRd(50, -3)).toBe(50);
    expect(inflateRd(900, 0)).toBe(350);
  });
  it('inflates with sqrt(rd² + c²·days) and caps at 350', () => {
    expect(inflateRd(50, 1)).toBeCloseTo(Math.sqrt(50 * 50 + 34.6 * 34.6), 6);
    expect(inflateRd(50, 100)).toBeCloseTo(350, 0); // ~100 idle days ≈ back to a fresh account
    expect(inflateRd(50, 365)).toBe(350);
    expect(inflateRd(50, 10)).toBeGreaterThan(inflateRd(50, 5));
  });
  it('treats garbage RD as a brand-new account', () => {
    expect(inflateRd(NaN, 5)).toBe(350);
    expect(inflateRd(0, 5)).toBe(350);
    expect(inflateRd(-10, 5)).toBe(350);
  });
});

describe('updateGlicko', () => {
  it('reproduces the single-opponent Glickman worked example (1500/200 beats 1400/30)', () => {
    // Derived from the paper formulas with q = ln10/400. Guards against silently
    // changing Q, g() or the d² denominator.
    const r = updateGlicko({ playerR: 1500, playerRd: 200, opponentR: 1400, opponentRd: 30, score: 1 });
    expect(r.newR).toBeCloseTo(1563.4, 0);
    expect(r.newRd).toBeCloseTo(175.2, 0);
    expect(r.deltaR).toBeCloseTo(r.newR - 1500, 10);
    expect(r.deltaRd).toBeCloseTo(r.newRd - 200, 10);
  });
  it('a win raises, a loss lowers, a draw between equals is neutral', () => {
    const base = { playerR: 1200, playerRd: 100, opponentR: 1200, opponentRd: 100 };
    expect(updateGlicko({ ...base, score: 1 }).deltaR).toBeGreaterThan(0);
    expect(updateGlicko({ ...base, score: 0 }).deltaR).toBeLessThan(0);
    expect(updateGlicko({ ...base, score: 0.5 }).deltaR).toBeCloseTo(0, 10);
    // symmetric magnitudes
    expect(updateGlicko({ ...base, score: 1 }).deltaR).toBeCloseTo(-updateGlicko({ ...base, score: 0 }).deltaR, 10);
  });
  it('RD always shrinks after a game and never below 30', () => {
    for (const rd of [350, 200, 100, 50, 31]) {
      const r = updateGlicko({ playerR: 1500, playerRd: rd, opponentR: 1500, opponentRd: 100, score: 1 });
      expect(r.newRd).toBeLessThan(rd);
      expect(r.newRd).toBeGreaterThanOrEqual(30);
    }
    expect(updateGlicko({ playerR: 1500, playerRd: 30, opponentR: 1500, opponentRd: 100, score: 1 }).newRd).toBe(30);
  });
  it('an upset moves the rating more than an expected result', () => {
    const upset = updateGlicko({ playerR: 1200, playerRd: 100, opponentR: 1800, opponentRd: 50, score: 1 });
    const expected = updateGlicko({ playerR: 1800, playerRd: 100, opponentR: 1200, opponentRd: 50, score: 1 });
    expect(upset.deltaR).toBeGreaterThan(expected.deltaR * 5);
  });
  it('a provisional opponent (high RD) moves us less than a settled one', () => {
    const vsSettled = updateGlicko({ playerR: 1500, playerRd: 100, opponentR: 1500, opponentRd: 30, score: 1 });
    const vsProvisional = updateGlicko({ playerR: 1500, playerRd: 100, opponentR: 1500, opponentRd: 350, score: 1 });
    expect(vsSettled.deltaR).toBeGreaterThan(vsProvisional.deltaR);
  });
});

describe('updatePair', () => {
  it('uses pre-update RDs for both sides (no chaining)', () => {
    const pair = updatePair({ whiteR: 1500, whiteRd: 200, blackR: 1400, blackRd: 30, result: '1-0' });
    const whiteAlone = updateGlicko({ playerR: 1500, playerRd: 200, opponentR: 1400, opponentRd: 30, score: 1 });
    const blackAlone = updateGlicko({ playerR: 1400, playerRd: 30, opponentR: 1500, opponentRd: 200, score: 0 });
    expect(pair.white).toEqual(whiteAlone);
    expect(pair.black).toEqual(blackAlone);
  });
  it('maps every result string correctly', () => {
    const base = { whiteR: 1500, whiteRd: 100, blackR: 1500, blackRd: 100 };
    expect(updatePair({ ...base, result: '1-0' }).white.deltaR).toBeGreaterThan(0);
    expect(updatePair({ ...base, result: '1-0' }).black.deltaR).toBeLessThan(0);
    expect(updatePair({ ...base, result: '0-1' }).white.deltaR).toBeLessThan(0);
    expect(updatePair({ ...base, result: '0-1' }).black.deltaR).toBeGreaterThan(0);
    expect(updatePair({ ...base, result: '1/2-1/2' }).white.deltaR).toBeCloseTo(0, 10);
    expect(updatePair({ ...base, result: '1/2-1/2' }).black.deltaR).toBeCloseTo(0, 10);
  });
  it('two equal players: rating changes are exact opposites', () => {
    const p = updatePair({ whiteR: 1500, whiteRd: 100, blackR: 1500, blackRd: 100, result: '1-0' });
    expect(p.white.deltaR).toBeCloseTo(-p.black.deltaR, 10);
  });
  it('defaults are chess.com-style 1200/350', () => {
    expect(GLICKO_DEFAULTS).toEqual({ rating: 1200, rd: 350 });
  });
});
