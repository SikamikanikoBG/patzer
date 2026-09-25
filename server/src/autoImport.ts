// Automatic Chess.com import. On a schedule, Patzer pulls each profile's recent
// Chess.com games, dedupes them into `games`, then analyzes and reviews the new
// ones in the background — so a game you finish on Chess.com shows up here
// (with its review) without a manual Import click. Only profiles with a
// `chesscom_username` set are synced; that username is the on/off switch.

import { db } from './db.js';
import { importChessComGames } from './chess/chesscomImport.js';
import { analyzePgn, saveAnalysis } from './routes/analyze.js';
import { kickAutoReview } from './autoReview.js';

// Poll interval in minutes; 0 disables the timer (a one-off sync still runs on
// boot so a restart always catches up).
const SYNC_MINUTES = Number(process.env.CHESSCOM_SYNC_MINUTES ?? 1);
const IMPORT_LIMIT = 20; // most recent games fetched per user per tick
const MAX_ANALYZE_PER_RUN = 3; // bound chess-api.com load per tick

let running = false;

export function startChessComSync(): void {
  // First catch-up shortly after boot, then on the interval.
  setTimeout(() => void syncOnce(), 15_000);
  if (SYNC_MINUTES > 0) setInterval(() => void syncOnce(), SYNC_MINUTES * 60_000);
}

/** One full sync pass: import → analyze new games → review. Exported so a
 *  manual "Import" can kick it immediately and for tests. */
export async function syncOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await importAll();
    await analyzePending();
    kickAutoReview();
  } catch (err) {
    console.error('[chesscom-sync]', err);
  } finally {
    running = false;
  }
}

async function importAll(): Promise<void> {
  const profiles = db.prepare(`
    SELECT user_id, chesscom_username FROM profiles
    WHERE chesscom_username IS NOT NULL AND TRIM(chesscom_username) != ''
  `).all() as { user_id: number; chesscom_username: string }[];

  for (const p of profiles) {
    try {
      const r = await importChessComGames(p.user_id, p.chesscom_username.trim(), IMPORT_LIMIT);
      if (r.imported > 0) console.log(`[chesscom-sync] user ${p.user_id}: imported ${r.imported} of ${r.total} recent games`);
    } catch (err) {
      // One bad username / a chess.com hiccup must not sink the sweep.
      console.warn(`[chesscom-sync] user ${p.user_id} (${p.chesscom_username}):`, err instanceof Error ? err.message : err);
    }
  }
}

async function analyzePending(): Promise<void> {
  const rows = db.prepare(`
    SELECT g.id, g.pgn
    FROM games g
    LEFT JOIN analyses a ON a.game_id = g.id
    WHERE g.source = 'chesscom' AND a.game_id IS NULL
    ORDER BY g.id DESC
    LIMIT ?
  `).all(MAX_ANALYZE_PER_RUN) as { id: number; pgn: string }[];

  for (const row of rows) {
    try {
      const analysis = await analyzePgn(row.pgn, 14);
      saveAnalysis(row.id, analysis);
      console.log(`[chesscom-sync] analyzed game ${row.id}`);
    } catch (err) {
      console.warn(`[chesscom-sync] analyze game ${row.id}:`, err instanceof Error ? err.message : err);
    }
  }
}
