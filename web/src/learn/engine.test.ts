import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import {
  castleByRook, demoMove, isRightMove, judgeOwnMove, judgeReply, legalDests, lessonStars, levelOf, levelPiece,
  moveStepDone, moveStepStart, shortestStars, starsDests, starsMove, starsStart, withTurn, wrongReason,
} from './engine';
import type { MoveStep, PlayStep, StarsStep } from './types';

describe('stars', () => {
  const step: StarsStep = { id: 's', type: 'stars', fen: '8/8/8/1p6/8/8/8/R7 w - - 0 1', stars: ['a6', 'b5'], par: 3 };

  it('keeps the move with the collecting piece and only captures stars', () => {
    let s = starsStart(step);
    expect(s.at).toBe('a1');
    s = starsMove(s, 'a1a6')!;
    expect(s.left).toEqual(['b5']);
    expect(s.fen.split(' ')[1]).toBe('w');
    expect(starsDests(s).get('a6')).toContain('b6');
    // b5 is a star with a black pawn on it: capturing it collects it.
    s = starsMove(s, 'a6a5')!;
    expect(starsMove(s, 'a5b5')!.left).toEqual([]);
  });

  it('never lets the piece capture something that is not a star', () => {
    const blocked: StarsStep = { ...step, stars: ['a6'], par: 1 };
    const s = starsMove(starsStart(blocked), 'a1a5')!;
    expect(starsDests(s).get('a5')).not.toContain('b5');
  });

  it('hints the first move of a shortest path', () => {
    // a6 and b5 aren't on one line: three moves, e.g. Ra6, Rb6, Rxb5.
    const hint = shortestStars(starsStart(step))!;
    expect(hint.moves).toBe(3);
    const after = starsMove(starsStart(step), hint.first!)!;
    expect(shortestStars(after)!.moves).toBe(2);
  });
});

