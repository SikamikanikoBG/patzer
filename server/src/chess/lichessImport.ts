// Lichess games → `games` rows. The shared importer behind both the manual
// "Import" button and the background auto-sync, mirroring chesscomImport.ts.

import { db } from '../db.js';
import { fetchRecentGames, toImportRow } from './lichess.js';

export async function importLichessGames(
  userId: number,
  username: string,
  /** Most recent N games; undefined imports the whole history. */
  limit: number | undefined,
  since?: number,
): Promise<{ imported: number; total: number; skipped: number }> {
  const games = await fetchRecentGames(username, { max: limit, since });
  // Imported Lichess games are NEVER rated in Patzer's pool — they have their
  // own Lichess rating that lives there. Only PvP games inside Patzer count.
  const stmt = db.prepare(`
    INSERT INTO games (user_id, source, external_id, pgn, white, black, result, time_control, time_class, end_time, user_color, rated)
    VALUES (?, 'lichess', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(user_id, source, external_id) DO NOTHING
  `);

  let imported = 0;
  let skipped = 0;
  for (const g of games) {
    const row = toImportRow(g, username);
    if (!row) { skipped++; continue; }
    const r = stmt.run(
      userId,
      row.external_id,
      row.pgn,
      row.white,
      row.black,
      row.result,
      row.time_control,
      row.time_class,
      row.end_time,
      row.user_color,
    );
    if (r.changes > 0) imported++;
  }
  return { imported, total: games.length, skipped };
}
