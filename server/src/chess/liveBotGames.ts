import { Chess } from 'chess.js';
import { db } from '../db.js';

// A bot game in progress.
//
// Until v7.14.0 a game against the engine existed only inside the WebSocket
// handler's closure, so closing the tab — or a phone freezing the browser while
// you answered a message — destroyed it outright. Nothing was written down
// until the game ended. Now every move snapshots the game here and
// reconnecting replays it.
//
// PvP already survived this way against its `games` row. Bot games get their
// own table instead, because a half-played position has no business in `games`:
// those rows are finished games and feed the game list, Insights, ratings and
// the analysis pipeline.

export interface LiveBotRow {
  difficulty: string;
  user_color: 'white' | 'black';
  time_control: string;
  pgn: string;
  white_time_ms: number | null;
  black_time_ms: number | null;
  last_move_at: string;
  updated_at: string;
}

export interface LiveBotSnapshot {
  user_id: number;
  difficulty: string;
  user_color: 'white' | 'black';
  /** The preset key ('blitz', 'untimed', …), not a "600+0" string. */
  tcKey: string;
  pgn: string;
  whiteTimeMs: number;
  blackTimeMs: number;
  lastMoveAt: number;
}

/** What the client needs to offer "resume" — never the PGN itself. */
export interface Resumable {
  difficulty: string;
  user_color: 'white' | 'black';
  time_control: string;
  ply: number;
  updated_at: string;
}

export function persistLiveBotGame(snap: LiveBotSnapshot): void {
  try {
    db.prepare(`
      INSERT INTO live_bot_games (user_id, difficulty, user_color, time_control, pgn,
                                  white_time_ms, black_time_ms, last_move_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        difficulty = excluded.difficulty, user_color = excluded.user_color,
        time_control = excluded.time_control, pgn = excluded.pgn,
        white_time_ms = excluded.white_time_ms, black_time_ms = excluded.black_time_ms,
        last_move_at = excluded.last_move_at, updated_at = excluded.updated_at
    `).run(
      snap.user_id, snap.difficulty, snap.user_color, snap.tcKey, snap.pgn,
      snap.whiteTimeMs, snap.blackTimeMs,
      new Date(snap.lastMoveAt).toISOString(), new Date().toISOString(),
    );
  } catch (err) {
    // A failed snapshot must never take down a game in progress. The worst case
    // is the old behaviour for one move, which we can live with.
    console.warn('[live-bot] persist failed', err);
  }
}

export function clearLiveBotGame(userId: number): void {
  try {
    db.prepare(`DELETE FROM live_bot_games WHERE user_id = ?`).run(userId);
  } catch (err) {
    console.warn('[live-bot] clear failed', err);
  }
}

export function loadLiveBotGame(userId: number): LiveBotRow | null {
  const row = db.prepare(`SELECT difficulty, user_color, time_control, pgn,
                                 white_time_ms, black_time_ms, last_move_at, updated_at
                          FROM live_bot_games WHERE user_id = ?`).get(userId) as LiveBotRow | undefined;
  return row ?? null;
}

/**
 * Summarise a stored game for the "you have a game waiting" card. A row whose
 * PGN no longer loads, or whose position is already finished, is reported as
 * nothing to resume — offering a game that can't be played is worse than
 * offering none.
 */
export function resumableSummary(row: LiveBotRow | null): Resumable | null {
  if (!row) return null;
  let ply = 0;
  try {
    const probe = new Chess();
    if (row.pgn.trim()) probe.loadPgn(row.pgn, { strict: false });
    if (probe.isGameOver()) return null;
    ply = probe.history().length;
  } catch {
    return null;
  }
  return {
    difficulty: row.difficulty,
    user_color: row.user_color,
    time_control: row.time_control,
    ply,
    updated_at: row.updated_at,
  };
}