describe('find the move', () => {
  const mateStep: MoveStep = { id: 'm', type: 'move', goal: 'mate', fen: 'k7/8/1K6/8/8/8/8/7Q w - - 0 1', line: ['h1h8'] };

  it('accepts every mate when the goal is mate', () => {
    const start = moveStepStart(mateStep).fen;
    expect(isRightMove(mateStep, 0, start, 'h1h8')).toBe(true);
    // Qb7 is mate too, although the line says Qh8.
    expect(isRightMove(mateStep, 0, start, 'h1b7')).toBe(true);
    expect(isRightMove(mateStep, 0, start, 'h1a1')).toBe(false);
  });

  it('accepts only the line (and listed alternatives) otherwise', () => {
    const step: MoveStep = { id: 'x', type: 'move', fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', line: ['g1f3'], accept: ['b1c3'] };
    const start = moveStepStart(step).fen;
    expect(isRightMove(step, 0, start, 'g1f3')).toBe(true);
    expect(isRightMove(step, 0, start, 'b1c3')).toBe(true);
    expect(isRightMove(step, 0, start, 'g1h3')).toBe(false);
    expect(isRightMove(step, 0, start, 'e1e3')).toBe(false); // illegal
  });

  it('starts after the opponent\'s move and ends after the last own move', () => {
    const step: MoveStep = { id: 'p', type: 'move', fen: '4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1', pre: 'd7d5', line: ['e5d6'] };
    const start = moveStepStart(step);
    expect(start.lastMove).toEqual(['d7', 'd5']);
    expect(isRightMove(step, 0, start.fen, 'e5d6')).toBe(true);
    expect(moveStepDone(step, 0, start.fen)).toBe(true);
  });

  it('gives the demo move to whoever owns the piece, keeping en passant alive', () => {
    const after = demoMove('4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1', 'd7d5')!;
    expect(demoMove(after.fen, 'e5d6')!.move.flags).toContain('e');
    // Same side twice: the rook moves again.
    const r1 = demoMove('8/8/8/8/3R4/8/8/8 w - - 0 1', 'd4d8')!;
    expect(demoMove(r1.fen, 'd8a8')).not.toBeNull();
    expect(withTurn(r1.fen, 'white').split(' ')[1]).toBe('w');
  });
});

describe('play it out', () => {
  const mate: PlayStep = { id: 'q', type: 'play', goal: 'mate', limit: 3, fen: '7k/4Q3/6K1/8/8/8/8/8 w - - 0 1' };

  it('knows mate from stalemate', () => {
    const won = new Chess(mate.fen);
    expect(judgeOwnMove(mate, won, won.move('Qe8#'), 1)).toBe('won');
    const patt = new Chess(mate.fen);
    expect(judgeOwnMove(mate, patt, patt.move('Qf7'), 1)).toBe('stalemate');
  });

  it('runs out of moves at the limit', () => {
    const c = new Chess(mate.fen);
    expect(judgeOwnMove(mate, c, c.move('Qe1'), 3)).toBe('limit');
  });

  it('counts a promotion only when the new queen is safe', () => {
    const promote: PlayStep = { id: 'p', type: 'play', goal: 'promote', limit: 10, fen: '8/4P3/8/8/8/2k5/8/K7 w - - 0 1' };
    const safe = new Chess(promote.fen);
    expect(judgeOwnMove(promote, safe, safe.move('e8=Q'), 1)).toBe('won');
    const unsafe = new Chess('3k4/4P3/8/8/8/8/8/K7 w - - 0 1');
    expect(judgeOwnMove(promote, unsafe, unsafe.move('e8=Q+'), 1)).toBeNull();
  });

  it('loses when the engine takes a piece', () => {
    const c = new Chess('8/8/8/8/8/8/1k6/Q6K b - - 0 1');
    expect(judgeReply(c, c.move('Kxa1'))).toBe('lost');
  });

  it('calls a capture you can take back a trade, not a loss', () => {
    const c = new Chess('1r6/8/8/8/8/8/2K5/1R4k1 b - - 0 1');
    expect(judgeReply(c, c.move('Rxb1'))).toBeNull();
  });
});

describe('castling by dropping the king on its rook', () => {
  const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  it('offers the rook squares as destinations', () => {
    expect(legalDests(fen).get('e1')).toEqual(expect.arrayContaining(['g1', 'h1', 'c1', 'a1']));
  });
  it('turns the drop into the king move', () => {
    expect(castleByRook(fen, 'e1h1')).toBe('e1g1');
    expect(castleByRook(fen, 'e1a1')).toBe('e1c1');
    expect(castleByRook(fen, 'a1a8')).toBe('a1a8');
    expect(castleByRook(fen, 'e1f1')).toBe('e1f1');
  });
});

describe('why a move is wrong', () => {
  const mate: MoveStep = { id: 'm', type: 'move', goal: 'mate', fen: '7k/8/5K2/8/8/8/8/6Q1 w - - 0 1', line: ['g1g7'] };
  it('spots stalemate and a check that is not mate', () => {
    expect(wrongReason(mate, mate.fen, 'g1g6')).toBe('stalemate');
    expect(wrongReason(mate, mate.fen, 'g1h1')).toBe('onlyCheck');
    expect(wrongReason(mate, mate.fen, 'g1g2')).toBeNull();
  });
  it('spots a move that gives no check when check was asked', () => {
    const check: MoveStep = { ...mate, goal: 'check' };
    expect(wrongReason(check, mate.fen, 'g1g2')).toBe('noCheck');
  });
});

describe('rewards', () => {
  it('gives 3 stars without a slip, fewer with more', () => {
    expect(lessonStars(6, 0)).toBe(3);
    expect(lessonStars(6, 2)).toBe(2);
    expect(lessonStars(6, 3)).toBe(1);
    expect(lessonStars(1, 1)).toBe(2);
  });

  it('levels up at 5, 12, 21, … stars', () => {
    expect(levelOf(0)).toEqual({ level: 1, floor: 0, next: 5 });
    expect(levelOf(4).level).toBe(1);
    expect(levelOf(5)).toEqual({ level: 2, floor: 5, next: 12 });
    expect(levelOf(12).level).toBe(3);
    expect(levelOf(21).level).toBe(4);
    expect(levelPiece(1)).toBe('p');
    expect(levelPiece(9)).toBe('q');
    expect(levelPiece(15)).toBe('k');
  });
});
