// Opening trainer — practice a line move by move; the moves you miss come back
// in a daily review queue (roadmap #6).
//
// A line is a list of SAN moves from the starting position plus the side the
// user plays. The drill itself runs in the browser, which already has the line;
// the server keeps only what has to outlive the page: every move the user
// missed, per profile, and when it is due again.
//
// Scheduling is deliberately simple — a daily queue, no spaced-repetition
// algorithm yet. A missed move is due the same day. A right answer in review
// moves it to tomorrow; LEARNED_AFTER right answers in a row (so on that many
// different days) take it out of the queue. A wrong answer starts it over.
// "Today" is the user's own calendar day as the browser reports it (see
// dayOf), so the queue turns over at the user's midnight, not at UTC's.

import { Chess } from 'chess.js';
import { db } from '../db.js';
import { fenToEpd, lookupOpeningByEpd } from './openings.js';
import type { Color } from '../types.js';

export const LEARNED_AFTER = 3;
/** Longest line the trainer accepts (built-in lines stay well below it). */
export const MAX_LINE_PLIES = 30;
/** Repertoire lines follow the opening tree, which stops at ply 20. */
export const MAX_REPERTOIRE_PLIES = 20;
/** A repertoire line is only extended while at least this many games agree. */
export const MIN_REPERTOIRE_GAMES = 2;
/** Enough for every line anyone practises; stops a script from filling the disk. */
export const MAX_MISSES_PER_USER = 5000;

export interface TrainerLine {
  id: string;
  name: string;
  eco: string;
  color: Color;
  moves: string[];
  /** The same line when the opponent leaves it — see TrainerBranch. */
  branches: TrainerBranch[];
}

/** A line where the opponent plays something else than the main line at
 *  index `at`: `moves` is the whole line from the start (the main line's first
 *  `at` moves, then the other move and how to go on). `trap` marks a move that
 *  looks tempting but can be punished right away. */
export interface TrainerBranch {
  at: number;
  moves: string[];
  trap?: boolean;
}

/** At most this many branches for a line from your own repertoire. */
export const MAX_REPERTOIRE_BRANCHES = 4;
/** A repertoire branch follows your games this far past the other move. */
export const BRANCH_PLIES = 6;

