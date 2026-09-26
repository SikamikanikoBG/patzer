// Learn section (roadmap #7) — see learnProgress.ts.

import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { LESSON_ID, MAX_STEPS, hasRoomFor, listProgress, saveFinished, saveStep } from '../learnProgress.js';

const router = new Hono();
router.use('*', requireAuth);

router.get('/', (c) => {
  const me = c.get('user');
  return c.json({ lessons: listProgress(me.id) });
});

// Either where you are ({ step, flawed }) or that you finished ({ stars }).
const saveSchema = z.union([
  z.object({ stars: z.number().int().min(1).max(3) }),
  z.object({ step: z.number().int().min(0).max(MAX_STEPS), flawed: z.number().int().min(0).max(MAX_STEPS) }),
]);

router.post('/:lesson', async (c) => {
  const me = c.get('user');
  const lesson = c.req.param('lesson');
  if (lesson.length > 40 || !LESSON_ID.test(lesson)) return c.json({ error: 'invalid_lesson' }, 400);
  const parsed = saveSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  if (!hasRoomFor(me.id, lesson)) return c.json({ error: 'too_many_lessons' }, 409);
  const row = 'stars' in parsed.data
    ? saveFinished(me.id, lesson, parsed.data.stars)
    : saveStep(me.id, lesson, parsed.data.step, parsed.data.flawed);
  return c.json(row);
});

export default router;
