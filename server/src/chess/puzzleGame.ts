// Original Lichess game context for a bundled puzzle. Fetch only a known ID;
// no user-supplied URL is ever requested. The upstream PGN ends at the puzzle
// setup move, so this is game history, not the puzzle's solution.
import { Chess } from 'chess.js';
import { allPuzzles } from './tactics.js';

export interface PuzzleGame { pgn: string; gameId: string; initialPly: number }
const cache = new Map<string, { until: number; game: PuzzleGame }>();
const TTL_MS = 24 * 60 * 60 * 1000;

/** Reject mismatched or malformed upstream data rather than showing the wrong game. */
export function parsePuzzleGame(value: unknown, puzzle: { id: string; fen: string; moves: string[] }): PuzzleGame {
  if (!value || typeof value !== 'object') throw Error('Invalid Lichess response');
  const data = value as Record<string, unknown>;
  const game = data.game as Record<string, unknown> | undefined;
  const source = data.puzzle as Record<string, unknown> | undefined;
  if (!game || !source || source.id !== puzzle.id || typeof game.pgn !== 'string' || game.pgn.length > 50_000
    || typeof game.id !== 'string' || !/^[A-Za-z0-9]{8}$/.test(game.id)
    || !Number.isSafeInteger(source.initialPly) || (source.initialPly as number) < 0) {
    throw Error('Invalid Lichess game metadata');
  }
  const chess = new Chess();
  try { chess.loadPgn(game.pgn, { strict: false }); } catch { throw Error('Invalid Lichess game PGN'); }
  if (chess.history().length < 1) throw Error('Empty Lichess game');
  // Lichess returns the game through the move that sets up this tactic.
  // Patzer's stored FEN is immediately before that move.
  const expected = new Chess(puzzle.fen);
  const setup = puzzle.moves[0]!;
  expected.move({ from: setup.slice(0, 2), to: setup.slice(2, 4), promotion: setup.slice(4, 5) || undefined });
  // Clock and fullmove counters can differ; the board, turn, castling and EP must match.
  if (chess.fen().split(' ').slice(0, 4).join(' ') !== expected.fen().split(' ').slice(0, 4).join(' ')) {
    throw Error('Lichess game does not match puzzle position');
  }
  return { pgn: game.pgn, gameId: game.id, initialPly: chess.history().length };
}

/** Null for IDs absent from our bundled set. Failures are not cached. */
export async function originalPuzzleGame(id: string): Promise<PuzzleGame | null> {
  const puzzle = allPuzzles().find((p) => p.id === id);
  if (!puzzle) return null;
  const hit = cache.get(id);
  if (hit && hit.until > Date.now()) return hit.game;
  const response = await fetch(`https://lichess.org/api/puzzle/${encodeURIComponent(id)}`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw Error(`Lichess puzzle API returned ${response.status}`);
  const bytes = await response.text();
  if (bytes.length > 60_000) throw Error('Lichess response too large');
  const parsed = parsePuzzleGame(JSON.parse(bytes) as unknown, puzzle);
  if (cache.size >= 256) cache.delete(cache.keys().next().value!);
  cache.set(id, { until: Date.now() + TTL_MS, game: parsed });
  return parsed;
}
