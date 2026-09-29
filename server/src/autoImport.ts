// Automatic Chess.com + Lichess import. On a schedule, Patzer pulls each
// profile's recent games from both sites, dedupes them into `games`, then
// analyzes and reviews the new ones in the background — so a game you finish
// on Chess.com or Lichess shows up here (with its review) without a manual
// Import click.
//
// Each profile controls its own cadence per site: `chesscom_sync_minutes` /
// `lichess_sync_minutes` are the per-user intervals (0 = off) and the
// `*_last_synced_at` columns record the last run. A single one-minute ticker
// checks which profiles are due and syncs only those, so users can set
// 5-minute or 60-minute cadences independently. Having a `chesscom_username`
// or `lichess_username` set remains the on/off switch for each site.

import { db } from './db.js';
import { importChessComGames } from './chess/chesscomImport.js';
import { importLichessGames } from './chess/lichessImport.js';
import { analyzePgn, saveAnalysis } from './routes/analyze.js';
import { kickAutoReview } from './autoReview.js';

// How often the ticker wakes up to check for due profiles. This is NOT the
// per-user interval — it's the granularity at which we look.
const TICK_MINUTES = 1;
const IMPORT_LIMIT = 20; // most recent games fetched per user per site per tick
const MAX_ANALYZE_PER_RUN = 3; // bound chess-api.com load per tick

let running = false;

export function startChessComSync(): void {
  // First catch-up shortly after boot, then a tick every minute.
  setTimeout(() => void syncOnce(), 15_000);
  setInterval(() => void syncOnce(), TICK_MINUTES * 60_000);
}

/** One full sync pass: import due profiles → analyze new games → review.
 *  Exported for tests and for the boot catch-up. */
export async function syncOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await importDue();
    await analyzePending();
  } catch (err) {
    console.error('[auto-import]', err);
  } finally {
    running = false;
  }
  // Auto-review is deliberately fire-and-forget and isolated from the import
  // result: a review failure must never surface as (or block) a completed
  // import. kickAutoReview() sweeps on its own worker and never throws
  // synchronously; the guard is belt-and-braces.
  try {
    kickAutoReview();
  } catch {
    // no-op — keep the sync loop alive regardless of the review.
  }
}

async function importDue(): Promise<void> {
  await importDueSite('chesscom');
  await importDueSite('lichess');
}

type SyncProfile = {
  user_id: number;
  username: string;
  sync_minutes: number;
  last_synced_at: string | null;
};

async function importDueSite(site: 'chesscom' | 'lichess'): Promise<void> {
  const usernameCol = site === 'chesscom' ? 'chesscom_username' : 'lichess_username';
  const minutesCol = site === 'chesscom' ? 'chesscom_sync_minutes' : 'lichess_sync_minutes';
  const lastCol = site === 'chesscom' ? 'chesscom_last_synced_at' : 'lichess_last_synced_at';

  const profiles = db.prepare(`
    SELECT user_id, ${usernameCol} AS username, ${minutesCol} AS sync_minutes, ${lastCol} AS last_synced_at
    FROM profiles
    WHERE ${usernameCol} IS NOT NULL AND TRIM(${usernameCol}) != ''
  `).all() as SyncProfile[];

  const now = Date.now();
  for (const p of profiles) {
    const minutes = Number(p.sync_minutes);
    if (!(minutes > 0)) continue; // 0 = auto-sync off (manual Import still works)
    if (p.last_synced_at) {
      const last = Date.parse(p.last_synced_at);
      if (Number.isFinite(last) && now - last < minutes * 60_000) continue; // not due yet
    }
    try {
      const r = site === 'chesscom'
        ? await importChessComGames(p.user_id, p.username.trim(), IMPORT_LIMIT)
        : await importLichessGames(p.user_id, p.username.trim(), IMPORT_LIMIT);
      if (r.imported > 0) console.log(`[${site}-sync] user ${p.user_id}: imported ${r.imported} of ${r.total} recent games`);
    } catch (err) {
      // One bad username / a site hiccup must not sink the sweep. We still
      // stamp last_synced_at below so a persistently-broken username is retried
      // at most once per interval, not every minute.
      console.warn(`[${site}-sync] user ${p.user_id} (${p.username}):`, err instanceof Error ? err.message : err);
    }
    db.prepare(`UPDATE profiles SET ${lastCol} = ? WHERE user_id = ?`)
      .run(new Date().toISOString(), p.user_id);
  }
}

async function analyzePending(): Promise<void> {
  const rows = db.prepare(`
    SELECT g.id, g.pgn
    FROM games g
    LEFT JOIN analyses a ON a.game_id = g.id
    WHERE g.source IN ('chesscom', 'lichess') AND a.game_id IS NULL
    ORDER BY g.id DESC
    LIMIT ?
  `).all(MAX_ANALYZE_PER_RUN) as { id: number; pgn: string }[];

  for (const row of rows) {
    try {
      const analysis = await analyzePgn(row.pgn, 14);
      saveAnalysis(row.id, analysis);
      console.log(`[auto-import] analyzed game ${row.id}`);
    } catch (err) {
      console.warn(`[auto-import] analyze game ${row.id}:`, err instanceof Error ? err.message : err);
    }
  }
}
