// Pure helpers for the opening trainer (Openings → Trainer). The drill runs
// entirely in the browser: the page knows the line, plays the opponent's moves
// and checks yours. Only missed moves go to the server (review queue).

import { Chess } from 'chess.js';

export type Side = 'white' | 'black';

export interface DrillLine {
  /** Built-in line id; absent for a line from your own repertoire. */
  id?: string;
  name: string;
  eco?: string | null;
  color: Side;
  /** SAN from the starting position. */
  moves: string[];
}

/** Whose move is at 0-based index `ply` of a line. */
export function sideOfPly(ply: number): Side {
  return ply % 2 === 0 ? 'white' : 'black';
}

export function isUserPly(ply: number, color: Side): boolean {
  return sideOfPly(ply) === color;
}

/** How many moves of the line are yours to find. */
export function userMoveCount(moves: string[], color: Side): number {
  return moves.filter((_, i) => isUserPly(i, color)).length;
}

/** Board state after the first `n` moves: FEN plus the squares of the last
 *  move (for the highlight). */
export function positionAfter(moves: string[], n: number): { fen: string; lastMove?: [string, string] } {
  const chess = new Chess();
  let lastMove: [string, string] | undefined;
  for (const san of moves.slice(0, n)) {
    const m = chess.move(san);
    lastMove = [m.from, m.to];
  }
  return { fen: chess.fen(), lastMove };
}

/** Squares a SAN move goes from/to in `fen` (for the hint arrow), or null. */
export function moveSquares(fen: string, san: string): [string, string] | null {
  try {
    const m = new Chess(fen).move(san);
    return [m.from, m.to];
  } catch {
    return null;
  }
}

/** Is the board move `uci` the line's move `expectedSan` in `fen`? Compared as
 *  SAN so castling, promotion and check marks all line up. */
export function isExpectedMove(fen: string, uci: string, expectedSan: string): boolean {
  try {
    const m = new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined });
    return m.san === expectedSan;
  } catch {
    return false;
  }
}

/** "1. e4 e5 2. Nf3" — a line in the usual notation. */
export function formatMoves(moves: string[]): string {
  return moves
    .map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${san}` : san))
    .join(' ');
}

/** Today in the user's own time zone as YYYY-MM-DD — the review queue turns
 *  over at the user's midnight, not the server's. */
export function localDay(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