// Main lines everybody meets sooner or later, written down from standard
// theory. Names follow lichess-org/chess-openings (CC0), like the ECO map in
// openings.ts. Every line is replayed with chess.js in the test suite.
//
// Each line also has a few branches: the opponent's most common other moves,
// and a few tempting ones (`trap`) a beginner meets and should know how to
// punish. In every branch, each of your own moves was checked with Stockfish
// (depth 18): none is more than half a pawn worse than the engine's best.
const BUILT_IN: {
  id: string; name: string; eco: string; color: Color; line: string;
  branches: { at: number; line: string; trap?: boolean }[];
}[] = [
  // Lines for White
  { id: 'italian', name: 'Italian Game: Giuoco Pianissimo', eco: 'C54', color: 'white',
    line: 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O O-O Re1 a6 Bb3',
    branches: [
      { at: 5, line: 'Nf6 d3 Be7 O-O O-O Re1 d6 c3' },
      { at: 3, line: 'd6 d4 exd4 Nxd4 Nf6 Nc3 Be7 Bf4 O-O Qd2' },
      { at: 3, line: 'f6 Nxe5 fxe5 Qh5+ Ke7 Qxe5+ Kf7 Bc4+', trap: true },
      { at: 5, line: 'Nd4 Nxd4 exd4 O-O Nf6 Re1 d6 c3', trap: true },
    ] },
  { id: 'ruy-lopez', name: 'Ruy Lopez: Closed', eco: 'C92', color: 'white',
    line: 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3',
    branches: [
      { at: 5, line: 'Nf6 O-O Nxe4 d4 Nd6 Bxc6 dxc6 dxe5 Nf5 Qxd8+ Kxd8' },
      { at: 5, line: 'd6 d4 Bd7 Bxc6 Bxc6 Nc3 Nf6 Qd3' },
    ] },
  { id: 'scotch', name: 'Scotch Game: Mieses Variation', eco: 'C45', color: 'white',
    line: 'e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nf6 Nxc6 bxc6 e5 Qe7 Qe2 Nd5 c4',
    branches: [
      { at: 7, line: 'Bc5 Be3 Qf6 c3 Nge7 Bc4 O-O O-O' },
      { at: 5, line: 'Nxd4 Nxd4 exd4 Qxd4 Nf6 e5' },
    ] },
  { id: 'queens-gambit', name: "Queen's Gambit Declined", eco: 'D55', color: 'white',
    line: 'd4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 h6 Bh4',
    branches: [
      { at: 3, line: 'dxc4 e3 Nf6 Bxc4 e6 Nf3 c5 O-O a6 Bb3' },
      { at: 3, line: 'c6 Nf3 Nf6 Nc3 dxc4 a4 Bf5 e3 e6 Bxc4' },
      { at: 3, line: 'e5 dxe5 d4 Nf3 Nc6 g3 Bg4 Bg2 Qd7 O-O', trap: true },
    ] },
  { id: 'london', name: 'London System', eco: 'D02', color: 'white',
    line: 'd4 d5 Bf4 Nf6 e3 e6 Nf3 c5 c3 Nc6 Nbd2 Bd6 Bg3 O-O Bd3',
    branches: [
      { at: 3, line: 'c5 e3 Nc6 c3 Nf6 Nd2 e6 Ngf3 Bd6 Bg3' },
      { at: 1, line: 'Nf6 Bf4 g6 e3 Bg7 Nf3 O-O Be2 d6 h3' },
    ] },
  { id: 'alapin', name: 'Sicilian Defense: Alapin Variation', eco: 'B22', color: 'white',
    line: 'e4 c5 c3 Nf6 e5 Nd5 d4 cxd4 Nf3 Nc6 cxd4 d6 Bc4',
    branches: [
      { at: 3, line: 'd5 exd5 Qxd5 d4 Nf6 Nf3 e6 Be2 Nc6 O-O' },
      { at: 3, line: 'e6 d4 d5 exd5 exd5 Nf3 Nc6 Bb5' },
    ] },
  { id: 'english', name: 'English Opening: Four Knights', eco: 'A29', color: 'white',
    line: 'c4 e5 Nc3 Nf6 Nf3 Nc6 g3 d5 cxd5 Nxd5 Bg2 Nb6 O-O Be7 d3',
    branches: [
      { at: 1, line: 'c5 Nc3 Nc6 g3 g6 Bg2 Bg7 Nf3 Nf6 O-O O-O d4' },
      { at: 1, line: 'Nf6 Nc3 g6 g3 Bg7 Bg2 O-O Nf3 d6 O-O' },
    ] },
  // Lines for Black
  { id: 'najdorf', name: 'Sicilian Defense: Najdorf, English Attack', eco: 'B90', color: 'black',
    line: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be6 f3 Be7',
    branches: [
      { at: 10, line: 'Bg5 e6 f4 Be7 Qf3 Qc7 O-O-O Nbd7' },
      { at: 10, line: 'Be2 e5 Nb3 Be7 O-O O-O' },
      { at: 4, line: 'Bb5+ Bd7 Bxd7+ Qxd7 O-O Nc6 c3 Nf6' },
      { at: 2, line: 'c3 Nf6 e5 Nd5 d4 cxd4 Nf3 Nc6 cxd4 d6' },
    ] },
  { id: 'french-advance', name: 'French Defense: Advance Variation', eco: 'C02', color: 'black',
    line: 'e4 e6 d4 d5 e5 c5 c3 Nc6 Nf3 Qb6 a3 c4',
    branches: [
      { at: 4, line: 'exd5 exd5 Nf3 Nf6 Bd3 Bd6 O-O O-O' },
      { at: 4, line: 'Nc3 Nf6 Bg5 Be7 e5 Nfd7 Bxe7 Qxe7' },
      { at: 4, line: 'Nd2 c5 exd5 exd5 Ngf3 Nc6 Bb5 Bd6' },
    ] },
  { id: 'caro-kann', name: 'Caro-Kann Defense: Classical Variation', eco: 'B19', color: 'black',
    line: 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6 Nf3 Nd7 h5 Bh7 Bd3 Bxd3 Qxd3 e6',
    branches: [
      { at: 4, line: 'e5 Bf5 Nf3 e6 Be2 c5 O-O Nc6' },
      { at: 4, line: 'exd5 cxd5 Bd3 Nc6 c3 Nf6 Bf4 Bg4' },
      { at: 2, line: 'Nc3 d5 Nf3 Bg4 h3 Bxf3 Qxf3 e6' },
    ] },
  { id: 'scandinavian', name: 'Scandinavian Defense: Main Line', eco: 'B01', color: 'black',
    line: 'e4 d5 exd5 Qxd5 Nc3 Qa5 d4 Nf6 Nf3 Bf5 Bc4 e6 Bd2 c6',
    branches: [
      { at: 2, line: 'e5 Bf5 d4 e6 Nf3 c5 c3 Nc6' },
      { at: 2, line: 'Nc3 d4 Nce2 e5 Ng3 Be6' },
      { at: 4, line: 'Nf3 Bg4 Be2 Nc6 d4 O-O-O' },
    ] },
  { id: 'two-knights', name: 'Italian Game: Two Knights Defense', eco: 'C59', color: 'black',
    line: 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5 Bb5+ c6 dxc6 bxc6 Be2 h6 Nf3 e4',
    branches: [
      { at: 6, line: 'd3 Bc5 c3 d6 O-O O-O Re1 a6' },
      { at: 6, line: 'd4 exd4 e5 d5 Bb5 Ne4 Nxd4 Bd7' },
      { at: 4, line: 'd4 exd4 Nxd4 Nf6 Nxc6 bxc6 e5 Qe7 Qe2 Nd5 c4 Nb6' },
      { at: 2, line: 'Qh5 Nc6 Bc4 g6 Qf3 Nf6', trap: true },
    ] },
  { id: 'berlin', name: 'Ruy Lopez: Berlin Defense', eco: 'C67', color: 'black',
    line: 'e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4 d4 Nd6 Bxc6 dxc6 dxe5 Nf5 Qxd8+ Kxd8',
    branches: [
      { at: 6, line: 'd3 Bc5 c3 O-O O-O d6 h3 Ne7' },
      { at: 4, line: 'Bc4 Nf6 d3 Bc5 c3 d6 O-O O-O' },
      { at: 6, line: 'Nc3 Bb4 O-O O-O d3 d6' },
    ] },
  { id: 'kings-indian', name: "King's Indian Defense: Classical", eco: 'E97', color: 'black',
    line: 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6 d5 Ne7',
    branches: [
      { at: 2, line: 'Nf3 g6 g3 Bg7 Bg2 O-O O-O d6' },
      { at: 6, line: 'g3 O-O Bg2 d6 Nf3 Nbd7 O-O e5' },
      { at: 8, line: 'f3 O-O Be3 c5 d5 e6 Qd2 exd5 cxd5' },
      { at: 8, line: 'f4 O-O Nf3 c5 d5 e6 Be2 exd5 cxd5' },
    ] },
  { id: 'slav', name: 'Slav Defense: Main Line', eco: 'D18', color: 'black',
    line: 'd4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4 a4 Bf5 e3 e6 Bxc4 Bb4 O-O O-O',
    branches: [
      { at: 4, line: 'cxd5 cxd5 Nc3 Nf6 Bf4 Nc6 e3 Bf5' },
      { at: 4, line: 'Nc3 Nf6 e3 e6 Nf3 Nbd7 Bd3 dxc4 Bxc4 b5' },
      { at: 6, line: 'e3 Bf5 Nc3 e6 Nh4 Bg6 Nxg6 hxg6' },
    ] },
  { id: 'nimzo-indian', name: 'Nimzo-Indian Defense: Rubinstein', eco: 'E53', color: 'black',
    line: 'd4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 d5 Nf3 c5 O-O Nc6',
    branches: [
      { at: 6, line: 'Qc2 O-O a3 Bxc3+ Qxc3 b6 Bg5 Bb7' },
      { at: 4, line: 'Nf3 b6 g3 Bb7 Bg2 Be7 O-O O-O' },
      { at: 4, line: 'g3 d5 Bg2 Be7 Nf3 O-O O-O dxc4' },
    ] },
];

