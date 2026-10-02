import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The routes open the real database on import, so point it at a throwaway
// file first.
const dir = mkdtempSync(join(tmpdir(), 'patzer-game-filters-'));
process.env.DB_PATH = join(dir, 'filters.db');

type DbModule = typeof import('../src/db.js');
type Router = { request: (path: string, init?: RequestInit) => Response | Promise<Response> };

let db: DbModule['db'];
let games: Router;
let cookie: string;

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

beforeAll(async () => {
  ({ db } = await import('../src/db.js'));
  games = (await import('../src/routes/games.js')).default;
  const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');
  db.prepare(`INSERT INTO users (id, username, password_hash, role) VALUES (1, 'me', 'x', 'user'), (2, 'other', 'x', 'user')`).run();
  db.prepare(`INSERT INTO profiles (user_id, display_name) VALUES (1, 'Me'), (2, 'Other')`).run();
  cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(1))}`;

  const insert = db.prepare(`INSERT INTO games (user_id, source, external_id, pgn, white, black, result, time_control, time_class, end_time, user_color)
    VALUES (?, ?, ?, '', 'w', 'b', ?, '600', ?, ?, ?)`);
  insert.run(1, 'chesscom', 'c1', 'win', 'blitz', daysAgo(2), 'white');
  insert.run(1, 'chesscom', 'c2', 'loss', 'rapid', daysAgo(40), 'black');
  insert.run(1, 'lichess', 'l1', 'draw', 'blitz', daysAgo(5), 'black');
  insert.run(1, 'lichess', 'l2', 'loss', 'bullet', daysAgo(400), 'white');
  insert.run(1, 'played', 'p1', 'win', 'rapid', daysAgo(1), 'black');
  // Someone else's game must never show up, whatever the filter.
  insert.run(2, 'lichess', 'x1', 'win', 'blitz', daysAgo(1), 'white');
});

afterAll(() => {
  try { db.close(); } catch { /* ignore */ }
  rmSync(dir, { recursive: true, force: true });
});

async function list(query: string): Promise<{ ids: string[]; total: number }> {
  const res = await games.request(`/?${query}`, { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  const body = await res.json() as { games: { external_id: string }[]; total: number };
  return { ids: body.games.map((g) => g.external_id).sort(), total: body.total };
}

describe('GET /api/games filters', () => {
  it('lists every game of the user without filters', async () => {
    expect(await list('')).toEqual({ ids: ['c1', 'c2', 'l1', 'l2', 'p1'], total: 5 });
  });

  it('filters by site', async () => {
    expect((await list('source=lichess')).ids).toEqual(['l1', 'l2']);
    expect((await list('source=chesscom')).ids).toEqual(['c1', 'c2']);
  });

  it('filters by result', async () => {
    expect((await list('result=win')).ids).toEqual(['c1', 'p1']);
    expect((await list('result=loss')).ids).toEqual(['c2', 'l2']);
    expect((await list('result=draw')).ids).toEqual(['l1']);
  });

  it('filters by colour', async () => {
    expect((await list('color=white')).ids).toEqual(['c1', 'l2']);
    expect((await list('color=black')).ids).toEqual(['c2', 'l1', 'p1']);
  });

  it('filters by period and time control', async () => {
    expect((await list('days=7')).ids).toEqual(['c1', 'l1', 'p1']);
    expect((await list('days=90')).ids).toEqual(['c1', 'c2', 'l1', 'p1']);
    expect((await list('time_class=blitz')).ids).toEqual(['c1', 'l1']);
  });

  it('combines filters, and the total counts the filtered set', async () => {
    expect(await list('source=lichess&color=black&days=30')).toEqual({ ids: ['l1'], total: 1 });
    expect(await list('source=chesscom&result=draw')).toEqual({ ids: [], total: 0 });
  });

  it('ignores unknown filter values instead of failing', async () => {
    expect((await list('source=fics&result=maybe&color=green&days=abc&time_class=classical')).total).toBe(5);
  });
});
