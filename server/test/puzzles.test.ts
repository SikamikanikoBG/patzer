import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

// The routes open the real database on import, so point it at a throwaway
// file first. The local puzzle file would sit next to it — and is never
// downloaded here, so the local source reads as missing.
const dir = mkdtempSync(join(tmpdir(), 'patzer-puzzles-'));
process.env.DB_PATH = join(dir, 'chess.db');

type DbModule = typeof import('../src/db.js');
type PuzzleDbModule = typeof import('../src/chess/puzzleDb.js');
type OnlineModule = typeof import('../src/chess/puzzleOnline.js');
type RoutesModule = typeof import('../src/routes/puzzles.js');
type Router = { request: (path: string, init?: RequestInit) => Response | Promise<Response> };

let db: DbModule['db'];
let store: PuzzleDbModule;
let online: OnlineModule;
let routesMod: RoutesModule;
let routes: Router;
let cookie: string;

const HEADER = 'PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags';
const FEN = '6k1/1p3ppp/8/8/8/8/5PPP/R5K1 b - - 0 1';
const csvRow = (id: string, rating: number, themes: string) =>
  `${id},${FEN},b7b6 a1a8,${rating},75,95,1000,${themes},https://lichess.org/abcdefgh#10,Sicilian_Defense Sicilian_Defense_Najdorf_Variation`;

async function* chunks(text: string, size = 37) {
  // Odd-sized chunks so lines get split across chunk boundaries.
  for (let i = 0; i < text.length; i += size) yield Buffer.from(text.slice(i, i + size));
}

