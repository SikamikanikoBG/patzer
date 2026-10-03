// Pure helpers for Train → Puzzles (Lichess puzzles, see server/src/chess/tactics.ts).
// A puzzle is a FEN and a line of UCI moves: the opponent's move that sets the
// puzzle up first, then yours and theirs in turn — the line ends with yours.

import { Chess } from 'chess.js';

export interface TacticsPuzzle {
  id: string;
  fen: string;
  moves: string[];
  rating: number;
  themes: string[];
}

function play(chess: Chess, uci: string) {
  return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined });
}

/** The board after the first `n` moves of the line, with the last move's
 *  squares for the highlight. */
export function positionAt(p: TacticsPuzzle, n: number): { fen: string; lastMove?: [string, string]; turn: 'white' | 'black' } {
  const chess = new Chess(p.fen);
  let lastMove: [string, string] | undefined;
  for (const uci of p.moves.slice(0, n)) {
    const m = play(chess, uci);
    lastMove = [m.from, m.to];
  }
  return { fen: chess.fen(), lastMove, turn: chess.turn() === 'w' ? 'white' : 'black' };
}

/** The side you play: the one to move after the opponent's first move. */
export function playerOf(p: TacticsPuzzle): 'white' | 'black' {
  return new Chess(p.fen).turn() === 'w' ? 'black' : 'white';
}

/** Is `uci` right as move `n` of the line? The line's move is, and — like on
 *  Lichess — on the last move any checkmate counts too. */
export function isRightMove(p: TacticsPuzzle, n: number, uci: string): boolean {
  const want = p.moves[n];
  if (!want) return false;
  if (uci === want) return true;
  // The board sends a promotion with its piece; a missing one means a queen.
  if (want.length === 5 && uci.length === 4 && want.endsWith('q') && uci === want.slice(0, 4)) return true;
  if (n !== p.moves.length - 1) return false;
  const chess = new Chess(positionAt(p, n).fen);
  try {
    play(chess, uci);
  } catch {
    return false;
  }
  return chess.isCheckmate();
}

/** SAN of move `n` of the line, for "the solution was …". */
export function sanAt(p: TacticsPuzzle, n: number): string {
  const chess = new Chess(positionAt(p, n).fen);
  return play(chess, p.moves[n]!).san;
}
