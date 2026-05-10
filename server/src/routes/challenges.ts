import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { notifyUser } from '../ws/lobby.js';

const router = new Hono();
router.use('*', requireAuth);

interface ChallengeRow {
  id: number;
  from_user_id: number; to_user_id: number;
  color: 'white' | 'black' | 'random';
  time_control: string;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
  game_id: number | null;
  created_at: string;
  from_username?: string; from_display_name?: string; from_avatar?: string;
  to_username?: string;   to_display_name?: string;   to_avatar?: string;
}

function loadChallenge(id: number): ChallengeRow | undefined {
  return db.prepare(`
    SELECT c.*,
      uf.username AS from_username, pf.display_name AS from_display_name, pf.avatar_emoji AS from_avatar,
      ut.username AS to_username,   pt.display_name AS to_display_name,   pt.avatar_emoji AS to_avatar
    FROM challenges c
    JOIN users uf ON uf.id = c.from_user_id JOIN profiles pf ON pf.user_id = uf.id
    JOIN users ut ON ut.id = c.to_user_id   JOIN profiles pt ON pt.user_id = ut.id
    WHERE c.id = ?
  `).get(id) as ChallengeRow | undefined;
}

function shapeChallenge(row: ChallengeRow) {
  return {
    id: row.id,
    color: row.color,
    time_control: row.time_control,
    status: row.status,
    game_id: row.game_id,
    created_at: row.created_at,
    from: { id: row.from_user_id, username: row.from_username, display_name: row.from_display_name, avatar_emoji: row.from_avatar },
    to:   { id: row.to_user_id,   username: row.to_username,   display_name: row.to_display_name,   avatar_emoji: row.to_avatar },
  };
}

const createSchema = z.object({
  to_user_id: z.number().int().positive(),
  color: z.enum(['white', 'black', 'random']).default('random'),
  time_control: z.enum(['untimed', 'bullet', 'blitz', 'rapid', 'classical']).default('rapid'),
});

router.post('/', async (c) => {
  const me = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  const { to_user_id, color, time_control } = parsed.data;
  if (to_user_id === me.id) return c.json({ error: 'cannot_challenge_self' }, 400);

  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(to_user_id);
  if (!target) return c.json({ error: 'user_not_found' }, 404);

  // Soft-cancel any prior pending challenge from me to them so we don't pile up.
  db.prepare(`UPDATE challenges SET status = 'cancelled'
              WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'`)
    .run(me.id, to_user_id);

  const r = db.prepare(`INSERT INTO challenges (from_user_id, to_user_id, color, time_control)
                        VALUES (?, ?, ?, ?)`)
    .run(me.id, to_user_id, color, time_control);
  const id = Number(r.lastInsertRowid);
  const row = loadChallenge(id)!;

  // Push to recipient if online
  notifyUser(to_user_id, { type: 'challenge_received', challenge: shapeChallenge(row) });

  return c.json({ challenge: shapeChallenge(row) });
});

router.get('/incoming', (c) => {
  const me = c.get('user');
  const rows = db.prepare(`
    SELECT c.*,
      uf.username AS from_username, pf.display_name AS from_display_name, pf.avatar_emoji AS from_avatar,
      ut.username AS to_username,   pt.display_name AS to_display_name,   pt.avatar_emoji AS to_avatar
    FROM challenges c
    JOIN users uf ON uf.id = c.from_user_id JOIN profiles pf ON pf.user_id = uf.id
    JOIN users ut ON ut.id = c.to_user_id   JOIN profiles pt ON pt.user_id = ut.id
    WHERE c.to_user_id = ? AND c.status = 'pending'
    ORDER BY c.created_at DESC
  `).all(me.id) as ChallengeRow[];
  return c.json({ challenges: rows.map(shapeChallenge) });
});