beforeAll(async () => {
  ({ db } = await import('../src/db.js'));
  store = await import('../src/chess/puzzleDb.js');
  online = await import('../src/chess/puzzleOnline.js');
  routesMod = await import('../src/routes/puzzles.js');
  routes = routesMod.default;
  const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');
  db.prepare(`INSERT INTO users (id, username, password_hash, role) VALUES (1, 'me', 'x', 'user')`).run();
  db.prepare(`INSERT INTO profiles (user_id, display_name) VALUES (1, 'Me')`).run();
  cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(1))}`;
});

afterAll(() => {
  try { db.close(); } catch { /* ignore */ }
  rmSync(dir, { recursive: true, force: true });
});

async function call(method: string, path: string, body?: unknown) {
  const res = await routes.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

describe('local puzzle store', () => {
  let pdb: Database.Database;
  const none = () => new Set<string>();

  beforeAll(async () => {
    pdb = new Database(':memory:');
    const csv = [
      HEADER,
      csvRow('aaa01', 1500, 'mate mateIn1 short'),
      csvRow('aaa02', 1520, 'mateIn2 fork'),
      csvRow('aaa03', 900, 'fork endgame'),
      'garbage line',
      csvRow('aaa04', 2400, 'pin middlegame'),
    ].join('\n');
    const n = await store.importPuzzleCsv(pdb, chunks(csv));
    expect(n).toBe(4);
  });

  it('imports every well-formed row and records the count', () => {
    expect(store.countPuzzles(pdb)).toBe(4);
    const meta = pdb.prepare(`SELECT value FROM meta WHERE key = 'count'`).get() as { value: string };
    expect(meta.value).toBe('4');
  });

  it('serves puzzles in the shape the board needs', () => {
    const p = store.pickPuzzle(pdb, { theme: 'pin', min: 2000, max: 3000, exclude: none })!;
    expect(p).toMatchObject({
      id: 'aaa04', fen: FEN, moves: ['b7b6', 'a1a8'], rating: 2400,
      themes: ['pin', 'middlegame'], opening: 'Sicilian Defense Najdorf Variation',
    });
  });

  it('matches whole theme tags only', () => {
    // 'mate' must not match the 'mateIn2' puzzle.
    for (let i = 0; i < 20; i++) {
      expect(store.pickPuzzle(pdb, { theme: 'mate', min: 1400, max: 1600, exclude: none })?.id).toBe('aaa01');
    }
  });

  it('stays inside the rating range', () => {
    for (let i = 0; i < 20; i++) {
      expect(store.pickPuzzle(pdb, { theme: 'fork', min: 800, max: 1000, exclude: none })?.id).toBe('aaa03');
    }
    expect(store.pickPuzzle(pdb, { theme: 'pin', min: 800, max: 1600, exclude: none })).toBeNull();
  });

  it('skips puzzles the player already tried', () => {
    const tried = (ids: string[]) => new Set(ids.filter((id) => id === 'aaa01'));
    for (let i = 0; i < 20; i++) {
      expect(store.pickPuzzle(pdb, { theme: 'mix', min: 1400, max: 1600, exclude: tried })?.id).toBe('aaa02');
    }
    const all = (ids: string[]) => new Set(ids);
    expect(store.pickPuzzle(pdb, { theme: 'mix', min: 0, max: 3000, exclude: all })).toBeNull();
  });

  it('finds the only match wherever the random starting point lands', () => {
    // Single match at the bottom of the range: found through the wrap-around.
    for (let i = 0; i < 30; i++) {
      expect(store.pickPuzzle(pdb, { theme: 'endgame', min: 0, max: 3000, exclude: none })?.id).toBe('aaa03');
    }
  });
});

describe('online puzzles (Hugging Face)', () => {
  const hfRow = (id: string, rating: number, themes: string[]) => ({ row: {
    PuzzleId: id, GameId: 'abcd1234/black#10', FEN, Moves: 'b7b6 a1a8', Rating: rating, RatingDeviation: 80,
    Popularity: 90, NbPlays: 12, Themes: themes, OpeningTags: null,
  } });
  const page = (rows: unknown[]) => new Response(JSON.stringify({ rows, num_rows_total: 6_000_000 }), { status: 200 });
  const none = () => new Set<string>();

  it('samples /rows pages and filters them by theme and rating', async () => {
    online.clearOnlineCache();
    const urls: string[] = [];
    const fakeFetch = (async (url: string) => {
      urls.push(url);
      return page([hfRow('far01', 2500, ['fork']), hfRow('near1', 1510, ['pin']), hfRow('fork1', 1490, ['fork', 'short'])]);
    }) as unknown as typeof fetch;

    const p = await online.pickOnlinePuzzle([{ theme: 'fork', min: 1400, max: 1600, exclude: none }], fakeFetch);
    expect(p).toMatchObject({ id: 'fork1', moves: ['b7b6', 'a1a8'], rating: 1490, game_url: 'https://lichess.org/abcd1234/black#10' });
    const u = new URL(urls[0]!);
    expect(u.pathname).toBe('/rows');
    expect(u.searchParams.get('dataset')).toBe('Lichess/chess-puzzles');
    expect(u.searchParams.get('length')).toBe('100');
  });

  it('serves later requests from the pool, preferring the narrow window', async () => {
    online.clearOnlineCache();
    let calls = 0;
    const fakeFetch = (async () => {
      calls++;
      return page([hfRow('wide1', 1800, ['pin']), hfRow('tight', 1520, ['pin'])]);
    }) as unknown as typeof fetch;
    const windows = [
      { theme: 'pin' as const, min: 1400, max: 1600, exclude: none },
      { theme: 'pin' as const, min: 1000, max: 2000, exclude: none },
    ];
    expect((await online.pickOnlinePuzzle(windows, fakeFetch))?.id).toBe('tight');
    const before = calls;
    // Already tried 'tight': the wider window still has 'wide1' in the pool.
    const tried = (ids: string[]) => new Set(ids.filter((id) => id === 'tight'));
    const next = await online.pickOnlinePuzzle(windows.map((w) => ({ ...w, exclude: tried })), fakeFetch);
    expect(next?.id).toBe('wide1');
    // Answered from the pool; at most the background top-up went out.
    expect(calls - before).toBeLessThanOrEqual(4);
  });

  it('gives up after a few rounds when nothing fits', async () => {
    online.clearOnlineCache();
    let calls = 0;
    const fakeFetch = (async () => { calls++; return page([hfRow(`x${calls}`, 1500, ['pin'])]); }) as unknown as typeof fetch;
    expect(await online.pickOnlinePuzzle([{ theme: 'bodenMate', min: 1400, max: 1600, exclude: none }], fakeFetch)).toBeNull();
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(20);
  });

  it('reports Hugging Face being down', async () => {
    online.clearOnlineCache();
    const down = (async () => new Response('', { status: 503 })) as unknown as typeof fetch;
    await expect(online.pickOnlinePuzzle([{ theme: 'fork', min: 1, max: 2, exclude: none }], down))
      .rejects.toThrow('online_unavailable');
  });
});

describe('puzzle rating', () => {
  it('moves up on a solve and down on a miss, more against a stronger puzzle', () => {
    const r = routesMod.nextPuzzleRating;
    expect(r(1500, 1500, true, 0)).toBe(1520);
    expect(r(1500, 1500, false, 0)).toBe(1480);
    expect(r(1500, 1500, true, 50)).toBe(1510);
    expect(r(1500, 1900, true, 50) - 1500).toBeGreaterThan(r(1500, 1100, true, 50) - 1500);
  });
});

describe('puzzle routes', () => {
  it('starts every profile at 1500', async () => {
    const { status, body } = await call('GET', '/status');
    expect(status).toBe(200);
    expect(body).toMatchObject({ rating: 1500, played: 0, solved: 0 });
    expect((body.local as { state: string }).state).toBe('missing');
  });

  it('counts only the first try at a puzzle', async () => {
    const first = await call('POST', '/attempt', { puzzle_id: 'abc12', puzzle_rating: 1500, themes: ['fork', 'bogus'], solved: false });
    expect(first.body).toMatchObject({ rating: 1480, delta: -20, counted: true });
    const retry = await call('POST', '/attempt', { puzzle_id: 'abc12', puzzle_rating: 1500, themes: [], solved: true });
    expect(retry.body).toMatchObject({ rating: 1480, delta: 0, counted: false });

    const status = await call('GET', '/status');
    expect(status.body).toMatchObject({ rating: 1480, played: 1, solved: 0 });
    const stored = db.prepare(`SELECT themes FROM lichess_puzzle_attempts WHERE puzzle_id = 'abc12'`).get() as { themes: string };
    expect(stored.themes).toBe('fork');
  });

  it('rejects unknown themes and says when the local copy is missing', async () => {
    expect((await call('GET', '/next?theme=notATheme')).status).toBe(400);
    const local = await call('GET', '/next?source=local&theme=fork');
    expect(local).toMatchObject({ status: 409, body: { error: 'local_missing' } });
  });

  it('keeps the download and delete endpoints for admins', async () => {
    expect((await call('POST', '/local/download')).status).toBe(403);
    expect((await call('DELETE', '/local')).status).toBe(403);
  });
});
