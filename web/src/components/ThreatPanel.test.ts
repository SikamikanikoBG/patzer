import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';
import { nullMoveFen, threatFromLine } from './ThreatPanel';

function after(moves: string[]): string {
  const c = new Chess();
  for (const m of moves) c.move(m);
  return c.fen();
}

describe('nullMoveFen', () => {
  it('flips the side to move and clears the en-passant square', () => {
    const fen = after(['e4']); // "... b KQkq e3 0 1"
    const nf = nullMoveFen(fen)!;
    expect(nf.split(' ')[1]).toBe('w');
    expect(nf.split(' ')[3]).toBe('-');
    expect(nf.split(' ')[0]).toBe(fen.split(' ')[0]);
    expect(() => new Chess(nf)).not.toThrow();
  });
  it('refuses when the side to move is in check or the game is over', () => {
    expect(nullMoveFen(after(['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#']))).toBeNull();
    expect(nullMoveFen(after(['e4', 'f5', 'Qh5+']))).toBeNull();
  });
  it('rejects garbage', () => {
    expect(nullMoveFen('not a fen')).toBeNull();
  });
});

describe('threatFromLine', () => {
  it('reads capture / check / mate facts off the threatened move', () => {
    const nf = nullMoveFen(after(['e4', 'e5', 'Bc4', 'Nc6', 'Qh5']))!; // white "to move again"
    const th = threatFromLine(nf, { uci: 'h5f7', san: '', pv_san: ['Qxf7#'], cp: null, mate: 1, multipv: 1 }, 0)!;
    expect(th.san).toBe('Qxf7#');
    expect(th.captured).toBe('p');
    expect(th.to).toBe('f7');
    expect(th.isMate).toBe(true);
    expect(th.mateIn).toBe(1);
    expect(th.swingCp).toBe(10000);
  });
  it('swing = our current eval + their eval after we pass, floored at 0', () => {
    const nf = nullMoveFen(after(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5']))!;
    const line = { uci: 'g5f7', san: '', pv_san: ['Nxf7', 'Kxf7'], cp: 359, mate: null, multipv: 1 };
    expect(threatFromLine(nf, line, 20)!.swingCp).toBe(379);
    expect(threatFromLine(nf, line, -400)!.swingCp).toBe(0);
    expect(threatFromLine(nf, line, 20)!.pv).toEqual(['Nxf7', 'Kxf7']);
  });
  it('returns null for an illegal engine move', () => {
    const nf = nullMoveFen(after(['e4']))!;
    expect(threatFromLine(nf, { uci: 'e1e8', san: '', pv_san: [], cp: 0, mate: null, multipv: 1 }, 0)).toBeNull();
  });
});