export const TRAINER_LINES: TrainerLine[] = BUILT_IN.map(({ line, branches, ...rest }) => {
  const moves = line.split(/\s+/);
  return {
    ...rest,
    moves,
    branches: branches
      .map((b) => ({ at: b.at, moves: [...moves.slice(0, b.at), ...b.line.split(/\s+/)], ...(b.trap ? { trap: true } : {}) }))
      .sort((a, b) => a.at - b.at),
  };
});

export interface ReplayedMove { san: string; uci: string; fenBefore: string }

/** Replay SAN moves from the starting position. Returns each move in chess.js'
 *  own spelling (so "Nf3" and "Ng1-f3" compare equal afterwards), or null as
 *  soon as one move is illegal. */
export function replayLine(sans: string[]): ReplayedMove[] | null {
  const chess = new Chess();
  const out: ReplayedMove[] = [];
  for (const san of sans) {
    const fenBefore = chess.fen();
    try {
      const m = chess.move(san);
      out.push({ san: m.san, uci: m.from + m.to + (m.promotion ?? ''), fenBefore });
    } catch {
      return null;
    }
  }
  return out;
}

/** Which side makes the move at 0-based index `ply` of a line. */
export function sideOfPly(ply: number): Color {
  return ply % 2 === 0 ? 'white' : 'black';
}

