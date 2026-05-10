// Improvement Plan — a small set of weekly, personalized goals the user can
// chip away at. Each kind has its own progress query (live; no counters to
// drift). On GET, if the user has zero active goals we auto-seed a starter
// set so the page is never empty. POST /regenerate replaces all active goals
// with a fresh week.

import { Hono } from 'hono';
import { db } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { SCORING_VERSION } from '../chess/classifier.js';
import type { Color } from '../types.js';

const router = new Hono();
router.use('*', requireAuth);

type GoalKind = 'puzzles_solve' | 'opening_play' | 'review_games' | 'accuracy' | 'win_streak';

interface GoalRow {
  id: number;
  user_id: number;
  kind: string;
  title: string;
  description: string;
  target: number;
  metadata: string | null;
  status: 'active' | 'completed' | 'expired';
  created_at: string;
  completes_at: string;
  completed_at: string | null;
}

interface GoalOut {
  id: number;
  kind: GoalKind;
  title: string;
  description: string;
  target: number;
  progress: number;
  status: 'active' | 'completed' | 'expired';
  icon: string;
  created_at: string;
  completes_at: string;
  metadata: Record<string, unknown> | null;
}

const ICON_BY_KIND: Record<GoalKind, string> = {
  puzzles_solve: 'Target',
  opening_play: 'BookOpen',
  review_games: 'FileText',
  accuracy: 'TrendingUp',
  win_streak: 'Flame',
};

function parseMeta(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try { return JSON.parse(s) as Record<string, unknown>; } catch { return null; }
}

// Progress queries — each kind reads only events that happened on or after
// the goal's creation timestamp. Goals are weekly snapshots; pre-existing
// activity doesn't count toward the current week.
function computeProgress(userId: number, row: GoalRow): number {
  switch (row.kind as GoalKind) {
    case 'puzzles_solve': {
      const r = db.prepare(`
        SELECT COUNT(*) AS c FROM puzzle_attempts
        WHERE user_id = ? AND solved = 1 AND created_at >= ?
      `).get(userId, row.created_at) as { c: number };
      return r.c;
    }
    case 'opening_play': {
      const meta = parseMeta(row.metadata);
      const eco = typeof meta?.eco === 'string' ? meta.eco : null;
      const color = typeof meta?.color === 'string' ? meta.color : null;
      if (!eco || !color) return 0;
      const r = db.prepare(`
        SELECT COUNT(*) AS c FROM games
        WHERE user_id = ? AND eco = ? AND user_color = ?
          AND created_at >= ?
      `).get(userId, eco, color, row.created_at) as { c: number };
      return r.c;
    }
    case 'review_games': {
      const r = db.prepare(`
        SELECT COUNT(*) AS c FROM analyses a
        JOIN games g ON g.id = a.game_id
        WHERE g.user_id = ? AND a.created_at >= ?
      `).get(userId, row.created_at) as { c: number };
      return r.c;
    }
    case 'accuracy': {
      const meta = parseMeta(row.metadata);
      const min = typeof meta?.min_accuracy === 'number' ? meta.min_accuracy : 75;
      const r = db.prepare(`
        SELECT COUNT(*) AS c FROM analyses a
        JOIN games g ON g.id = a.game_id
        WHERE g.user_id = ? AND a.created_at >= ? AND a.scoring_version >= ?
          AND ((g.user_color='white' AND a.accuracy_white >= ?)
            OR (g.user_color='black' AND a.accuracy_black >= ?))
      `).get(userId, row.created_at, SCORING_VERSION, min, min) as { c: number };
      return r.c;
    }
    case 'win_streak': {
      // Current ongoing win streak across games whose end_time is on or after
      // the goal's creation. Walk most-recent first; the streak is the run
      // length until we hit anything not-a-win.
      interface ResRow { result: string | null }
      const rows = db.prepare(`
        SELECT result FROM games
        WHERE user_id = ? AND end_time IS NOT NULL AND end_time >= ?
          AND result IS NOT NULL
        ORDER BY end_time DESC, id DESC
      `).all(userId, row.created_at) as ResRow[];
      let streak = 0;
      for (const g of rows) {
        if (g.result === 'win') streak++;
        else break;
      }
      return streak;
    }
  }
  return 0;
}

// Pick which kinds to seed for this user. We always want 3-4 goals; choose
// kinds that match the user's data so the plan feels personalized:
//   - puzzles_solve and review_games are always relevant
//   - opening_play only if we can identify a weakest opening (>=3 plays)
//   - accuracy only if user has any analyzed game (otherwise it's a black box)
//   - win_streak fills the remaining slot
interface SeedSpec {
  kind: GoalKind;
  title: string;
  description: string;
  target: number;
  metadata: Record<string, unknown> | null;
}

