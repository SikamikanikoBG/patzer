import { Hono } from 'hono';
import { z } from 'zod';
import { streamSSE } from 'hono/streaming';
import { requireAuth } from '../auth/middleware.js';
import { llmConfigured } from '../coach/llm.js';
import { coachExplain, coachHint } from '../coach/explain.js';
import type { Audience, Classification, Language } from '../types.js';

const router = new Hono();
router.use('*', requireAuth);

router.get('/status', (c) => {
  return c.json({ configured: llmConfigured() });
});

const explainSchema = z.object({
  fen: z.string(),
  player: z.enum(['White', 'Black']),
  played_san: z.string(),
  best_san: z.string().nullable(),
  classification: z.enum(['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'forced', 'inaccuracy', 'mistake', 'blunder', 'miss']),
  cp_loss: z.number(),
  // Optional engine eval (cp, white-perspective) before/after — when provided,
  // the FACTS payload gains win-probability and a natural-language eval state.
  // Strong grounding for small models that otherwise hallucinate trained prose.
  eval_before_cp: z.number().nullable().optional(),
  eval_after_cp: z.number().nullable().optional(),
  pv_san: z.array(z.string()).optional(),
  history: z.array(z.string()).optional(),
  user_perspective: z.boolean().optional(),
  language: z.enum(['en', 'bg', 'es', 'de', 'ru', 'fa']).optional(),
  audience: z.enum(['kid', 'beginner', 'intermediate', 'advanced']).optional(),
});

router.post('/explain', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = explainSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  const lang: Language = parsed.data.language ?? user.profile.language;
  const aud: Audience = parsed.data.audience ?? user.profile.audience;
  const { language: _l, audience: _a, ...params } = parsed.data;

  return streamSSE(c, async (stream) => {
    try {
      // Generated in full and checked against the verdict before it is sent
      // (see coach/explain.ts), so it arrives in one piece, not token by token.
      const answer = await coachExplain(
        { ...params, classification: params.classification as Classification },
        user.id, lang, aud,
      );
      if (answer.actions.length) await stream.writeSSE({ event: 'actions', data: JSON.stringify(answer.actions) });
      await stream.writeSSE({ data: answer.text });
    } catch (err) {
      await stream.writeSSE({ event: 'error', data: err instanceof Error ? err.message : String(err) });
    }
    await stream.writeSSE({ event: 'done', data: '' });
  });
});

const hintReqSchema = z.object({
  fen: z.string(),
  history: z.array(z.string()).optional(),
  language: z.enum(['en', 'bg', 'es', 'de', 'ru', 'fa']).optional(),
  audience: z.enum(['kid', 'beginner', 'intermediate', 'advanced']).optional(),
});

router.post('/hint', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = hintReqSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  const lang: Language = parsed.data.language ?? user.profile.language;
  const aud: Audience = parsed.data.audience ?? user.profile.audience;

  return streamSSE(c, async (stream) => {
    try {
      const { actions } = await coachHint(
        parsed.data.fen, parsed.data.history ?? [], user.id, lang, aud,
        async (chunk) => { await stream.writeSSE({ data: chunk }); },
      );
      if (actions.length) await stream.writeSSE({ event: 'actions', data: JSON.stringify(actions) });
    } catch (err) {
      await stream.writeSSE({ event: 'error', data: err instanceof Error ? err.message : String(err) });
    }
    await stream.writeSSE({ event: 'done', data: '' });
  });
});

export default router;
