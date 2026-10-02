// PGN text → `games` rows: the "Import PGN" box on Game Review, Patzer's
// take on lichess.org/paste. Takes pasted text or the contents of a .pgn
// file, which may hold one game or many.

import { createHash } from 'node:crypto';
import { Chess } from 'chess.js';
import { db } from '../db.js';
import { classifyTimeControl, type TimeClass } from './timeClass.js';

/** A PGN game reduced to the columns Patzer stores. */
export interface PgnRow {
  external_id: string;
  pgn: string;
  white: string;
  black: string;
  result: string;
  time_control: string;
  time_class: TimeClass | null;
  end_time: string;
  user_color: 'white' | 'black' | null;
}

export type SkipReason = 'invalid' | 'variant' | 'custom_position' | 'no_moves';

/** Split a PGN database into single games. A game starts at a tag line that
 *  follows movetext; movetext without any tags is a game of its own. */
export function splitPgn(text: string): string[] {
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const games: string[] = [];
  let cur: string[] = [];
  let sawMoves = false;
  const flush = () => {
    const g = cur.join('\n').trim();
    if (g) games.push(g);
    cur = [];
    sawMoves = false;
  };
  for (const line of lines) {
    const s = line.trim();
    if (s.startsWith('[') && sawMoves) flush();
    if (s && !s.startsWith('[') && !s.startsWith('%')) sawMoves = true;
    cur.push(line);
  }
  flush();
  return games;
}

/** Normalise a PGN date ("2024.03.07", "2024.??.??") plus an optional time
 *  ("18:04:31") into an ISO timestamp, or null if the date is unusable. */
function pgnDate(date: string | undefined, time: string | undefined): string | null {
  const m = /^(\d{4})\.(\d{2}|\?\?)\.(\d{2}|\?\?)$/.exec((date ?? '').trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = m[2] === '??' ? 1 : Number(m[2]);
  const d = m[3] === '??' ? 1 : Number(m[3]);
  const t = /^(\d{2}):(\d{2}):(\d{2})$/.exec((time ?? '').trim());
  const ms = Date.UTC(y, mo - 1, d, t ? Number(t[1]) : 0, t ? Number(t[2]) : 0, t ? Number(t[3]) : 0);
  if (!Number.isFinite(ms) || y < 1400) return null;
  return new Date(ms).toISOString();
}

/** Parse one game. `names` are the importing user's own names (Patzer login,
 *  display name, Chess.com and Lichess usernames), matched case-insensitively
 *  against the White / Black tags to know which side the user played. */
export function toPgnRow(pgn: string, names: string[], now = new Date()): PgnRow | SkipReason {
  const chess = new Chess();
  // What gets stored — the analyzer loads it again, so it must parse.
  let stored = pgn.trim();
  try {
    chess.loadPgn(pgn, { strict: false });
  } catch {
    // Some tools write annotations chess.js rejects (a NAG after a comment,
    // say). Rather than drop the game, retry with comments and NAGs removed
    // and keep that cleaned-up version.
    try {
      chess.loadPgn(pgn.replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ').replace(/\$\d+/g, ' '), { strict: false });
      stored = chess.pgn();
    } catch {
      return 'invalid';
    }
  }
  const h = chess.getHeaders();
  // Standard chess only — the classifier and coach assume it.
  const variant = (h.Variant ?? '').trim().toLowerCase();
  if (variant && variant !== 'standard' && variant !== 'chess') return 'variant';
  // The analyzer replays from the initial position, so a game that starts
  // from a set-up position would be analysed as the wrong game.
  if (h.SetUp === '1' || h.FEN) return 'custom_position';
  const moves = chess.history();
  if (moves.length === 0) return 'no_moves';

  const white = h.White?.trim() && h.White !== '?' ? h.White.trim() : 'White';
  const black = h.Black?.trim() && h.Black !== '?' ? h.Black.trim() : 'Black';
  const own = new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean));
  const userColor: 'white' | 'black' | null =
    own.has(white.toLowerCase()) ? 'white' : own.has(black.toLowerCase()) ? 'black' : null;

  // Scored from the user's side; a game the user isn't in is scored from
  // White's, like the Chess.com and Lichess importers. "*" (unfinished) is
  // kept as-is.
  const tag = (h.Result ?? '*').trim();
  const side = userColor ?? 'white';
  const result =
    tag === '1/2-1/2' ? 'draw' :
    tag === '1-0' ? (side === 'white' ? 'win' : 'loss') :
    tag === '0-1' ? (side === 'black' ? 'win' : 'loss') :
    '*';

  const tc = (h.TimeControl ?? '').trim();
  const timeControl = tc && tc !== '-' && tc !== '?' ? tc : 'untimed';

  const endTime =
    pgnDate(h.EndDate, h.EndTime) ??
    pgnDate(h.UTCDate, h.UTCTime) ??
    pgnDate(h.Date, h.StartTime) ??
    now.toISOString();

  // Same players, same date, same moves → the same game, however the file
  // was formatted or annotated. Importing it twice must not add a copy.
  const external_id = 'pgn:' + createHash('sha256')
    .update([white, black, h.Date ?? '', h.Round ?? '', tag, moves.join(' ')].join('\n'))
    .digest('hex')
    .slice(0, 32);

  return {
    external_id,
    pgn: stored,
    white,
    black,
    result,
    time_control: timeControl,
    time_class: classifyTimeControl(timeControl),
    end_time: endTime,
    user_color: userColor,
  };
}

export interface PgnImportResult {
  /** Games added by this import. */
  imported: number;
  /** Games found in the text. */
  total: number;
  /** Games that were already stored. */
  duplicates: number;
  /** Games that can't be reviewed here, by reason. */
  skipped: Partial<Record<SkipReason, number>>;
  /** Ids of every importable game, new or already stored, in file order. */
  ids: number[];
}

export function importPgnGames(userId: number, text: string): PgnImportResult {
  const names = db.prepare(`
    SELECT u.username, p.display_name, p.chesscom_username, p.lichess_username
    FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ?
  `).get(userId) as Record<string, string | null> | undefined;
  const own = Object.values(names ?? {}).filter((n): n is string => typeof n === 'string');

  // Pasted games are never rated in Patzer's pool — only PvP games are.
  const insert = db.prepare(`
    INSERT INTO games (user_id, source, external_id, pgn, white, black, result, time_control, time_class, end_time, user_color, rated)
    VALUES (?, 'imported', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(user_id, source, external_id) DO NOTHING
  `);
  const existing = db.prepare(`SELECT id FROM games WHERE user_id = ? AND source = 'imported' AND external_id = ?`);

  const games = splitPgn(text);
  const out: PgnImportResult = { imported: 0, total: games.length, duplicates: 0, skipped: {}, ids: [] };
  db.transaction(() => {
    for (const pgn of games) {
      const row = toPgnRow(pgn, own);
      if (typeof row === 'string') {
        out.skipped[row] = (out.skipped[row] ?? 0) + 1;
        continue;
      }
      const r = insert.run(
        userId, row.external_id, row.pgn, row.white, row.black, row.result,
        row.time_control, row.time_class, row.end_time, row.user_color,
      );
      if (r.changes > 0) {
        out.imported++;
        out.ids.push(Number(r.lastInsertRowid));
      } else {
        out.duplicates++;
        const prev = existing.get(userId, row.external_id) as { id: number } | undefined;
        if (prev) out.ids.push(prev.id);
      }
    }
  })();
  return out;
}
