import type Database from 'better-sqlite3';

// Every value `games.source` may hold. The CHECK constraint in db.ts lists the
// same set; adding a source means adding it in both places.
export const GAME_SOURCES = ['chesscom', 'lichess', 'played', 'imported', 'pvp'] as const;

const SOURCE_CHECK_RE = /CHECK\s*\(\s*source\s+IN\s*\(([^)]*)\)\s*\)/i;

/**
 * Widen the CHECK constraint on `games.source` to GAME_SOURCES.
 *
 * SQLite cannot alter a CHECK constraint in place, so this is the rebuild from
 * https://sqlite.org/lang_altertable.html#otheralter: create games_new from the
 * table's *current* CREATE statement (which already carries every column added
 * by ensureColumn over the years) with only the CHECK widened, copy every row,
 * swap the tables and recreate the indexes.
 *
 * Foreign keys are switched off for the swap: analyses, rating_history,
 * puzzle_attempts and challenges all reference games(id), and with them on, dropping
 * the old table would cascade-delete every analysis. The copy keeps the ids,
 * so the references still point at the same games afterwards, which
 * foreign_key_check verifies before the transaction commits (compared with a
 * check taken before the swap, so an old install that already has an
 * unrelated dangling row isn't blocked by it). Any failure rolls
 * the whole thing back and leaves the original table untouched.
 *
 * Idempotent: a no-op once every source is allowed (and on fresh installs,
 * whose schema already lists them).
 */
export function widenGamesSourceCheck(db: Database.Database): boolean {
  const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'games'`).get() as { sql: string } | undefined;
  if (!row) return false;
  const match = SOURCE_CHECK_RE.exec(row.sql);
  if (!match) return false;
  const allowed = new Set(match[1]!.split(',').map((s) => s.trim().replace(/^'|'$/g, '')));
  if (GAME_SOURCES.every((s) => allowed.has(s))) return false;

  const widened = `CHECK(source IN (${GAME_SOURCES.map((s) => `'${s}'`).join(',')}))`;
  const createNew = row.sql
    .replace(SOURCE_CHECK_RE, widened)
    .replace(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?games["`]?/i, 'CREATE TABLE games_new');
  const indexes = (db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'games' AND sql IS NOT NULL`).all() as { sql: string }[])
    .map((r) => r.sql);

  const fkWasOn = db.pragma('foreign_keys', { simple: true }) === 1;
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      const before = (db.prepare('SELECT COUNT(*) AS n FROM games').get() as { n: number }).n;
      const brokenBefore = (db.pragma('foreign_key_check') as unknown[]).length;
      db.exec(createNew);
      db.exec('INSERT INTO games_new SELECT * FROM games');
      const copied = (db.prepare('SELECT COUNT(*) AS n FROM games_new').get() as { n: number }).n;
      if (copied !== before) throw new Error(`games migration copied ${copied} of ${before} rows`);
      db.exec('DROP TABLE games');
      db.exec('ALTER TABLE games_new RENAME TO games');
      for (const sql of indexes) db.exec(sql);
      const brokenAfter = (db.pragma('foreign_key_check') as unknown[]).length;
      if (brokenAfter > brokenBefore) throw new Error(`games migration left ${brokenAfter - brokenBefore} dangling references`);
    })();
  } finally {
    if (fkWasOn) db.pragma('foreign_keys = ON');
  }
  return true;
}
