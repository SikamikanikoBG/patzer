import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The routes open the real database on import, so point it at a throwaway
// file first.
const dir = mkdtempSync(join(tmpdir(), 'patzer-pgn-import-'));
process.env.DB_PATH = join(dir, 'pgn.db');

type PgnModule = typeof import('../src/chess/pgnImport.js');
type DbModule = typeof import('../src/db.js');
type Router = { request: (path: string, init?: RequestInit) => Response | Promise<Response> };

let pgn: PgnModule;
let db: DbModule['db'];
let games: Router;
let cookie: string;

beforeAll(async () => {
  ({ db } = await import('../src/db.js'));
  pgn = await import('../src/chess/pgnImport.js');
  games = (await import('../src/routes/games.js')).default;
  const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');
  db.prepare(`INSERT INTO users (id, username, password_hash, role) VALUES (1, 'magnus', 'x', 'user'), (2, 'other', 'x', 'user')`).run();
  db.prepare(`INSERT INTO profiles (user_id, display_name, chesscom_username, lichess_username) VALUES (1, 'Magnus', 'MagnusOnChessCom', 'DrNykterstein'), (2, 'Other', NULL, NULL)`).run();
  cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(1))}`;
});

afterAll(() => {
  try { db.close(); } catch { /* ignore */ }
  rmSync(dir, { recursive: true, force: true });
});

afterEach(() => vi.unstubAllGlobals());

async function call(method: string, path: string, body?: unknown) {
  const res = await games.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

const OPERA = `[Event "Paris"]
[Site "Paris FRA"]
[Date "1858.??.??"]
[Round "?"]
[White "Paul Morphy"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7
8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7
14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`;

const LICHESS = `[Event "Rated blitz game"]
[Site "https://lichess.org/kAdOQKeh"]
[Date "2026.04.08"]
[White "respects_55"]
[Black "DrNykterstein"]
[Result "0-1"]
[UTCDate "2026.04.08"]
[UTCTime "19:39:03"]
[TimeControl "180+0"]

1. e4 Nf6 2. e5 Nd5 { a comment } 0-1`;

describe('splitPgn', () => {
  it('splits a PGN database into games, whatever the line endings', () => {
    const text = `﻿${OPERA}\r\n\r\n${LICHESS}\r\n`;
    const parts = pgn.splitPgn(text);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain('Paul Morphy');
    expect(parts[1]).toContain('respects_55');
  });

  it('keeps bare movetext without tags as one game', () => {
    expect(pgn.splitPgn('1. e4 e5 2. Nf3 Nc6\n3. Bb5 a6')).toEqual(['1. e4 e5 2. Nf3 Nc6\n3. Bb5 a6']);
  });

  it('returns nothing for empty input', () => {
    expect(pgn.splitPgn('  \n\n ')).toEqual([]);
  });
});

describe('toPgnRow', () => {
  it('maps the tags onto Patzer columns from the importing user’s side', () => {
    const row = pgn.toPgnRow(LICHESS, ['magnus', 'drnykterstein']);
    expect(row).toMatchObject({
      white: 'respects_55',
      black: 'DrNykterstein',
      user_color: 'black',
      result: 'win',
      time_control: '180+0',
      time_class: 'blitz',
      end_time: '2026-04-08T19:39:03.000Z',
    });
  });

  it('scores a game the user is not in from White’s side', () => {
    expect(pgn.toPgnRow(OPERA, ['magnus'])).toMatchObject({
      user_color: null, result: 'win', time_control: 'untimed', time_class: null,
      end_time: '1858-01-01T00:00:00.000Z',
    });
  });

  it('keeps an unfinished game and dates an undated one to now', () => {
    const now = new Date('2026-09-29T12:00:00Z');
    expect(pgn.toPgnRow('1. e4 e5 *', [], now)).toMatchObject({
      white: 'White', black: 'Black', result: '*', end_time: now.toISOString(),
    });
  });

  it('gives the same game the same id however it is annotated', () => {
    const plain = pgn.toPgnRow(LICHESS, []) as { external_id: string };
    const annotated = pgn.toPgnRow(LICHESS.replace('Nd5 { a comment }', 'Nd5 $1 { another }'), []) as { external_id: string };
    const other = pgn.toPgnRow(OPERA, []) as { external_id: string };
    expect(plain.external_id).toBe(annotated.external_id);
    expect(plain.external_id).not.toBe(other.external_id);
  });

  it('keeps a game whose annotations chess.js rejects, stored in a form it reads', async () => {
    const odd = LICHESS.replace('{ a comment }', '{ a comment } $1');
    const row = pgn.toPgnRow(odd, []) as { external_id: string; pgn: string };
    expect(typeof row).toBe('object');
    expect(row.external_id).toBe((pgn.toPgnRow(LICHESS, []) as { external_id: string }).external_id);
    const { Chess } = await import('chess.js');
    const c = new Chess();
    c.loadPgn(row.pgn, { strict: false });
    expect(c.history()).toEqual(['e4', 'Nf6', 'e5', 'Nd5']);
    expect(c.getHeaders().White).toBe('respects_55');
  });

  it('skips what the analyzer cannot review', () => {
    expect(pgn.toPgnRow('[Variant "Chess960"]\n\n1. e4 e5 *', [])).toBe('variant');
    expect(pgn.toPgnRow('[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"]\n\n1. e4 *', [])).toBe('custom_position');
    expect(pgn.toPgnRow('[White "a"]\n[Black "b"]\n\n*', [])).toBe('no_moves');
    expect(pgn.toPgnRow('1. e4 e5 2. Qxf7 Kxf7', [])).toBe('invalid');
  });
});

describe('POST /import/pgn', () => {
  it('imports every game of a file, and a second import adds no copies', async () => {
    const text = `${OPERA}\n\n${LICHESS}\n\n[Variant "Chess960"]\n\n1. e4 e5 *`;
    const first = await call('POST', '/import/pgn', { pgn: text });
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({ imported: 2, total: 3, duplicates: 0, skipped: { variant: 1 } });
    expect(first.json.ids).toHaveLength(2);

    const again = await call('POST', '/import/pgn', { pgn: text });
    expect(again.json).toMatchObject({ imported: 0, duplicates: 2 });
    // The already-stored games come back, so one pasted game can be opened.
    expect(again.json.ids).toEqual(first.json.ids);

    const stored = db.prepare(`SELECT source, rated, user_color FROM games WHERE user_id = 1 AND source = 'imported' ORDER BY id`).all();
    expect(stored).toEqual([
      { source: 'imported', rated: 0, user_color: null },
      { source: 'imported', rated: 0, user_color: 'black' },
    ]);
  });

  it('answers no_valid_games when nothing in the text can be imported', async () => {
    const r = await call('POST', '/import/pgn', { pgn: 'hello there' });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('no_valid_games');
  });

  it('rejects an empty body', async () => {
    expect((await call('POST', '/import/pgn', { pgn: '' })).status).toBe(400);
  });
});

describe('GET / paging', () => {
  it('pages with offset and reports totals over every matching game', async () => {
    const insert = db.prepare(`
      INSERT INTO games (user_id, source, external_id, pgn, white, black, result, end_time, bookmarked)
      VALUES (1, 'chesscom', ?, '1. e4 *', 'a', 'b', 'win', ?, ?)`);
    for (let i = 0; i < 5; i++) insert.run(`page-${i}`, new Date(Date.UTC(2020, 0, i + 1)).toISOString(), i === 0 ? 1 : 0);
    const all = await call('GET', '/?limit=200');
    const total = all.json.total as number;
    expect(all.json.games).toHaveLength(total);
    expect(all.json.starred).toBe(1);

    const page1 = await call('GET', '/?limit=3&offset=0');
    const page2 = await call('GET', `/?limit=3&offset=3`);
    expect(page1.json.total).toBe(total);
    const ids = [...page1.json.games, ...page2.json.games].map((g: { id: number }) => g.id);
    expect(ids).toEqual(all.json.games.slice(0, 6).map((g: { id: number }) => g.id));
  });
});

describe('POST /import/chesscom with all', () => {
  it('walks every monthly archive instead of stopping at a limit', async () => {
    const month = (n: number) => `https://api.chess.com/pub/player/magnusonchesscom/games/2020/${String(n).padStart(2, '0')}`;
    const game = (n: number, i: number) => ({
      url: `https://www.chess.com/game/live/${n}${i}`,
      pgn: '1. e4 e5 *', time_control: '180', end_time: 1_580_000_000 + n * 100_000 + i,
      rated: true, time_class: 'blitz', rules: 'chess',
      white: { username: 'MagnusOnChessCom', rating: 2800, result: 'win' },
      black: { username: 'x', rating: 2000, result: 'resigned' },
    });
    const requested: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      requested.push(url);
      const body =
        url.endsWith('/games/archives') ? { archives: [1, 2, 3].map(month) } :
        url.includes('/games/2020/') ? { games: Array.from({ length: 15 }, (_, i) => game(Number(url.slice(-2)), i)) } :
        { username: 'MagnusOnChessCom' };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    const r = await call('POST', '/import/chesscom', { all: true });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ imported: 45, total: 45 });
    expect(requested.filter((u) => u.includes('/games/2020/'))).toHaveLength(3);

    // The default stays the 20 most recent.
    const recent = await call('POST', '/import/chesscom', {});
    expect(recent.json).toEqual({ imported: 0, total: 20 });
  });
});

describe('background analysis after a whole-history import', () => {
  it('queues only each user’s most recent games per site', async () => {
    const { pendingAnalysis } = await import('../src/autoImport.js');
    const insert = db.prepare(`
      INSERT INTO games (user_id, source, external_id, pgn, white, black, result, end_time)
      VALUES (2, 'lichess', ?, '1. e4 *', 'a', 'b', 'win', ?)`);
    for (let i = 0; i < 30; i++) insert.run(`bulk-${i}`, new Date(Date.UTC(2021, 0, i + 1)).toISOString());
    const queued = pendingAnalysis(1000).map((r) => r.id);
    const user2 = db.prepare(`SELECT id FROM games WHERE user_id = 2 ORDER BY end_time DESC`).all() as { id: number }[];
    const queuedForUser2 = user2.filter((g) => queued.includes(g.id)).map((g) => g.id);
    expect(queuedForUser2).toEqual(user2.slice(0, 20).map((g) => g.id));
  });
});
