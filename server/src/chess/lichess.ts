// Lichess game export client (https://lichess.org/api#tag/Games/operation/apiGamesUser).
// Unauthenticated and public, like the Chess.com one. Lichess asks anonymous
// clients to send a real User-Agent, make one request at a time and back off
// for a minute after a 429 — so requests from this server are serialized and
// a 429 is surfaced to the user instead of retried.

import { classifyTimeControl, type TimeClass } from './timeClass.js';

const UA = 'patzer (+https://github.com/SikamikanikoBG/patzer)';
const BASE = 'https://lichess.org';

// Lichess usernames: 2–30 chars of letters, digits, _ and -.
const USERNAME_RE = /^[A-Za-z0-9_-]{2,30}$/;
export function isValidLichessUsername(u: string): boolean {
  return USERNAME_RE.test(u);
}

export type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

interface LichessPlayer {
  user?: { name: string; id: string };
  aiLevel?: number;
  rating?: number;
}

export interface LichessGame {
  id: string;
  rated: boolean;
  variant: string;
  speed: string;
  createdAt: number;
  lastMoveAt: number;
  status: string;
  players: { white: LichessPlayer; black: LichessPlayer };
  winner?: 'white' | 'black';
  clock?: { initial: number; increment: number };
  daysPerTurn?: number;
  pgn?: string;
}

/** A Lichess game reduced to the columns Patzer stores. */
export interface ImportRow {
  external_id: string;
  pgn: string;
  white: string;
  black: string;
  result: string;
  time_control: string;
  time_class: TimeClass | null;
  end_time: string;
  user_color: 'white' | 'black' | null;
}

// Statuses of games that never really happened or never finished — nothing
// to review, and several of them come without moves.
const UNPLAYED = new Set(['created', 'started', 'aborted', 'noStart', 'unknownFinish']);

function playerName(p: LichessPlayer): string {
  if (p.user?.name) return p.user.name;
  if (p.aiLevel) return `Stockfish level ${p.aiLevel}`;
  return 'Anonymous';
}

/** Map one exported game onto Patzer's columns, or null if it can't be
 *  reviewed here (a variant, an aborted game, or no moves). */
export function toImportRow(g: LichessGame, username: string): ImportRow | null {
  // Standard chess only — the classifier and coach assume it. "fromPosition"
  // is standard rules from a custom start; the PGN carries its FEN, but the
  // analyzer starts from the initial position, so it's skipped too.
  if (g.variant !== 'standard') return null;
  if (UNPLAYED.has(g.status) || !g.pgn) return null;

  const lc = username.toLowerCase();
  const userColor: 'white' | 'black' | null =
    g.players.white.user?.id === lc ? 'white' :
    g.players.black.user?.id === lc ? 'black' : null;

  // No winner on a finished game means a draw (agreement, stalemate,
  // repetition, insufficient material, timeout vs. insufficient material).
  // Like the chess.com importer, a game the user isn't in is scored from
  // White's side.
  const side = userColor ?? 'white';
  const result = !g.winner ? 'draw' : g.winner === side ? 'win' : 'loss';

  let timeControl: string;
  let timeClass: TimeClass | null;
  if (g.clock) {
    timeControl = `${g.clock.initial}+${g.clock.increment}`;
    timeClass = classifyTimeControl(timeControl);
  } else if (g.daysPerTurn) {
    // Same shape as chess.com's daily games, so both land in one pool.
    timeControl = `1/${g.daysPerTurn * 86400}`;
    timeClass = 'daily';
  } else {
    timeControl = 'untimed';
    timeClass = null;
  }

  return {
    external_id: g.id,
    pgn: g.pgn.trim(),
    white: playerName(g.players.white),
    black: playerName(g.players.black),
    result,
    time_control: timeControl,
    time_class: timeClass,
    end_time: new Date(g.lastMoveAt || g.createdAt).toISOString(),
    user_color: userColor,
  };
}

/** Parse Lichess's NDJSON export — one JSON game per line, blank lines allowed. */
export function parseNdjson(body: string): LichessGame[] {
  const out: LichessGame[] = [];
  for (const line of body.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s) as LichessGame); } catch { /* skip a torn line */ }
  }
  return out;
}

// One request at a time from this server, as Lichess asks.
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

/** Fetch a user's most recent finished games, newest first.
 *  Throws `not_found`, `rate_limited` or `lichess_<status>`. */
export function fetchRecentGames(
  username: string,
  opts: { max: number; since?: number },
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<LichessGame[]> {
  if (!isValidLichessUsername(username)) return Promise.reject(new Error('invalid_username'));
  const params = new URLSearchParams({
    max: String(opts.max),
    pgnInJson: 'true',
    clocks: 'false',
    evals: 'false',
    opening: 'false',
    finished: 'true',
  });
  if (opts.since) params.set('since', String(opts.since));
  const url = `${BASE}/api/games/user/${encodeURIComponent(username)}?${params.toString()}`;

  return serialized(async () => {
    // The export streams; 30s is plenty for the ≤200 games a request asks for.
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': UA, Accept: 'application/x-ndjson' },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 404) throw new Error('not_found');
    if (res.status === 429) throw new Error('rate_limited');
    if (!res.ok) throw new Error(`lichess_${res.status}`);
    return parseNdjson(await res.text());
  });
}
