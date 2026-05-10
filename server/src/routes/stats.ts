import { Hono } from 'hono';
import { db } from '../db.js';
import { requireAuth } from '../auth/middleware.js';

const router = new Hono();
router.use('*', requireAuth);

interface ResultRow { result: string }
interface AccRow { accuracy_white: number | null; accuracy_black: number | null; user_color: 'white' | 'black' | null }

router.get('/me', (c) => {
  const me = c.get('user');

  const counts = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) AS losses,
      SUM(CASE WHEN result = 'draw' THEN 1 ELSE 0 END) AS draws
    FROM games WHERE user_id = ? AND result IS NOT NULL
  `).get(me.id) as { total: number; wins: number; losses: number; draws: number };

  // Average accuracy across analyses (player's side)
  const accs = db.prepare(`
    SELECT g.user_color, a.accuracy_white, a.accuracy_black
    FROM analyses a JOIN games g ON g.id = a.game_id
    WHERE g.user_id = ?
  `).all(me.id) as AccRow[];
  let accSum = 0; let accN = 0;
  for (const r of accs) {
    const v = r.user_color === 'white' ? r.accuracy_white : r.accuracy_black;
    if (typeof v === 'number') { accSum += v; accN++; }
  }
  const avg_accuracy = accN > 0 ? Math.round((accSum / accN) * 10) / 10 : null;

  // Streak: count consecutive results (win or loss) from most recent backward
  const recent = db.prepare(`SELECT result FROM games WHERE user_id = ? AND result IS NOT NULL ORDER BY end_time DESC, id DESC LIMIT 30`).all(me.id) as ResultRow[];
  let streakKind: 'win' | 'loss' | 'draw' | null = null;
  let streak = 0;
  for (const r of recent) {
    const k = (r.result === 'win' || r.result === 'loss' || r.result === 'draw') ? r.result as 'win'|'loss'|'draw' : null;
    if (!k) break;
    if (streakKind === null) { streakKind = k; streak = 1; }
    else if (k === streakKind) streak++;
    else break;
  }

  return c.json({
    total: counts.total ?? 0,
    wins: counts.wins ?? 0,
    losses: counts.losses ?? 0,
    draws: counts.draws ?? 0,
    avg_accuracy,
    streak: streakKind ? { kind: streakKind, count: streak } : null,
  });
});

export default router;
