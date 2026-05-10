// Achievements — a fixed catalog of milestones the user can unlock. Progress
// is computed live from the DB on every GET; the `achievements_unlocked` row
// is the latch that records the first unlock moment. Once unlocked, an
// achievement stays unlocked even if the underlying stat would no longer
// qualify (e.g. you wouldn't expect "first game" to disappear after a
// hypothetical delete).

import { Hono } from 'hono';
import { db } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { SCORING_VERSION } from '../chess/classifier.js';

const router = new Hono();
router.use('*', requireAuth);

type Category = 'milestone' | 'mastery' | 'tactics' | 'streaks';

interface CatalogEntry {
  id: string;
  title: string;
  description: string;
  icon: string;
  target: number;
  category: Category;
}

const CATALOG: CatalogEntry[] = [
  { id: 'first_game',      title: 'First Move',          description: 'Played your first game.',                         icon: 'Play',      target: 1,   category: 'milestone' },
  { id: 'first_win',       title: 'First Win',           description: 'Won your first game.',                            icon: 'Trophy',    target: 1,   category: 'milestone' },
  { id: 'centurion',       title: 'Centurion',           description: 'Played 100 games.',                               icon: 'Award',     target: 100, category: 'milestone' },
  { id: 'analyst',         title: 'Analyst',             description: 'Analyzed 10 games.',                              icon: 'BookOpen',  target: 10,  category: 'mastery' },
  { id: 'accurate_player', title: 'Accurate Player',     description: 'Scored 90% accuracy or higher in a single game.', icon: 'Crosshair', target: 1,   category: 'mastery' },
  { id: 'opening_explorer',title: 'Opening Explorer',    description: 'Played 10 different openings.',                   icon: 'Compass',   target: 10,  category: 'mastery' },
  { id: 'puzzle_master',   title: 'Puzzle Master',       description: 'Solved 50 puzzles.',                              icon: 'Target',    target: 50,  category: 'tactics' },
  { id: 'tactician',       title: 'Tactician',           description: '80% puzzle accuracy with at least 20 attempts.',  icon: 'Zap',       target: 20,  category: 'tactics' },
  { id: 'streaker_3',      title: 'Heating Up',          description: 'Win 3 games in a row.',                           icon: 'Flame',     target: 3,   category: 'streaks' },
  { id: 'streaker_5',      title: 'On Fire',             description: 'Win 5 games in a row.',                           icon: 'Flame',     target: 5,   category: 'streaks' },
  { id: 'streaker_10',     title: 'Unstoppable',         description: 'Win 10 games in a row.',                          icon: 'Flame',     target: 10,  category: 'streaks' },
];

interface Stats {
  games: number;
  wins: number;
  analyses: number;
  puzzleAttempts: number;
  puzzleSolved: number;
  bestAccuracyHit: boolean;
  distinctEco: number;
  longestStreak: number;
}

