import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Chess } from 'chess.js';

// The module under test opens the real database on import, so point it at a
// throwaway file first. Everything else in this suite is pure.
const dir = mkdtempSync(join(tmpdir(), 'patzer-live-'));
process.env.DB_PATH = join(dir, 'live.db');

type LiveBotModule = typeof import('../src/chess/liveBotGames.js');
type DbModule = typeof import('../src/db.js');
let live: LiveBotModule;
let db: DbModule['db'];

const USER = 1;

beforeAll(async () => {
  ({ db } = await import('../src/db.js'));
  live = await import('../src/chess/liveBotGames.js');
  db.prepare(`INSERT INTO users (id, username, password_hash, role) VALUES (?, 'tester', 'x', 'user')`).run(USER);
});

afterAll(() => {
  try { db.close(); } catch { /* ignore */ }
  rmSync(dir, { recursive: true, force: true });
});

function snapshotAfter(sans: string[], over: Partial<Parameters<LiveBotModule['persistLiveBotGame']>[0]> = {}) {
  const chess = new Chess();
  for (const san of sans) chess.move(san);
  return {
    user_id: USER,
    difficulty: 'medium',
    user_color: 'white' as const,
    tcKey: 'blitz',
    pgn: chess.pgn(),
    whiteTimeMs: 300_000,
    blackTimeMs: 300_000,
    lastMoveAt: Date.now(),
    ...over,
  };
}

describe('live bot games survive the socket that created them', () => {
  it('has nothing to resume before a game is played', () => {
    expect(live.loadLiveBotGame(USER)).toBeNull();
    expect(live.resumableSummary(null)).toBeNull();
  });

  it('stores a game in progress and reads back the position', () => {
    live.persistLiveBotGame(snapshotAfter(['e4', 'e5', 'Nf3']));
    const row = live.loadLiveBotGame(USER);
    expect(row).not.toBeNull();

    const replay = new Chess();
    replay.loadPgn(row!.pgn, { strict: false });
    expect(replay.history()).toEqual(['e4', 'e5', 'Nf3']);
    expect(replay.turn()).toBe('b');
    expect(row!.white_time_ms).toBe(300_000);
    expect(row!.time_control).toBe('blitz');
  });

  it('keeps exactly one game per user — a new game replaces the old one', () => {
    live.persistLiveBotGame(snapshotAfter(['d4'], { difficulty: 'hard', user_color: 'black', tcKey: 'untimed' }));
    const rows = db.prepare('SELECT COUNT(*) as c FROM live_bot_games WHERE user_id = ?').get(USER) as { c: number };
    expect(rows.c).toBe(1);

    const row = live.loadLiveBotGame(USER)!;
    expect(row.difficulty).toBe('hard');
    expect(row.user_color).toBe('black');
    expect(row.time_control).toBe('untimed');
    expect(live.resumableSummary(row)).toMatchObject({ difficulty: 'hard', user_color: 'black', ply: 1 });
  });

  it('counts plies for the resume card', () => {
    live.persistLiveBotGame(snapshotAfter(['e4', 'c5', 'Nf3', 'd6']));
    expect(live.resumableSummary(live.loadLiveBotGame(USER))!.ply).toBe(4);
  });

  it('refuses to offer a finished game — a resumed position must be playable', () => {
    // Fool's mate: stored, but there is nothing left to play.
    live.persistLiveBotGame(snapshotAfter(['f3', 'e5', 'g4', 'Qh4#']));
    expect(live.resumableSummary(live.loadLiveBotGame(USER))).toBeNull();
  });

  it('refuses to offer a game whose PGN no longer loads', () => {
    const row = { ...live.loadLiveBotGame(USER)!, pgn: '1. Qz9 ??? not-a-game' };
    expect(live.resumableSummary(row)).toBeNull();
  });

  it('clears the game when it ends', () => {
    live.persistLiveBotGame(snapshotAfter(['e4']));
    expect(live.loadLiveBotGame(USER)).not.toBeNull();
    live.clearLiveBotGame(USER);
    expect(live.loadLiveBotGame(USER)).toBeNull();
  });

  it('survives a fresh connection to the same database file', async () => {
    live.persistLiveBotGame(snapshotAfter(['e4', 'e5']));
    const reopened = new (await import('better-sqlite3')).default(process.env.DB_PATH!);
    const row = reopened.prepare('SELECT pgn FROM live_bot_games WHERE user_id = ?').get(USER) as { pgn: string };
    reopened.close();

    const replay = new Chess();
    replay.loadPgn(row.pgn, { strict: false });
    expect(replay.history()).toEqual(['e4', 'e5']);
  });
});
