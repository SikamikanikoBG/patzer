import { Hono } from 'hono';
import { z } from 'zod';
import { streamSSE } from 'hono/streaming';
import { requireAuth } from '../auth/middleware.js';
import { chatStream, ollamaUrl } from '../coach/ollama.js';
import { systemPrompt, explainMovePrompt, hintPrompt } from '../coach/prompts.js';
import type { Audience, Classification, Language } from '../types.js';

const router = new Hono();
router.use('*', requireAuth);

router.get('/status', (c) => {
  return c.json({ configured: ollamaUrl() !== null });
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
  language: z.enum(['en', 'bg']).optional(),
  audience: z.enum(['kid', 'beginner', 'intermediate', 'advanced']).optional(),
});

router.post('/explain', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = explainSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  const lang: Language = parsed.data.language ?? user.profile.language;
  const aud: Audience = parsed.data.audience ?? user.profile.audience;

  const sys = systemPrompt(aud, lang);
  const usr = explainMovePrompt({
    fen: parsed.data.fen,
    player: parsed.data.player,
    played_san: parsed.data.played_san,
    best_san: parsed.data.best_san,
    classification: parsed.data.classification as Classification,
    cp_loss: parsed.data.cp_loss,
    eval_before_cp: parsed.data.eval_before_cp,
    eval_after_cp: parsed.data.eval_after_cp,
    pv_san: parsed.data.pv_san,
    history: parsed.data.history,
    user_perspective: parsed.data.user_perspective,
  }, lang, aud);

  return streamSSE(c, async (stream) => {
    try {
      await chatStream(
        [{ role: 'system', content: sys }, { role: 'user', content: usr }],
        async (chunk) => { await stream.writeSSE({ data: chunk }); },
        // Aggressive low temperature — we want faithful rendering of FACTS,
        // not creative chess prose. Small models hallucinate freely above 0.2.
        { temperature: 0.15 },
      );
    } catch (err) {
      await stream.writeSSE({ event: 'error', data: err instanceof Error ? err.message : String(err) });
    }
    await stream.writeSSE({ event: 'done', data: '' });
  });
});

const hintReqSchema = z.object({
  fen: z.string(),
  history: z.array(z.string()).optional(),
  language: z.enum(['en', 'bg']).optional(),
  audience: z.enum(['kid', 'beginner', 'intermediate', 'advanced']).optional(),
});

router.post('/hint', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => null);
  const parsed = hintReqSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  const lang: Language = parsed.data.language ?? user.profile.language;
  const aud: Audience = parsed.data.audience ?? user.profile.audience;

  const sys = systemPrompt(aud, lang);
  const usr = hintPrompt(parsed.data.fen, aud, lang, parsed.data.history);

  return streamSSE(c, async (stream) => {
    try {
      await chatStream(
        [{ role: 'system', content: sys }, { role: 'user', content: usr }],
        async (chunk) => { await stream.writeSSE({ data: chunk }); },
        { temperature: 0.3 },
      );
    } catch (err) {
      await stream.writeSSE({ event: 'error', data: err instanceof Error ? err.message : String(err) });
    }
    await stream.writeSSE({ event: 'done', data: '' });
  });
});

export default router;
