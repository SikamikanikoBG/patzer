// Playing a Lichess puzzle. The puzzle's FEN is the position *before* the
// opponent's move; moves[0] is that move, and the solver plays every other
// move after it (moves[1], moves[3], …) with the opponent's replies between.

import { Chess } from 'chess.js';

export interface LichessPuzzle {
  id: string;
  fen: string;
  moves: string[];
  rating: number;
  popularity: number;
  plays: number;
  themes: string[];
  game_url: string | null;
  opening: string | null;
}

export interface PuzzlePosition {
  fen: string;
  /** Index into `moves` of the solver's next move. */
  next: number;
  lastMove: [string, string] | null;
}

function play(fen: string, uci: string): Chess | null {
  const chess = new Chess(fen);
  try {
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return chess;
  } catch {
    return null;
  }
}

const squares = (uci: string): [string, string] => [uci.slice(0, 2), uci.slice(2, 4)];

/** The position the solver first sees: after the opponent's setup move. */
export function puzzleStart(p: LichessPuzzle): PuzzlePosition {
  const setup = p.moves[0]!;
  const after = play(p.fen, setup);
  if (!after) throw new Error('bad puzzle');
  return { fen: after.fen(), next: 1, lastMove: squares(setup) };
}

/** Whose side the solver plays. */
export function solverColor(p: LichessPuzzle): 'white' | 'black' {
  return new Chess(p.fen).turn() === 'w' ? 'black' : 'white';
}

export type MoveVerdict =
  | { kind: 'wrong' }
  | { kind: 'solved'; position: PuzzlePosition }
  /** Right move; `reply` is the opponent's answer, already on the board in `position`. */
  | { kind: 'continue'; afterMove: PuzzlePosition; position: PuzzlePosition; reply: string };

/**
 * Judge the solver's move. Like Lichess, any move that mates is right even if
 * it is not the one in the solution — a mate-in-one often has two.
 */
export function judgeMove(p: LichessPuzzle, pos: PuzzlePosition, uci: string): MoveVerdict {
  const expected = p.moves[pos.next];
  const got = uci.toLowerCase();
  const after = play(pos.fen, got);
  if (!after || !expected) return { kind: 'wrong' };
  const isExpected = got === expected.toLowerCase()
    // chess.js-driven boards may send a promotion without the piece when the
    // solution's piece is a queen.
    || (expected.length === 5 && got.length === 4 && expected.startsWith(got) && expected[4] === 'q');
  if (after.isCheckmate()) {
    return { kind: 'solved', position: { fen: after.fen(), next: p.moves.length, lastMove: squares(got) } };
  }
  if (!isExpected) return { kind: 'wrong' };

  const afterMove: PuzzlePosition = { fen: after.fen(), next: pos.next + 1, lastMove: squares(got) };
  const reply = p.moves[pos.next + 1];
  if (!reply) return { kind: 'solved', position: afterMove };
  const replied = play(after.fen(), reply);
  if (!replied) return { kind: 'solved', position: afterMove };
  return {
    kind: 'continue',
    afterMove,
    position: { fen: replied.fen(), next: pos.next + 2, lastMove: squares(reply) },
    reply,
  };
}

/** Every position of the solution, for "view solution". */
export function solutionLine(p: LichessPuzzle, from: PuzzlePosition): PuzzlePosition[] {
  const out: PuzzlePosition[] = [];
  let fen = from.fen;
  for (let i = from.next; i < p.moves.length; i++) {
    const mv = p.moves[i]!;
    const after = play(fen, mv);
    if (!after) break;
    fen = after.fen();
    out.push({ fen, next: i + 1, lastMove: squares(mv) });
  }
  return out;
}