/** Deepest ECO name along a line, for lines that don't come with one. */
export function lineName(sans: string[]): string | null {
  const chess = new Chess();
  let name: string | null = null;
  for (const san of sans) {
    try { chess.move(san); } catch { break; }
    name = lookupOpeningByEpd(fenToEpd(chess.fen()))?.name ?? name;
  }
  return name;
}

// ---- Your own repertoire -------------------------------------------------

/** Turn a node of the opening tree into a line to practice: start with the
 *  moves up to that node, then keep following the continuation you reached
 *  most often (as long as MIN_REPERTOIRE_GAMES games agree). `games` are SAN
 *  lists, newest first — on a tie the more recent game wins.
 *
 *  With `color` and `flawed` (per game and ply: did the analysis call that
 *  move a mistake?), the line stops before one of your own moves that the
 *  analysis marked as a mistake in most of the games that played it — the
 *  trainer should not drill a habit you'd better lose. `stoppedBefore` then
 *  names that move. */
export function repertoireLine(
  games: string[][],
  prefix: string[],
  minGames = MIN_REPERTOIRE_GAMES,
  maxPlies = MAX_REPERTOIRE_PLIES,
  opts: { color?: Color; flawed?: boolean[][] } = {},
): { games: number; moves: string[]; stoppedBefore?: string } {
  let pool = games.map((_, g) => g).filter((g) => prefix.every((san, i) => games[g]![i] === san));
  const reached = pool.length;
  const moves = [...prefix];
  while (moves.length < maxPlies) {
    const i = moves.length;
    const tally = new Map<string, number>();
    for (const g of pool) {
      const san = games[g]![i];
      if (san) tally.set(san, (tally.get(san) ?? 0) + 1);
    }
    let best: string | null = null;
    let bestN = 0;
    for (const [san, n] of tally) if (n > bestN) { best = san; bestN = n; }
    if (best === null || bestN < minGames) break;
    const next = pool.filter((g) => games[g]![i] === best);
    if (opts.color && opts.flawed && sideOfPly(i) === opts.color) {
      const bad = next.filter((g) => opts.flawed![g]?.[i]).length;
      if (bad * 2 > next.length) return { games: reached, moves, stoppedBefore: best };
    }
    moves.push(best);
    pool = next;
  }
  return { games: reached, moves };
}

/** Where your games left a repertoire line: at each of the opponent's moves
 *  after the chosen position, the other moves your opponents played, most
 *  frequent first, each continued the way your games went on (BRANCH_PLIES
 *  more, one game is enough). Where the analysis called your reply there a
 *  mistake, the branch ends with the engine's move instead (`best` per game
 *  and ply) and `played` names what you played — so you practise what you
 *  should have done after the surprise. */