function pickSeedGoals(userId: number): SeedSpec[] {
  const seeds: SeedSpec[] = [];

  seeds.push({
    kind: 'puzzles_solve',
    title: 'Solve 10 puzzles this week',
    description: 'Sharpen your tactics with personalized puzzles from your own games.',
    target: 10,
    metadata: null,
  });

  // Weakest-opening detection: any (eco, color) pair played at least 3 times
  // with the worst win-rate. Skip if user has fewer than 5 analyzed games.
  const analyzedCount = db.prepare(`
    SELECT COUNT(*) AS c FROM analyses a
    JOIN games g ON g.id = a.game_id
    WHERE g.user_id = ? AND a.scoring_version >= ?
  `).get(userId, SCORING_VERSION) as { c: number };

  if (analyzedCount.c >= 5) {
    interface WeakRow { eco: string; opening_name: string | null; color: Color; played: number; wins: number; score: number }
    const weak = db.prepare(`
      SELECT g.eco AS eco, g.opening_name AS opening_name, g.user_color AS color,
             COUNT(*) AS played,
             SUM(CASE WHEN g.result='win' THEN 1 ELSE 0 END) AS wins,
             ( (SUM(CASE WHEN g.result='win' THEN 1 ELSE 0 END) * 1.0
                + SUM(CASE WHEN g.result='draw' THEN 0.5 ELSE 0 END))
               / NULLIF(COUNT(*), 0) ) AS score
      FROM games g
      WHERE g.user_id = ? AND g.eco IS NOT NULL AND g.user_color IS NOT NULL
        AND g.result IS NOT NULL
      GROUP BY g.eco, g.user_color
      HAVING played >= 3
      ORDER BY score ASC, played DESC
      LIMIT 1
    `).get(userId) as WeakRow | undefined;

    if (weak && weak.score < 0.5) {
      const name = weak.opening_name ?? weak.eco;
      seeds.push({
        kind: 'opening_play',
        title: `Play 3 games in ${name}`,
        description: `You've been struggling with ${name} as ${weak.color}. Play it 3 more times this week to break the pattern.`,
        target: 3,
        metadata: { eco: weak.eco, opening_name: name, color: weak.color },
      });
    }
  }

  seeds.push({
    kind: 'review_games',
    title: 'Analyze 3 games this week',
    description: 'Run Stockfish over your latest games to spot recurring mistakes.',
    target: 3,
    metadata: null,
  });

  if (analyzedCount.c >= 1) {
    seeds.push({
      kind: 'accuracy',
      title: 'Score 75%+ accuracy in 5 games',
      description: 'Focus on accuracy: play 5 games where you stay above 75% on your side.',
      target: 5,
      metadata: { min_accuracy: 75 },
    });
  }

  // Fill the last slot with win_streak if we have fewer than 4 goals.
  if (seeds.length < 4) {
    seeds.push({
      kind: 'win_streak',
      title: 'Get a 3-game win streak',
      description: 'Stack three wins in a row to lock in your form.',
      target: 3,
      metadata: null,
    });
  }

  return seeds.slice(0, 4);
}

function insertSeeds(userId: number, seeds: SeedSpec[]): void {
  // 7-day window. Use SQLite's datetime so it matches the comparison column.
  const stmt = db.prepare(`
    INSERT INTO goals (user_id, kind, title, description, target, metadata, status, completes_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', datetime('now', '+7 days'))
  `);
  for (const s of seeds) {
    stmt.run(userId, s.kind, s.title, s.description, s.target, s.metadata ? JSON.stringify(s.metadata) : null);
  }
}

function listAndScore(userId: number): GoalOut[] {
  // Pull all goals for this user, then compute progress + complete-if-met.
  // We update status inside this same handler so the user sees the unlock
  // moment on the next refresh — no separate cron needed.
  const rows = db.prepare(`
    SELECT id, user_id, kind, title, description, target, metadata, status,
           created_at, completes_at, completed_at
    FROM goals WHERE user_id = ?
  `).all(userId) as GoalRow[];

  const out: GoalOut[] = [];
  for (const r of rows) {
    let progress = computeProgress(userId, r);
    let status = r.status;
    if (status === 'active' && progress >= r.target) {
      db.prepare(`UPDATE goals SET status='completed', completed_at=datetime('now') WHERE id = ?`).run(r.id);
      status = 'completed';
    }
    // Cap progress at target for the client UI so the bar doesn't overflow.
    if (progress > r.target) progress = r.target;
    out.push({
      id: r.id,
      kind: r.kind as GoalKind,
      title: r.title,
      description: r.description,
      target: r.target,
      progress,
      status,
      icon: ICON_BY_KIND[r.kind as GoalKind] ?? 'Target',
      created_at: r.created_at,
      completes_at: r.completes_at,
      metadata: parseMeta(r.metadata),
    });
  }

  // Active first, then completed (most recent first), then expired.
  const rank = (s: 'active' | 'completed' | 'expired'): number => s === 'active' ? 0 : s === 'completed' ? 1 : 2;
  out.sort((a, b) => {
    const r = rank(a.status) - rank(b.status);
    if (r !== 0) return r;
    return b.created_at.localeCompare(a.created_at);
  });
  return out;
}

router.get('/', (c) => {
  const me = c.get('user');
  const active = db.prepare(`SELECT COUNT(*) AS c FROM goals WHERE user_id = ? AND status = 'active'`).get(me.id) as { c: number };
  if (active.c === 0) {
    insertSeeds(me.id, pickSeedGoals(me.id));
  }
  return c.json({ goals: listAndScore(me.id) });
});

router.post('/regenerate', (c) => {
  const me = c.get('user');
  // Mark prior active goals as expired (preserves history of completed ones).
  db.prepare(`UPDATE goals SET status='expired' WHERE user_id = ? AND status = 'active'`).run(me.id);
  insertSeeds(me.id, pickSeedGoals(me.id));
  return c.json({ goals: listAndScore(me.id) });
});

export default router;
