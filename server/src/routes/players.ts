// Players directory + public profiles — the "social" surface of Patzer.
//
// Everything here is read-only and scoped to *other* users' public chess
// record (game counts, win-rate, ratings, recent games) plus the requester's
// own head-to-head against them. Games rows are per-user with `result` already
// stored from that user's perspective, so the aggregates are a straight
// GROUP BY — no double-counting across the two rows a PvP game produces.

import { Hono } from 'hono';
import { db } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { onlineUserIds } from '../ws/lobby.js';
import { GLICKO_DEFAULTS, PROVISIONAL_RD_THRESHOLD, PROVISIONAL_GAMES } from '../chess/glicko.js';
import type { TimeClass } from '../chess/timeClass.js';

const router = new Hono();
router.use('*', requireAuth);

interface DirRow {
  id: number; username: string; display_name: string; avatar_emoji: string; created_at: string;
  total: number; wins: number; losses: number; draws: number;
}
interface RatingRow { user_id: number; time_class: TimeClass; rating: number; rd: number; games_played: number; last_played_at: string | null }

function shapeRating(time_class: TimeClass, row: RatingRow | null) {
  const rating = row?.rating ?? GLICKO_DEFAULTS.rating;
  const rd = row?.rd ?? GLICKO_DEFAULTS.rd;
  const games = row?.games_played ?? 0;
  const provisional = rd >= PROVISIONAL_RD_THRESHOLD || games < PROVISIONAL_GAMES;
  return {
    time_class,
    rating: Math.round(rating),
    rd: Math.round(rd),
    games_played: games,
    last_played_at: row?.last_played_at ?? null,
    provisional,
  };
}

// GET /api/players — the directory. One row per user (self included, badged
// `is_me` so the UI can render "You" in the leaderboard), with lifetime counts
// and the player's best non-provisional-leaning rating across time classes.
router.get('/', (c) => {
  const me = c.get('user');
  const rows = db.prepare(`
    SELECT u.id, u.username, p.display_name, p.avatar_emoji, u.created_at,
      COUNT(g.id) AS total,
      SUM(CASE WHEN g.result = 'win'  THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN g.result = 'loss' THEN 1 ELSE 0 END) AS losses,
      SUM(CASE WHEN g.result = 'draw' THEN 1 ELSE 0 END) AS draws
    FROM users u
    JOIN profiles p ON p.user_id = u.id
    LEFT JOIN games g ON g.user_id = u.id AND g.result IS NOT NULL
    GROUP BY u.id
    ORDER BY p.display_name COLLATE NOCASE
  `).all() as DirRow[];

  // Best rating + most-recent activity per user, in one pass over ratings.
  const ratingRows = db.prepare(`
    SELECT user_id, rating, games_played, last_played_at FROM ratings
  `).all() as { user_id: number; rating: number; games_played: number; last_played_at: string | null }[];
  const bestByUser = new Map<number, { rating: number; last: string | null }>();
  for (const r of ratingRows) {
    const cur = bestByUser.get(r.user_id);
    // Only count a rating "established" enough to rank on once a few games exist;
    // a fresh 1200 placeholder shouldn't outrank a real 1100.
    const ratable = r.games_played > 0;
    if (!cur) {
      bestByUser.set(r.user_id, { rating: ratable ? r.rating : 0, last: r.last_played_at });
    } else {
      if (ratable && r.rating > cur.rating) cur.rating = r.rating;
      if (r.last_played_at && (!cur.last || r.last_played_at > cur.last)) cur.last = r.last_played_at;
    }
  }

  const onlineSet = new Set(onlineUserIds());
  const players = rows.map((u) => {
    const total = Number(u.total) || 0;
    const wins = Number(u.wins) || 0;
    const best = bestByUser.get(u.id);
    return {
      id: u.id,
      username: u.username,
      display_name: u.display_name,
      avatar_emoji: u.avatar_emoji,
      created_at: u.created_at,
      online: onlineSet.has(u.id),
      is_me: u.id === me.id,
      total,
      wins,
      losses: Number(u.losses) || 0,
      draws: Number(u.draws) || 0,
      win_rate: total > 0 ? Math.round((wins / total) * 100) : null,
      best_rating: best && best.rating > 0 ? Math.round(best.rating) : null,
      last_played_at: best?.last ?? null,
    };
  });

  return c.json({ players });
});

interface ResultRow { result: string }
interface AccRow { accuracy_white: number | null; accuracy_black: number | null; user_color: 'white' | 'black' | null }