export function repertoireBranches(
  games: string[][],
  main: string[],
  from: number,
  color: Color,
  flawed: boolean[][],
  best: (string | null)[][],
  max = MAX_REPERTOIRE_BRANCHES,
): (TrainerBranch & { games: number; played?: string })[] {
  const out: (TrainerBranch & { games: number; played?: string })[] = [];
  for (let at = from; at < main.length; at++) {
    if (sideOfPly(at) === color) continue;
    const tally = new Map<string, number>();
    for (let g = 0; g < games.length; g++) {
      const game = games[g]!;
      const san = game[at];
      if (!san || san === main[at] || !main.slice(0, at).every((m, i) => game[i] === m)) continue;
      tally.set(san, (tally.get(san) ?? 0) + 1);
    }
    for (const [alt, n] of tally) {
      const prefix = [...main.slice(0, at), alt];
      const line = repertoireLine(games, prefix, 1, Math.min(at + 1 + BRANCH_PLIES, MAX_REPERTOIRE_PLIES), { color, flawed });
      const branch: TrainerBranch & { games: number; played?: string } = { at, moves: line.moves, games: n };
      if (line.stoppedBefore) {
        // The engine's move in that position, from a game that got there.
        const i = line.moves.length;
        const g = games.findIndex((game, k) => best[k]?.[i] && line.moves.every((m, j) => game[j] === m));
        const better = g >= 0 ? best[g]![i]! : null;
        if (better && better !== line.stoppedBefore && replayLine([...line.moves, better])) {
          branch.moves = [...line.moves, better];
          branch.played = line.stoppedBefore;
        }
      }
      if (branch.moves.slice(at + 1).some((_, k) => sideOfPly(at + 1 + k) === color)) out.push(branch);
    }
  }
  return out.sort((a, b) => b.games - a.games || a.at - b.at).slice(0, max).sort((a, b) => a.at - b.at);
}

// ---- Missed moves and the daily review queue -----------------------------

interface MissRow {
  id: number;
  line_name: string;
  user_color: Color;
  moves: string;
  expected_san: string;
  expected_uci: string;
  misses: number;
  streak: number;
  due_on: string | null;
}

export interface ReviewItem {
  id: number;
  line_name: string;
  /** The built-in line this move belongs to, so the page can show its name
   *  in the user's language; null for repertoire lines. */
  line_id: string | null;
  color: Color;
  /** Moves leading to the position; the user has to find the next one. */
  moves: string[];
  fen: string;
  misses: number;
  streak: number;
}

/** The user's "today" as YYYY-MM-DD. The browser sends its local date; it is
 *  trusted only within a day of the server's UTC date (every time zone is),
 *  anything else — or nothing — falls back to the UTC date. */
export function dayOf(local?: string | null, now = new Date()): string {
  const utc = now.toISOString().slice(0, 10);
  if (!local || !/^\d{4}-\d{2}-\d{2}$/.test(local)) return utc;
  const ms = Date.parse(`${local}T00:00:00Z`);
  // A date that doesn't exist (2026-09-31 parses as October 1st) is ignored.
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== local) return utc;
  return Math.abs(ms - Date.parse(`${utc}T00:00:00Z`)) <= 86_400_000 ? local : utc;
}

/** Remember that the user missed the last move of `moves` (their own move).
 *  Returns 'invalid' when the line is illegal or the last move is the
 *  opponent's, 'full' when the queue already holds MAX_MISSES_PER_USER moves. */
export function recordMiss(
  userId: number,
  input: { moves: string[]; color: Color; lineName?: string | null },
  today = dayOf(),
): 'ok' | 'invalid' | 'full' {
  const replayed = replayLine(input.moves);
  if (!replayed || replayed.length === 0 || replayed.length > MAX_LINE_PLIES) return 'invalid';
  const lastPly = replayed.length - 1;
  if (sideOfPly(lastPly) !== input.color) return 'invalid';
  const expected = replayed[lastPly]!;
  const prefix = replayed.slice(0, lastPly).map((m) => m.san);
  const name = (input.lineName ?? '').trim().slice(0, 120) || lineName(input.moves) || '';
  const position = fenToEpd(expected.fenBefore);

  const known = db.prepare('SELECT 1 FROM opening_misses WHERE user_id = ? AND position = ? AND expected_uci = ?')
    .get(userId, position, expected.uci);
  if (!known) {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM opening_misses WHERE user_id = ?').get(userId) as { n: number };
    if (n >= MAX_MISSES_PER_USER) return 'full';
  }

  db.prepare(`
    INSERT INTO opening_misses (user_id, line_name, user_color, moves, position, expected_san, expected_uci, due_on)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, position, expected_uci) DO UPDATE SET
      misses = opening_misses.misses + 1,
      streak = 0,
      due_on = excluded.due_on,
      line_name = excluded.line_name,
      moves = excluded.moves,
      user_color = excluded.user_color
  `).run(userId, name, input.color, prefix.join(' '), position, expected.san, expected.uci, today);
  return 'ok';
}

