// Local copy of the Lichess puzzle database (database.lichess.org, CC0).
//
// It lives in its own SQLite file next to chess.db, not inside it: it is
// ~1 GB of reference data anyone can download again, and keeping it out means
// backups of chess.db stay small and deleting it is deleting one file.
//
// A download writes to `puzzles.db.partial` and is renamed into place only
// once complete, so a failed or cancelled import never serves half a table.

import Database from 'better-sqlite3';
import { existsSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Duplex, Readable, Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import * as zlib from 'node:zlib';
import { config } from '../config.js';
import type { PuzzleTheme } from './puzzleThemes.js';

export const LICHESS_PUZZLE_URL = 'https://database.lichess.org/lichess_db_puzzle.csv.zst';

/** A puzzle as the trainer serves it, whichever source it came from. */
export interface LichessPuzzle {
  id: string;
  fen: string;
  /** UCI moves. The first is the opponent's move that sets the puzzle up. */
  moves: string[];
  rating: number;
  popularity: number;
  plays: number;
  themes: string[];
  game_url: string | null;
  opening: string | null;
}

export interface PickOptions {
  theme: PuzzleTheme;
  min: number;
  max: number;
  /** Puzzle ids to skip — the ones this player has already tried. */
  exclude: (ids: string[]) => Set<string>;
}

// ---------------------------------------------------------------------------
// Schema, import and lookup — plain functions over a Database so the tests can
// run them on an in-memory file without the download around them.
// ---------------------------------------------------------------------------

export function createPuzzleSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS puzzles (
      id TEXT PRIMARY KEY,
      fen TEXT NOT NULL,
      moves TEXT NOT NULL,
      rating INTEGER NOT NULL,
      popularity INTEGER NOT NULL,
      plays INTEGER NOT NULL,
      -- Space-padded (' fork pin ') so instr(themes, ' fork ') only matches
      -- whole tags: 'mate' must not match 'mateIn2'.
      themes TEXT NOT NULL,
      game_url TEXT,
      opening TEXT,
      -- Random per row. Picking "the first puzzle at or after (rating, rnd)"
      -- from a random starting point is a random puzzle that one index
      -- lookup finds, where ORDER BY random() would sort millions of rows.
      rnd INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS puzzles_pick ON puzzles(rating, rnd);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
}

const RND_MAX = 2 ** 31;

/** One CSV line → row values, or null for the header / anything malformed. */
export function parsePuzzleCsvLine(line: string): unknown[] | null {
  // PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
  // No field contains a comma (lists are space-separated), so no quoting.
  const f = line.split(',');
  if (f.length < 9) return null;
  const rating = Number(f[3]);
  if (!f[0] || !f[1] || !f[2] || !Number.isFinite(rating)) return null;
  return [
    f[0], f[1], f[2], rating,
    Number(f[5]) || 0, Number(f[6]) || 0,
    ` ${f[7] ?? ''} `,
    f[8] || null,
    f[9]?.trim() || null,
    Math.floor(Math.random() * RND_MAX),
  ];
}

/**
 * Read CSV text chunks into the `puzzles` table. Rows go in in transactions of
 * a few thousand, yielding between them so the server keeps answering requests
 * while millions of rows load.
 */
export async function importPuzzleCsv(
  db: Database.Database,
  chunks: AsyncIterable<Buffer | string>,
  onRows?: (n: number) => void,
  signal?: AbortSignal,
): Promise<number> {
  createPuzzleSchema(db);
  const insert = db.prepare(`INSERT OR REPLACE INTO puzzles
    (id, fen, moves, rating, popularity, plays, themes, game_url, opening, rnd)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const flush = db.transaction((rows: unknown[][]) => { for (const r of rows) insert.run(...r); });

  let rows: unknown[][] = [];
  let count = 0;
  let rest = '';
  const decoder = new TextDecoder();
  const take = async (line: string) => {
    const row = parsePuzzleCsvLine(line);
    if (!row) return;
    rows.push(row);
    if (rows.length >= 5000) {
      flush(rows);
      count += rows.length;
      rows = [];
      onRows?.(count);
      signal?.throwIfAborted();
      await new Promise((r) => setImmediate(r));
    }
  };
  for await (const chunk of chunks) {
    const text = rest + (typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true }));
    const lines = text.split('\n');
    rest = lines.pop() ?? '';
    for (const line of lines) await take(line.trimEnd());
  }
  if (rest.trim()) await take(rest.trimEnd());
  if (rows.length) { flush(rows); count += rows.length; onRows?.(count); }
  db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('count', ?), ('imported_at', ?)`)
    .run(String(countPuzzles(db)), new Date().toISOString());
  return count;
}

export function countPuzzles(db: Database.Database): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM puzzles').get() as { n: number }).n;
}