// GET /api/players/:id — one player's public profile + my head-to-head vs them.
router.get('/:id', (c) => {
  const me = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid_id' }, 400);

  const player = db.prepare(`
    SELECT u.id, u.username, u.created_at, p.display_name, p.avatar_emoji, p.audience
    FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ?
  `).get(id) as { id: number; username: string; created_at: string; display_name: string; avatar_emoji: string; audience: string } | undefined;
  if (!player) return c.json({ error: 'not_found' }, 404);

  // ── Lifetime record ──────────────────────────────────────────────────────
  const counts = db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN result = 'win'  THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) AS losses,
      SUM(CASE WHEN result = 'draw' THEN 1 ELSE 0 END) AS draws
    FROM games WHERE user_id = ? AND result IS NOT NULL
  `).get(id) as { total: number; wins: number; losses: number; draws: number };

  // Average accuracy across analyzed games (this player's side only).
  const accs = db.prepare(`
    SELECT g.user_color, a.accuracy_white, a.accuracy_black
    FROM analyses a JOIN games g ON g.id = a.game_id WHERE g.user_id = ?
  `).all(id) as AccRow[];
  let accSum = 0; let accN = 0;
  for (const r of accs) {
    const v = r.user_color === 'white' ? r.accuracy_white : r.accuracy_black;
    if (typeof v === 'number') { accSum += v; accN++; }
  }
  const avg_accuracy = accN > 0 ? Math.round((accSum / accN) * 10) / 10 : null;

  // Current result streak (win/loss/draw), most recent backward.
  const recentResults = db.prepare(`
    SELECT result FROM games WHERE user_id = ? AND result IS NOT NULL
    ORDER BY end_time DESC, id DESC LIMIT 30
  `).all(id) as ResultRow[];
  let streakKind: 'win' | 'loss' | 'draw' | null = null;
  let streak = 0;
  for (const r of recentResults) {
    const k = (r.result === 'win' || r.result === 'loss' || r.result === 'draw') ? r.result as 'win'|'loss'|'draw' : null;
    if (!k) break;
    if (streakKind === null) { streakKind = k; streak = 1; }
    else if (k === streakKind) streak++;
    else break;
  }

  // ── Ratings (all four pools, default-filled) ─────────────────────────────
  const rRows = db.prepare(`SELECT user_id, time_class, rating, rd, games_played, last_played_at
                            FROM ratings WHERE user_id = ?`).all(id) as RatingRow[];
  const ratings: Record<TimeClass, ReturnType<typeof shapeRating>> = {
    bullet: shapeRating('bullet', null),
    blitz: shapeRating('blitz', null),
    rapid: shapeRating('rapid', null),
    daily: shapeRating('daily', null),
  };
  for (const r of rRows) ratings[r.time_class] = shapeRating(r.time_class, r);

  // ── Recent games (public view) ───────────────────────────────────────────
  const recent_games = db.prepare(`
    SELECT id, white, black, result, user_color, time_control, time_class, opening_name, end_time, source
    FROM games WHERE user_id = ? AND result IS NOT NULL
    ORDER BY end_time DESC NULLS LAST, id DESC LIMIT 10
  `).all(id);

  // ── My head-to-head vs them (from my perspective) ────────────────────────
  let head_to_head: { total: number; wins: number; losses: number; draws: number } | null = null;
  if (id !== me.id) {
    const h2h = db.prepare(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN result = 'win'  THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) AS losses,
        SUM(CASE WHEN result = 'draw' THEN 1 ELSE 0 END) AS draws
      FROM games WHERE user_id = ? AND opponent_user_id = ? AND result IS NOT NULL
    `).get(me.id, id) as { total: number; wins: number; losses: number; draws: number };
    head_to_head = {
      total: h2h.total ?? 0,
      wins: h2h.wins ?? 0,
      losses: h2h.losses ?? 0,
      draws: h2h.draws ?? 0,
    };
  }

  const total = counts.total ?? 0;
  const wins = counts.wins ?? 0;
  return c.json({
    player: {
      id: player.id,
      username: player.username,
      display_name: player.display_name,
      avatar_emoji: player.avatar_emoji,
      created_at: player.created_at,
      online: new Set(onlineUserIds()).has(player.id),
      is_me: player.id === me.id,
    },
    stats: {
      total,
      wins,
      losses: counts.losses ?? 0,
      draws: counts.draws ?? 0,
      win_rate: total > 0 ? Math.round((wins / total) * 100) : null,
      avg_accuracy,
      streak: streakKind ? { kind: streakKind, count: streak } : null,
    },
    ratings,
    recent_games,
    head_to_head,
  });
});

export default router;
