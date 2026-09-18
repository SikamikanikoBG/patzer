import type { Chess } from 'chess.js';

/** Roll the game back to the position before `requester`'s last move: one
 *  ply if they just moved, two if the opponent has already replied. Clocks
 *  are left where they are (a takeback is a courtesy, not a time refund);
 *  only the move timestamp resets so nobody is charged for the negotiation. */
export function applyTakeback(session: { chess: Chess; lastMoveAt: number }, requester: 'white' | 'black'): number {
  let undone = 0;
  const want = requester === 'white' ? 'w' : 'b';
  do {
    if (!session.chess.undo()) break;
    undone++;
  } while (session.chess.turn() !== want);
  session.lastMoveAt = Date.now();
  return undone;
}