interface PuzzleRow {
  id: string; fen: string; moves: string; rating: number; popularity: number; plays: number;
  themes: string; game_url: string | null; opening: string | null;
}

function rowToPuzzle(r: PuzzleRow): LichessPuzzle {
  return {
    id: r.id,
    fen: r.fen,
    moves: r.moves.split(' '),
    rating: r.rating,
    popularity: r.popularity,
    plays: r.plays,
    themes: r.themes.trim().split(/\s+/).filter(Boolean),
    game_url: r.game_url,
    // Tags run from family to variation; the last is the most specific.
    opening: r.opening?.split(' ').pop()?.replace(/_/g, ' ') || null,
  };
}

/** A random puzzle in [min, max] with the theme, skipping excluded ids. */
export function pickPuzzle(db: Database.Database, o: PickOptions): LichessPuzzle | null {
  const tag = o.theme === 'mix' ? null : ` ${o.theme} `;
  const cols = 'id, fen, moves, rating, popularity, plays, themes, game_url, opening';
  const themeSql = '(? IS NULL OR instr(themes, ?) > 0)';
  // From a random (rating, rnd) forward to `max`, then — if nothing is left
  // up there — from `min` up to the starting point.
  const after = db.prepare(`SELECT ${cols} FROM puzzles
    WHERE (rating, rnd) >= (?, ?) AND rating <= ? AND ${themeSql}
    ORDER BY rating, rnd LIMIT 20`);
  const before = db.prepare(`SELECT ${cols} FROM puzzles
    WHERE rating >= ? AND (rating, rnd) < (?, ?) AND ${themeSql}
    ORDER BY rating, rnd LIMIT 20`);

  const startRating = o.min + Math.floor(Math.random() * (o.max - o.min + 1));
  const startRnd = Math.floor(Math.random() * RND_MAX);
  for (const rows of [
    () => after.all(startRating, startRnd, o.max, tag, tag) as PuzzleRow[],
    () => before.all(o.min, startRating, startRnd, tag, tag) as PuzzleRow[],
  ]) {
    const found = rows();
    if (!found.length) continue;
    const seen = o.exclude(found.map((r) => r.id));
    const fresh = found.find((r) => !seen.has(r.id));
    if (fresh) return rowToPuzzle(fresh);
  }
  return null;
}

// ---------------------------------------------------------------------------
// The server's copy: status, download job, read handle.
// ---------------------------------------------------------------------------

const PUZZLE_DB_PATH = resolve(dirname(config.dbPath), 'puzzles.db');
const PARTIAL_PATH = `${PUZZLE_DB_PATH}.partial`;

export interface LocalPuzzleStatus {
  state: 'missing' | 'downloading' | 'ready' | 'error';
  count: number;
  imported_at: string | null;
  size_bytes: number;
  /** While downloading. */
  downloaded_bytes: number;
  total_bytes: number | null;
  imported_rows: number;
  error: string | null;
}

let readDb: Database.Database | null = null;
let job: { abort: AbortController; downloaded: number; total: number | null; rows: number } | null = null;
let lastError: string | null = null;

function openReadDb(): Database.Database | null {
  if (readDb) return readDb;
  if (!existsSync(PUZZLE_DB_PATH)) return null;
  try {
    readDb = new Database(PUZZLE_DB_PATH, { readonly: true, fileMustExist: true });
  } catch (e) {
    console.error('[puzzles] could not open', PUZZLE_DB_PATH, (e as Error).message);
    readDb = null;
  }
  return readDb;
}

function closeReadDb() {
  readDb?.close();
  readDb = null;
}

export function localPuzzleDb(): Database.Database | null {
  return openReadDb();
}

