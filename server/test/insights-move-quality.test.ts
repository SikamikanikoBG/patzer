import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The route opens the real database on import, so point it at a throwaway file first.
const dir = mkdtempSync(join(tmpdir(), 'patzer-insights-'));
process.env.DB_PATH = join(dir, 'insights.db');

type Router = { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
let router: Router;
let cookie: string;
let db: typeof import('../src/db.js')['db'];

/** A move as the analysis stores it — only what the Insights route reads. */
function mv(ply: number, san: string, classification: string) {
  return { ply, san, uci: '', classification, centipawn_loss: 0, eval_before_cp: 0, eval_after_cp: 0, fen_before: '8/8/8/8/8/8/8/8 w - - 0 1', fen_after: '8/8/8/8/8/8/8/8 w - - 0 1' };
}

beforeAll(async () => {
  ({ db } = await import('../src/db.js'));
  const { SCORING_VERSION } = await import('../src/chess/classifier.js');
  router = (await import('../src/routes/insightsV2.js')).default;
  const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');
  db.prepare(`INSERT INTO users (id, username, password_hash, role) VALUES (1, 'me', 'x', 'user'), (2, 'other', 'x', 'user')`).run();
  db.prepare(`INSERT INTO profiles (user_id, display_name) VALUES (1, 'Me'), (2, 'Other')`).run();
  cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(1))}`;

  const game = db.prepare(`INSERT INTO games (id, user_id, source, pgn, white, black, result, end_time, user_color) VALUES (?, ?, 'played', '', ?, ?, ?, ?, ?)`);
  const analysis = db.prepare(`INSERT INTO analyses (game_id, depth, moves_json, scoring_version) VALUES (?, 18, ?, ?)`);
  // Game 1 (older): you are White — plies 1, 3, 5 are yours.
  game.run(1, 1, 'me', 'Bot', 'win', '2026-09-01 10:00:00', 'white');
  analysis.run(1, JSON.stringify([mv(1, 'e4', 'book'), mv(2, 'e5', 'brilliant'), mv(3, 'Nf3', 'best'), mv(4, 'f6', 'blunder'), mv(5, 'Nxe5', 'brilliant')]), SCORING_VERSION);
  // Game 2 (newer): you are Black — plies 2 and 4 are yours.
  game.run(2, 1, 'Anna', 'me', 'loss', '2026-09-02 10:00:00', 'black');
  analysis.run(2, JSON.stringify([mv(1, 'd4', 'brilliant'), mv(2, 'Nf6', 'great'), mv(3, 'c4', 'best'), mv(4, 'Qxd4', 'brilliant')]), SCORING_VERSION);
  // Someone else's game never counts.
  game.run(3, 2, 'other', 'x', 'win', '2026-09-03 10:00:00', 'white');
  analysis.run(3, JSON.stringify([mv(1, 'e4', 'brilliant')]), SCORING_VERSION);
});

afterAll(() => {
  try { db.close(); } catch { /* ignore */ }
  rmSync(dir, { recursive: true, force: true });
});

describe('Insights: move quality', () => {
  it('counts only your own moves, per classification', async () => {
    const res = await router.request('/', { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const { move_quality } = await res.json() as { move_quality: { counts: Record<string, number>; brilliant: { game_id: number; ply: number; san: string; opponent: string }[] } };
    expect(move_quality.counts).toMatchObject({ brilliant: 2, great: 1, best: 1, book: 1, blunder: 0, mistake: 0 });
    // Newest game first, with the opponent's name for the list.
    expect(move_quality.brilliant.map(({ game_id, ply, san, opponent }) => ({ game_id, ply, san, opponent }))).toEqual([
      { game_id: 2, ply: 4, san: 'Qxd4', opponent: 'Anna' },
      { game_id: 1, ply: 5, san: 'Nxe5', opponent: 'Bot' },
    ]);
  });
});