/** Take a move out of the review queue for good. False if it isn't the user's. */
export function removeMiss(userId: number, id: number): boolean {
  return db.prepare('DELETE FROM opening_misses WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}

export function queueSummary(userId: number, today = dayOf()): { due: number; learning: number; learned: number } {
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN due_on IS NOT NULL AND due_on <= @today THEN 1 ELSE 0 END) AS due,
      SUM(CASE WHEN due_on IS NOT NULL THEN 1 ELSE 0 END) AS learning,
      SUM(CASE WHEN due_on IS NULL THEN 1 ELSE 0 END) AS learned
    FROM opening_misses WHERE user_id = @user
  `).get({ user: userId, today }) as { due: number | null; learning: number | null; learned: number | null };
  return { due: row.due ?? 0, learning: row.learning ?? 0, learned: row.learned ?? 0 };
}

function toItem(r: MissRow): ReviewItem | null {
  const moves = r.moves ? r.moves.split(' ') : [];
  const replayed = replayLine(moves);
  if (!replayed) return null;
  const chess = new Chess();
  for (const m of replayed) chess.move(m.san);
  return {
    id: r.id,
    line_name: r.line_name,
    line_id: TRAINER_LINES.find((l) => l.name === r.line_name)?.id ?? null,
    color: r.user_color,
    moves,
    fen: chess.fen(),
    misses: r.misses,
    streak: r.streak,
  };
}

/** Today's queue, oldest first. */
export function dueReviews(userId: number, today = dayOf(), limit = 50): ReviewItem[] {
  const rows = db.prepare(`
    SELECT id, line_name, user_color, moves, expected_san, expected_uci, misses, streak, due_on
    FROM opening_misses
    WHERE user_id = ? AND due_on IS NOT NULL AND due_on <= ?
    ORDER BY due_on, id
    LIMIT ?
  `).all(userId, today, limit) as MissRow[];
  return rows.map(toItem).filter((x): x is ReviewItem => x !== null);
}

export interface ReviewAnswer {
  correct: boolean;
  expected_san: string;
  expected_uci: string;
  streak: number;
  learned: boolean;
}

function reviewRow(userId: number, id: number, today: string): (MissRow & { is_due: number; fen: string }) | null {
  const row = db.prepare(`
    SELECT id, line_name, user_color, moves, expected_san, expected_uci, misses, streak, due_on,
           (due_on IS NOT NULL AND due_on <= ?) AS is_due
    FROM opening_misses WHERE id = ? AND user_id = ?
  `).get(today, id, userId) as (MissRow & { is_due: number }) | undefined;
  const item = row && toItem(row);
  return item ? { ...row, fen: item.fen } : null;
}

/** The SAN of board move `uci` in `fen`, or null when it's illegal. */
function sanOf(fen: string, uci: string): string | null {
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined }).san;
  } catch {
    return null;
  }
}

/** Is `uci` the move of review item `id`? Only checks — the review lets a
 *  first wrong try pass without giving the move away or rescheduling, like the
 *  drill does. Null when the item isn't the user's. */
export function checkReview(userId: number, id: number, uci: string): boolean | null {
  const row = reviewRow(userId, id, dayOf());
  return row ? sanOf(row.fen, uci) === row.expected_san : null;
}

/** Check one answer from the review queue and reschedule the move. `uci`
 *  null means "show me the move" — that counts as not knowing it. Returns null
 *  when the move isn't the user's. An item that isn't due (answered twice, or
 *  from a stale page) is checked but not rescheduled. */
export function answerReview(userId: number, id: number, uci: string | null, today = dayOf()): ReviewAnswer | null {
  const row = reviewRow(userId, id, today);
  if (!row) return null;
  const correct = !!uci && sanOf(row.fen, uci) === row.expected_san;

  if (!row.is_due) {
    return { correct, expected_san: row.expected_san, expected_uci: row.expected_uci, streak: row.streak, learned: row.due_on === null };
  }

  const streak = correct ? row.streak + 1 : 0;
  const learned = correct && streak >= LEARNED_AFTER;
  db.prepare(`
    UPDATE opening_misses SET
      streak = ?,
      misses = misses + ?,
      due_on = CASE WHEN ? THEN NULL ELSE date(?, '+1 day') END,
      last_reviewed_at = datetime('now')
    WHERE id = ?
  `).run(streak, correct ? 0 : 1, learned ? 1 : 0, today, row.id);
  return { correct, expected_san: row.expected_san, expected_uci: row.expected_uci, streak, learned };
}