export function localPuzzleStatus(): LocalPuzzleStatus {
  const db = openReadDb();
  let count = 0;
  let importedAt: string | null = null;
  if (db) {
    const meta = Object.fromEntries(
      (db.prepare('SELECT key, value FROM meta').all() as { key: string; value: string }[]).map((r) => [r.key, r.value]),
    );
    count = Number(meta.count) || 0;
    importedAt = meta.imported_at ?? null;
  }
  return {
    state: job ? 'downloading' : db ? 'ready' : lastError ? 'error' : 'missing',
    count,
    imported_at: importedAt,
    size_bytes: db ? statSync(PUZZLE_DB_PATH).size : 0,
    downloaded_bytes: job?.downloaded ?? 0,
    total_bytes: job?.total ?? null,
    imported_rows: job?.rows ?? 0,
    error: job ? null : lastError,
  };
}

/**
 * zstd decompression. Node has it built in from 22.15; on older Node (the
 * Docker image runs 20) the `zstd` command line tool does it.
 */
function zstdDecompressor(): Duplex {
  const builtin = (zlib as unknown as { createZstdDecompress?: () => Transform }).createZstdDecompress;
  if (typeof builtin === 'function') return builtin();
  const child = spawn('zstd', ['-dc'], { stdio: ['pipe', 'pipe', 'ignore'] });
  const duplex = Duplex.from({ writable: child.stdin, readable: child.stdout });
  child.on('error', () => duplex.destroy(new Error('zstd_unavailable')));
  child.on('exit', (code) => { if (code) duplex.destroy(new Error('zstd_failed')); });
  return duplex;
}

/** Start downloading and importing. Returns false if one is already running. */
export function startPuzzleDownload(url = LICHESS_PUZZLE_URL): boolean {
  if (job) return false;
  const abort = new AbortController();
  job = { abort, downloaded: 0, total: null, rows: 0 };
  lastError = null;
  const current = job;
  void runDownload(url, current)
    .catch((e) => {
      const msg = abort.signal.aborted ? 'cancelled' : (e as Error).message || 'download_failed';
      if (msg !== 'cancelled') console.error('[puzzles] import failed:', e);
      lastError = msg === 'cancelled' ? null : msg;
      rmSync(PARTIAL_PATH, { force: true });
    })
    .finally(() => { if (job === current) job = null; });
  return true;
}

async function runDownload(url: string, j: NonNullable<typeof job>): Promise<void> {
  rmSync(PARTIAL_PATH, { force: true });
  const res = await fetch(url, {
    signal: j.abort.signal,
    headers: { 'User-Agent': 'Patzer (self-hosted chess trainer)' },
  });
  if (!res.ok || !res.body) throw new Error(`download_failed_${res.status}`);
  const len = Number(res.headers.get('content-length'));
  j.total = Number.isFinite(len) && len > 0 ? len : null;

  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb: TransformCallback) { j.downloaded += chunk.length; cb(null, chunk); },
  });

  const db = new Database(PARTIAL_PATH);
  try {
    // A throwaway file until the rename: no journal, no fsync, big cache.
    db.pragma('journal_mode = OFF');
    db.pragma('synchronous = OFF');
    db.pragma('cache_size = -262144');
    await pipeline(
      Readable.fromWeb(res.body as import('node:stream/web').ReadableStream),
      counter,
      zstdDecompressor(),
      async (source: AsyncIterable<Buffer>) => {
        await importPuzzleCsv(db, source, (n) => { j.rows = n; }, j.abort.signal);
      },
      { signal: j.abort.signal },
    );
    if (countPuzzles(db) === 0) throw new Error('empty_database');
    db.pragma('journal_mode = DELETE');
  } finally {
    db.close();
  }
  closeReadDb();
  renameSync(PARTIAL_PATH, PUZZLE_DB_PATH);
  console.log(`[puzzles] imported ${j.rows} Lichess puzzles into ${PUZZLE_DB_PATH}`);
}

/** Cancel a running download, or delete the local copy. */
export function removeLocalPuzzles(): void {
  if (job) {
    job.abort.abort();
    return;
  }
  closeReadDb();
  rmSync(PUZZLE_DB_PATH, { force: true });
  lastError = null;
}
