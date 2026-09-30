// Lichess puzzles straight from Hugging Face (datasets/Lichess/chess-puzzles),
// for installs that don't want the ~1 GB local copy. Nothing is written to
// disk.
//
// Why not the dataset server's /filter (DuckDB) endpoint: it rejects function
// calls in the WHERE clause, so there is no way to ask for a theme — `Themes`
// is a list column — and for this 6-million-row dataset it answers "the
// dataset index is loading" after 20 s more often than not.
//
// What works is /rows: any 100 consecutive rows by offset, in about a second.
// The dataset is in no particular order, so a page at a random offset is a
// random sample. Pages go into an in-memory pool and every request is served
// from the pool, fetching more pages only when nothing in it fits. Common
// themes are found in the first page or two; the pool keeps growing in the
// background so rarer ones start to turn up too.

import type { LichessPuzzle, PickOptions } from './puzzleDb.js';

const ROWS_URL = 'https://datasets-server.huggingface.co/rows';
const DATASET = 'Lichess/chess-puzzles';
const PAGE = 100; // the endpoint's maximum
const PARALLEL = 4; // pages per round
const MAX_ROUNDS = 4; // rounds per request before giving up: ~1,600 new rows
const POOL_CAP = 40_000; // ~15 MB
const PREFETCH_BELOW = 8_000; // keep growing the pool in the background until here

interface HfRow {
  PuzzleId: string; GameId: string; FEN: string; Moves: string; Rating: number;
  Popularity: number; NbPlays: number; Themes: string[] | null; OpeningTags: string[] | null;
}
interface HfResponse { rows: { row: HfRow }[]; num_rows_total: number }

function toPuzzle(r: HfRow): LichessPuzzle {
  return {
    id: r.PuzzleId,
    fen: r.FEN,
    moves: r.Moves.split(' '),
    rating: r.Rating,
    popularity: r.Popularity,
    plays: r.NbPlays,
    themes: r.Themes ?? [],
    // GameId carries the side and ply too ("abcd1234/black#82").
    game_url: r.GameId ? `https://lichess.org/${r.GameId}` : null,
    opening: r.OpeningTags?.at(-1)?.replace(/_/g, ' ') ?? null,
  };
}

let pool: LichessPuzzle[] = [];
const inPool = new Set<string>();
let totalRows = 6_100_952; // updated from every response
let growing: Promise<void> | null = null;

export function clearOnlineCache(): void {
  pool = [];
  inPool.clear();
  growing = null;
}

async function fetchPage(offset: number, fetchImpl: typeof fetch): Promise<LichessPuzzle[]> {
  const qs = new URLSearchParams({
    dataset: DATASET, config: 'default', split: 'train', offset: String(offset), length: String(PAGE),
  });
  const res = await fetchImpl(`${ROWS_URL}?${qs.toString()}`, { signal: AbortSignal.timeout(15_000) });
  if (res.status === 429) throw new Error('online_rate_limited');
  if (!res.ok) throw new Error('online_unavailable');
  const body = await res.json() as HfResponse;
  if (body.num_rows_total > 0) totalRows = body.num_rows_total;
  return body.rows.map((r) => toPuzzle(r.row));
}

/** Fetch one round of random pages into the pool. Concurrent callers share it. */
function grow(fetchImpl: typeof fetch): Promise<void> {
  if (growing) return growing;
  growing = (async () => {
    const offsets = Array.from({ length: PARALLEL }, () => Math.floor(Math.random() * Math.max(1, totalRows - PAGE)));
    const pages = await Promise.allSettled(offsets.map((o) => fetchPage(o, fetchImpl)));
    const ok = pages.filter((p): p is PromiseFulfilledResult<LichessPuzzle[]> => p.status === 'fulfilled');
    if (!ok.length) {
      const first = pages[0] as PromiseRejectedResult;
      throw first.reason instanceof Error ? first.reason : new Error('online_unavailable');
    }
    for (const page of ok) {
      for (const p of page.value) {
        if (inPool.has(p.id)) continue;
        pool.push(p);
        inPool.add(p.id);
      }
    }
    // Oldest out first; they have had their chance to be served.
    if (pool.length > POOL_CAP) {
      for (const p of pool.splice(0, pool.length - POOL_CAP)) inPool.delete(p.id);
    }
  })().finally(() => { growing = null; });
  return growing;
}

function matches(p: LichessPuzzle, o: PickOptions): boolean {
  return p.rating >= o.min && p.rating <= o.max && (o.theme === 'mix' || p.themes.includes(o.theme));
}

function pickFromPool(o: PickOptions): LichessPuzzle | null {
  const candidates = pool.filter((p) => matches(p, o));
  if (!candidates.length) return null;
  // Shuffle a bounded sample: the exclude check is one SQL IN (...) query.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
  }
  const sample = candidates.slice(0, 200);
  const seen = o.exclude(sample.map((p) => p.id));
  return sample.find((p) => !seen.has(p.id)) ?? null;
}

/**
 * A puzzle for the first of `windows` (narrowest rating range first) that the
 * pool can serve, fetching more pages between tries.
 */
export async function pickOnlinePuzzle(windows: PickOptions[], fetchImpl: typeof fetch = fetch): Promise<LichessPuzzle | null> {
  for (let round = 0; ; round++) {
    for (const o of windows) {
      const hit = pickFromPool(o);
      if (!hit) continue;
      if (pool.length < PREFETCH_BELOW) void grow(fetchImpl).catch(() => { /* next request retries */ });
      return hit;
    }
    if (round >= MAX_ROUNDS) return null;
    await grow(fetchImpl);
  }
}
