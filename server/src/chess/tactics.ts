// Tactic puzzles — the "Puzzles" tab of the Train page. Unlike the Tactic
// Trainer (puzzles from your own mistakes, routes/train.ts) these are puzzles
// from the Lichess puzzle database (CC0) that ship with Patzer: a few thousand
// popular, often-played ones spread over the whole rating range
// (chess/tacticsSet.json, made by scripts/build-tactics-set.mjs — see there).
//
// Each profile has a puzzle rating (Glicko-1, the same maths as the game
// ratings). A puzzle counts as a game against its own Lichess rating; only the
// first try at a puzzle is rated, and the next puzzle is picked close to your
// rating from the ones you haven't tried yet.

import { db } from '../db.js';
import { GLICKO_DEFAULTS, PROVISIONAL_RD_THRESHOLD, inflateRd, updateGlicko } from './glicko.js';
import TACTICS_SET from './tacticsSet.json' with { type: 'json' };

export interface TacticsPuzzle {
  id: string;
  /** Position before the opponent's move that sets the puzzle up. */
  fen: string;
  /** UCI: the opponent's move first, then yours and theirs in turn — the
   *  line ends with your move. */
  moves: string[];
  rating: number;
  themes: string[];
}

/** The theme filters the page offers, each a set of Lichess theme tags. */
export const THEME_FILTERS: Record<string, string[]> = {
  mate: ['mate'],
  fork: ['fork'],
  pin: ['pin', 'skewer'],
  discovered: ['discoveredAttack', 'doubleCheck'],
  sacrifice: ['sacrifice'],
  hanging: ['hangingPiece', 'trappedPiece'],
  defence: ['defensiveMove'],
  endgame: ['endgame'],
};

/** A puzzle's rating is well known after thousands of plays. */
const PUZZLE_RD = 80;

let cache: TacticsPuzzle[] | null = null;

/** Every puzzle, sorted by rating (parsed once, on first use). */
export function allPuzzles(): TacticsPuzzle[] {
  if (cache) return cache;
  cache = TACTICS_SET.puzzles.map((line) => {
    const [id, fen, moves, rating, themes] = line.split('|');
    return { id: id!, fen: fen!, moves: moves!.split(' '), rating: Number(rating), themes: themes ? themes.split(' ') : [] };
  }).sort((a, b) => a.rating - b.rating);
  return cache;
}

function puzzleById(id: string): TacticsPuzzle | undefined {
  return allPuzzles().find((p) => p.id === id);
}

interface RatingRow { rating: number; rd: number; best: number; updated_at: string }

/** Your puzzle rating, with the rating deviation grown for the days you
 *  didn't solve puzzles (like the game ratings). */
export function ratingOf(userId: number, now = Date.now()): { rating: number; rd: number; best: number } {
  const row = db.prepare('SELECT rating, rd, best, updated_at FROM tactics_ratings WHERE user_id = ?').get(userId) as RatingRow | undefined;
  if (!row) return { rating: GLICKO_DEFAULTS.rating, rd: GLICKO_DEFAULTS.rd, best: GLICKO_DEFAULTS.rating };
  const days = (now - Date.parse(`${row.updated_at.replace(' ', 'T')}Z`)) / 86_400_000;
  return { rating: row.rating, rd: inflateRd(row.rd, Math.floor(days)), best: row.best };
}

/** The next puzzle for you: one you haven't tried, as close to your rating as
 *  possible (a random one of those within the smallest window that has any),
 *  optionally only of one theme. Null once you've tried every one. */
export function nextPuzzle(userId: number, theme: string | null, rng = Math.random): TacticsPuzzle | null {
  const tried = new Set((db.prepare('SELECT puzzle_id FROM tactics_attempts WHERE user_id = ?').all(userId) as { puzzle_id: string }[])
    .map((r) => r.puzzle_id));
  const tags = theme ? THEME_FILTERS[theme] : null;
  const pool = allPuzzles().filter((p) => !tried.has(p.id) && (!tags || p.themes.some((t) => tags.includes(t))));
  if (pool.length === 0) return null;
  const { rating } = ratingOf(userId);
  for (let window = 75; ; window *= 2) {
    const near = pool.filter((p) => Math.abs(p.rating - rating) <= window);
    if (near.length > 0) return near[Math.floor(rng() * near.length)]!;
  }
}

export interface AttemptResult {
  /** False when you had tried this puzzle before — nothing changed. */
  rated: boolean;
  rating_before: number;
  rating_after: number;
}

/** Record your first try at a puzzle and update your rating. Null for a
 *  puzzle that doesn't exist. */
export function recordAttempt(userId: number, puzzleId: string, solved: boolean): AttemptResult | null {
  const puzzle = puzzleById(puzzleId);
  if (!puzzle) return null;
  const before = ratingOf(userId);
  const known = db.prepare('SELECT 1 FROM tactics_attempts WHERE user_id = ? AND puzzle_id = ?').get(userId, puzzleId);
  if (known) return { rated: false, rating_before: before.rating, rating_after: before.rating };

  const next = updateGlicko({
    playerR: before.rating, playerRd: before.rd,
    opponentR: puzzle.rating, opponentRd: PUZZLE_RD,
    score: solved ? 1 : 0,
  });
  db.transaction(() => {
    db.prepare('INSERT INTO tactics_attempts (user_id, puzzle_id, solved, rating_before, rating_after) VALUES (?, ?, ?, ?, ?)')
      .run(userId, puzzleId, solved ? 1 : 0, before.rating, next.newR);
    db.prepare(`
      INSERT INTO tactics_ratings (user_id, rating, rd, best, updated_at) VALUES (@user, @rating, @rd, @best, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET rating = @rating, rd = @rd, best = @best, updated_at = datetime('now')
    `).run({ user: userId, rating: next.newR, rd: next.newRd, best: Math.max(before.best, next.newR) });
  })();
  return { rated: true, rating_before: before.rating, rating_after: next.newR };
}

export interface TacticsStats {
  rating: number;
  provisional: boolean;
  best: number;
  played: number;
  solved: number;
  /** Your last tries, newest first: rating after each, for the little chart. */
  recent: { solved: boolean; rating: number }[];
  total: number;
}

export function statsOf(userId: number): TacticsStats {
  const r = ratingOf(userId);
  const counts = db.prepare('SELECT COUNT(*) AS played, COALESCE(SUM(solved), 0) AS solved FROM tactics_attempts WHERE user_id = ?')
    .get(userId) as { played: number; solved: number };
  const recent = db.prepare('SELECT solved, rating_after FROM tactics_attempts WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 30')
    .all(userId) as { solved: number; rating_after: number }[];
  return {
    rating: Math.round(r.rating),
    provisional: r.rd > PROVISIONAL_RD_THRESHOLD,
    best: Math.round(r.best),
    played: counts.played,
    solved: counts.solved,
    recent: recent.map((x) => ({ solved: x.solved === 1, rating: Math.round(x.rating_after) })),
    total: allPuzzles().length,
  };
}
