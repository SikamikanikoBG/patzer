// Lichess Opening Explorer client — master-game statistics for a position.
//
// The public API (https://lichess.org/api#tag/Opening-Explorer) is proxied
// server-side so the browser never talks to Lichess directly (no CORS, one
// place to rate-limit and cache). Master-game stats for a given position are
// effectively immutable, so the cache is a simple bounded LRU keyed by the
// position (FEN without the move counters). Failures are cached briefly too,
// so a dead upstream is asked once a minute, not once per ply.
//
// Upstream is configurable (LICHESS_EXPLORER_URL) so a self-hosted
// lila-openingexplorer works as a drop-in.

import { Chess } from 'chess.js';

export interface ExplorerMove {
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
  averageRating: number | null;
}

export interface ExplorerStats {
  white: number;
  draws: number;
  black: number;
  total: number;
  moves: ExplorerMove[];
  opening: { eco: string; name: string } | null;
}

export type ExplorerResult =
  | { ok: true; stats: ExplorerStats; cached: boolean }
  | { ok: false; reason: 'unavailable' | 'invalid_fen'; cached: boolean };

const DEFAULT_BASE = 'https://explorer.lichess.ovh';
const MAX_ENTRIES = 2000;
const NEGATIVE_TTL_MS = 60_000;
const TIMEOUT_MS = 6000;
const MAX_MOVES = 6;

type Entry = { stats: ExplorerStats } | { failedAt: number };
const cache = new Map<string, Entry>();

function baseUrl(): string {
  return (process.env.LICHESS_EXPLORER_URL || DEFAULT_BASE).replace(/\/+$/, '');
}

/** Position key: FEN minus halfmove/fullmove counters (they never change the stats). */
export function positionKey(fen: string): string | null {
  let chess: Chess;
  try { chess = new Chess(fen); } catch { return null; }
  return chess.fen().split(' ').slice(0, 4).join(' ');
}

function remember(key: string, entry: Entry) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, entry);
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

function touch(key: string): Entry | undefined {
  const e = cache.get(key);
  if (!e) return undefined;
  cache.delete(key);
  cache.set(key, e);
  return e;
}

interface LichessResponse {
  white?: number;
  draws?: number;
  black?: number;
  moves?: Array<{ uci?: string; san?: string; white?: number; draws?: number; black?: number; averageRating?: number | null }>;
  opening?: { eco?: string; name?: string } | null;
}

export function parseLichess(body: unknown): ExplorerStats | null {
  if (!body || typeof body !== 'object') return null;
  const r = body as LichessResponse;
  const white = Number(r.white ?? 0), draws = Number(r.draws ?? 0), black = Number(r.black ?? 0);
  if (![white, draws, black].every(Number.isFinite)) return null;
  const moves: ExplorerMove[] = (Array.isArray(r.moves) ? r.moves : [])
    .filter((m) => typeof m?.uci === 'string' && typeof m?.san === 'string')
    .slice(0, MAX_MOVES)
    .map((m) => ({
      uci: m.uci!,
      san: m.san!,
      white: Number(m.white ?? 0),
      draws: Number(m.draws ?? 0),
      black: Number(m.black ?? 0),
      averageRating: typeof m.averageRating === 'number' ? m.averageRating : null,
    }));
  const opening = r.opening && typeof r.opening.eco === 'string' && typeof r.opening.name === 'string'
    ? { eco: r.opening.eco, name: r.opening.name }
    : null;
  return { white, draws, black, total: white + draws + black, moves, opening };
}

/** Injectable for tests. */
export type FetchLike = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export async function masterStats(fen: string, fetchImpl: FetchLike = fetch): Promise<ExplorerResult> {
  const key = positionKey(fen);
  if (!key) return { ok: false, reason: 'invalid_fen', cached: false };

  const hit = touch(key);
  if (hit) {
    if ('stats' in hit) return { ok: true, stats: hit.stats, cached: true };
    if (Date.now() - hit.failedAt < NEGATIVE_TTL_MS) return { ok: false, reason: 'unavailable', cached: true };
    cache.delete(key);
  }

  const url = `${baseUrl()}/masters?fen=${encodeURIComponent(key + ' 0 1')}&moves=${MAX_MOVES}&topGames=0`;
  try {
    const res = await fetchImpl(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'patzer (+https://github.com/SikamikanikoBG/patzer)' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const stats = parseLichess(await res.json());
    if (!stats) throw new Error('unparseable');
    remember(key, { stats });
    return { ok: true, stats, cached: false };
  } catch {
    remember(key, { failedAt: Date.now() });
    return { ok: false, reason: 'unavailable', cached: false };
  }
}

/** Test hook. */
export function clearExplorerCache() { cache.clear(); }