function computeStats(userId: number): Stats {
  const g = db.prepare(`
    SELECT COUNT(*) AS games,
           SUM(CASE WHEN result='win' THEN 1 ELSE 0 END) AS wins,
           COUNT(DISTINCT CASE WHEN eco IS NOT NULL THEN eco END) AS eco_count
    FROM games WHERE user_id = ?
  `).get(userId) as { games: number; wins: number | null; eco_count: number };

  const a = db.prepare(`
    SELECT COUNT(*) AS c FROM analyses a
    JOIN games gg ON gg.id = a.game_id
    WHERE gg.user_id = ?
  `).get(userId) as { c: number };

  const p = db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN solved=1 THEN 1 ELSE 0 END) AS solved
    FROM puzzle_attempts WHERE user_id = ?
  `).get(userId) as { total: number; solved: number | null };

  // Any analyzed game where the user's side scored >= 90 unlocks accurate_player.
  const acc = db.prepare(`
    SELECT 1 AS hit FROM analyses a
    JOIN games g ON g.id = a.game_id
    WHERE g.user_id = ? AND a.scoring_version >= ?
      AND ((g.user_color='white' AND a.accuracy_white >= 90)
        OR (g.user_color='black' AND a.accuracy_black >= 90))
    LIMIT 1
  `).get(userId, SCORING_VERSION) as { hit: number } | undefined;

  // Longest historical win streak — walk full result history once.
  interface ResRow { result: string | null }
  const recent = db.prepare(`
    SELECT result FROM games
    WHERE user_id = ? AND result IS NOT NULL
    ORDER BY end_time ASC, id ASC
  `).all(userId) as ResRow[];
  let longest = 0, run = 0;
  for (const r of recent) {
    if (r.result === 'win') { run++; if (run > longest) longest = run; }
    else run = 0;
  }

  return {
    games: g.games ?? 0,
    wins: g.wins ?? 0,
    analyses: a.c ?? 0,
    puzzleAttempts: p.total ?? 0,
    puzzleSolved: p.solved ?? 0,
    bestAccuracyHit: !!acc,
    distinctEco: g.eco_count ?? 0,
    longestStreak: longest,
  };
}

function progressFor(id: string, s: Stats): number {
  switch (id) {
    case 'first_game':       return Math.min(s.games, 1);
    case 'first_win':        return Math.min(s.wins, 1);
    case 'centurion':        return Math.min(s.games, 100);
    case 'analyst':          return Math.min(s.analyses, 10);
    case 'accurate_player':  return s.bestAccuracyHit ? 1 : 0;
    case 'opening_explorer': return Math.min(s.distinctEco, 10);
    case 'puzzle_master':    return Math.min(s.puzzleSolved, 50);
    case 'tactician': {
      // Only count attempts toward 20 once the 80% accuracy bar is cleared;
      // otherwise progress reads zero so the user knows accuracy matters too.
      if (s.puzzleAttempts < 1) return 0;
      const acc = s.puzzleSolved / s.puzzleAttempts;
      if (acc < 0.8) return 0;
      return Math.min(s.puzzleAttempts, 20);
    }
    case 'streaker_3':       return Math.min(s.longestStreak, 3);
    case 'streaker_5':       return Math.min(s.longestStreak, 5);
    case 'streaker_10':      return Math.min(s.longestStreak, 10);
  }
  return 0;
}

router.get('/', (c) => {
  const me = c.get('user');
  const stats = computeStats(me.id);

  // Existing unlocks — read once into a map keyed by achievement id.
  interface UnlockRow { achievement_id: string; unlocked_at: string }
  const unlockRows = db.prepare(`
    SELECT achievement_id, unlocked_at FROM achievements_unlocked WHERE user_id = ?
  `).all(me.id) as UnlockRow[];
  const unlocked = new Map<string, string>();
  for (const r of unlockRows) unlocked.set(r.achievement_id, r.unlocked_at);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO achievements_unlocked (user_id, achievement_id)
    VALUES (?, ?)
  `);

  const out = CATALOG.map((entry) => {
    const progress = progressFor(entry.id, stats);
    let unlockedAt = unlocked.get(entry.id) ?? null;
    // First-unlock latch: if progress just crossed the target, write the row
    // and reflect that in the response so the UI can fire a celebration.
    if (!unlockedAt && progress >= entry.target) {
      insert.run(me.id, entry.id);
      const row = db.prepare(`SELECT unlocked_at FROM achievements_unlocked WHERE user_id = ? AND achievement_id = ?`)
        .get(me.id, entry.id) as { unlocked_at: string } | undefined;
      unlockedAt = row?.unlocked_at ?? new Date().toISOString();
    }
    return {
      id: entry.id,
      title: entry.title,
      description: entry.description,
      icon: entry.icon,
      target: entry.target,
      progress,
      unlocked: !!unlockedAt,
      unlocked_at: unlockedAt,
      category: entry.category,
    };
  });

  return c.json({ achievements: out });
});

export default router;
