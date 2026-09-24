import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { widenGamesSourceCheck } from '../src/dbMigrations.js';

// An install from before the Lichess import: the games table as the original
// SCHEMA created it, then grown by ensureColumn, with every table that
// references games(id) holding rows. The migration must widen the CHECK and
// lose nothing — above all, no cascade-deleted analyses.
function oldInstall(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source TEXT NOT NULL CHECK(source IN ('chesscom','played','imported','pvp')),
      external_id TEXT,
      pgn TEXT NOT NULL,
      result TEXT,
      end_time TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, source, external_id)
    );
    ALTER TABLE games ADD COLUMN time_class TEXT;
    ALTER TABLE games ADD COLUMN bookmarked INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE games ADD COLUMN notes TEXT;
    CREATE INDEX idx_games_user ON games(user_id, end_time DESC);
    CREATE TABLE analyses (game_id INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE, depth INTEGER NOT NULL);
    CREATE TABLE rating_history (id INTEGER PRIMARY KEY, game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE);
    CREATE TABLE puzzle_attempts (id INTEGER PRIMARY KEY, game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE);
    CREATE TABLE challenges (id INTEGER PRIMARY KEY, game_id INTEGER REFERENCES games(id) ON DELETE SET NULL);
  `);
  db.prepare(`INSERT INTO users (id, username) VALUES (1, 'eric')`).run();
  const ins = db.prepare(`INSERT INTO games (user_id, source, external_id, pgn, result, end_time, time_class, bookmarked, notes) VALUES (1, ?, ?, '1. e4 *', 'win', ?, 'blitz', ?, ?)`);
  ins.run('chesscom', 'https://www.chess.com/game/1', '2026-09-01T10:00:00Z', 1, 'nice game');
  ins.run('played', 'local-1', '2026-09-02T10:00:00Z', 0, null);
  ins.run('pvp', 'pvp-1', '2026-09-03T10:00:00Z', 0, null);
  for (const id of [1, 2, 3]) {
    db.prepare(`INSERT INTO analyses (game_id, depth) VALUES (?, 16)`).run(id);
    db.prepare(`INSERT INTO puzzle_attempts (game_id) VALUES (?)`).run(id);
  }
  db.prepare(`INSERT INTO rating_history (game_id) VALUES (3)`).run();
  db.prepare(`INSERT INTO challenges (game_id) VALUES (3)`).run();
  return db;
}

const count = (db: Database.Database, table: string) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe('widenGamesSourceCheck', () => {
  let db: Database.Database;
  beforeEach(() => { db = oldInstall(); });

  it('rejects a lichess game before and accepts it after', () => {
    const insert = () => db.prepare(`INSERT INTO games (user_id, source, external_id, pgn) VALUES (1, 'lichess', 'abc', '1. d4 *')`).run();
    expect(insert).toThrow(/CHECK constraint failed/);
    expect(widenGamesSourceCheck(db)).toBe(true);
    expect(insert).not.toThrow();
  });

  it('keeps every game, column value and id', () => {
    const before = db.prepare('SELECT * FROM games ORDER BY id').all();
    widenGamesSourceCheck(db);
    expect(db.prepare('SELECT * FROM games ORDER BY id').all()).toEqual(before);
  });

  it('does not cascade-delete anything that references games', () => {
    widenGamesSourceCheck(db);
    expect(count(db, 'analyses')).toBe(3);
    expect(count(db, 'puzzle_attempts')).toBe(3);
    expect(count(db, 'rating_history')).toBe(1);
    expect(db.prepare('SELECT game_id FROM challenges').get()).toEqual({ game_id: 3 });
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('keeps foreign keys enforced and cascading afterwards', () => {
    widenGamesSourceCheck(db);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    db.prepare('DELETE FROM games WHERE id = 1').run();
    expect(count(db, 'analyses')).toBe(2);
  });

  it('keeps the unique key and the indexes', () => {
    widenGamesSourceCheck(db);
    expect(() => db.prepare(`INSERT INTO games (user_id, source, external_id, pgn) VALUES (1, 'chesscom', 'https://www.chess.com/game/1', 'x')`).run())
      .toThrow(/UNIQUE constraint failed/);
    const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'games' AND sql IS NOT NULL`).all();
    expect(idx).toEqual([{ name: 'idx_games_user' }]);
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE name = 'games_new'`).get()).toBeUndefined();
  });

  it('is a no-op the second time and on a fresh schema', () => {
    expect(widenGamesSourceCheck(db)).toBe(true);
    expect(widenGamesSourceCheck(db)).toBe(false);
    const fresh = new Database(':memory:');
    fresh.exec(`CREATE TABLE games (id INTEGER PRIMARY KEY, source TEXT NOT NULL CHECK(source IN ('chesscom','lichess','played','imported','pvp')))`);
    expect(widenGamesSourceCheck(fresh)).toBe(false);
  });

  it('is not blocked by an unrelated dangling reference that was already there', () => {
    db.pragma('foreign_keys = OFF');
    db.prepare('INSERT INTO puzzle_attempts (game_id) VALUES (999)').run();
    db.pragma('foreign_keys = ON');
    expect(widenGamesSourceCheck(db)).toBe(true);
    expect(count(db, 'games')).toBe(3);
  });
});
