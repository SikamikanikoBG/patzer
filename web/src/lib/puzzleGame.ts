// Parse a Lichess original-game PGN for the puzzle and the Lab. One canonical
// representation keeps the preview and move-by-move analysis in sync.
import { Chess } from 'chess.js';

export interface OriginalPuzzleGame { pgn: string; gameId: string; initialPly: number }
export interface OriginalMove { san: string; fen: string; uci: string }

export function originalMoves(game: OriginalPuzzleGame): OriginalMove[] {
  const chess = new Chess();
  chess.loadPgn(game.pgn, { strict: false });
  const source = chess.history({ verbose: true });
  const replay = new Chess();
  return source.map((move) => {
    replay.move({ from: move.from, to: move.to, promotion: move.promotion });
    return { san: move.san, fen: replay.fen(), uci: move.from + move.to + (move.promotion ?? '') };
  });
}
