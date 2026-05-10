import { Hono } from 'hono';
import { db } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { onlineUserIds } from '../ws/lobby.js';

const router = new Hono();
router.use('*', requireAuth);

interface UserRow {
  id: number; username: string; display_name: string; avatar_emoji: string;
}

router.get('/users', (c) => {
  const me = c.get('user');
  const rows = db.prepare(`
    SELECT u.id, u.username, p.display_name, p.avatar_emoji
    FROM users u JOIN profiles p ON p.user_id = u.id
    WHERE u.id != ?
    ORDER BY p.display_name
  `).all(me.id) as UserRow[];
  const onlineSet = new Set(onlineUserIds());
  const users = rows.map((u) => ({ ...u, online: onlineSet.has(u.id) }));
  return c.json({ users });
});

export default router;