router.get('/outgoing', (c) => {
  const me = c.get('user');
  const rows = db.prepare(`
    SELECT c.*,
      uf.username AS from_username, pf.display_name AS from_display_name, pf.avatar_emoji AS from_avatar,
      ut.username AS to_username,   pt.display_name AS to_display_name,   pt.avatar_emoji AS to_avatar
    FROM challenges c
    JOIN users uf ON uf.id = c.from_user_id JOIN profiles pf ON pf.user_id = uf.id
    JOIN users ut ON ut.id = c.to_user_id   JOIN profiles pt ON pt.user_id = ut.id
    WHERE c.from_user_id = ? AND c.status = 'pending'
    ORDER BY c.created_at DESC
  `).all(me.id) as ChallengeRow[];
  return c.json({ challenges: rows.map(shapeChallenge) });
});

router.post('/:id/accept', (c) => {
  const me = c.get('user');
  const id = Number(c.req.param('id'));
  const row = loadChallenge(id);
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (row.to_user_id !== me.id) return c.json({ error: 'forbidden' }, 403);
  if (row.status !== 'pending') return c.json({ error: 'not_pending' }, 409);

  // Resolve color
  const finalColor: 'white' | 'black' = row.color === 'random'
    ? (Math.random() < 0.5 ? 'white' : 'black')
    : row.color;
  // Acceptor gets the picked color, challenger gets the opposite (if 'random')
  const challengerColor: 'white' | 'black' = finalColor === 'white' ? 'black' : 'white';

  // Create the underlying game pair (one row per user)
  const externalId = `pvp-${id}-${Date.now()}`;
  const startingPgn = ''; // empty until first move

  const insertGame = db.prepare(`
    INSERT INTO games (user_id, source, external_id, pgn, white, black, result, time_control, end_time, user_color, opponent_user_id)
    VALUES (?, 'pvp', ?, ?, ?, ?, NULL, ?, NULL, ?, ?)
  `);

  // White player's row
  const whitePlayerId = challengerColor === 'white' ? row.from_user_id : row.to_user_id;
  const blackPlayerId = challengerColor === 'white' ? row.to_user_id : row.from_user_id;
  const whiteName = challengerColor === 'white' ? row.from_display_name! : row.to_display_name!;
  const blackName = challengerColor === 'white' ? row.to_display_name! : row.from_display_name!;

  const r1 = insertGame.run(whitePlayerId, externalId, startingPgn, whiteName, blackName, row.time_control, 'white', blackPlayerId);
  insertGame.run(blackPlayerId, externalId, startingPgn, whiteName, blackName, row.time_control, 'black', whitePlayerId);
  const gameId = Number(r1.lastInsertRowid);

  db.prepare(`UPDATE challenges SET status = 'accepted', game_id = ? WHERE id = ?`).run(gameId, id);

  // Notify challenger so they navigate into the game
  notifyUser(row.from_user_id, {
    type: 'challenge_accepted',
    challenge_id: id,
    game_id: gameId,
    external_id: externalId,
    your_color: challengerColor,
    time_control: row.time_control,
  });

  return c.json({
    challenge_id: id,
    game_id: gameId,
    external_id: externalId,
    your_color: finalColor,
    time_control: row.time_control,
  });
});

router.post('/:id/decline', (c) => {
  const me = c.get('user');
  const id = Number(c.req.param('id'));
  const row = loadChallenge(id);
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (row.to_user_id !== me.id) return c.json({ error: 'forbidden' }, 403);
  if (row.status !== 'pending') return c.json({ error: 'not_pending' }, 409);

  db.prepare(`UPDATE challenges SET status = 'declined' WHERE id = ?`).run(id);
  notifyUser(row.from_user_id, { type: 'challenge_declined', challenge_id: id });
  return c.json({ ok: true });
});

router.delete('/:id', (c) => {
  const me = c.get('user');
  const id = Number(c.req.param('id'));
  const row = loadChallenge(id);
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (row.from_user_id !== me.id) return c.json({ error: 'forbidden' }, 403);
  if (row.status !== 'pending') return c.json({ error: 'not_pending' }, 409);

  db.prepare(`UPDATE challenges SET status = 'cancelled' WHERE id = ?`).run(id);
  notifyUser(row.to_user_id, { type: 'challenge_cancelled', challenge_id: id });
  return c.json({ ok: true });
});

export default router;
