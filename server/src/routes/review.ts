import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { db } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { llmUrl } from '../coach/llm.js';
import { buildGameReview, reviewCacheKey, type GameReview, REVIEW_PROSE_VERSION } from '../coach/review.js';
import type { AnalysisResult, AnalyzedMove, KeyMomentSummary, PhaseSplit } from '../types.js';

const router = new Hono();
router.use('*', requireAuth);

interface AnalysisRow {
  depth: number;
  accuracy_white: number;
  accuracy_black: number;
  estimated_elo_white: number | null;
  estimated_elo_black: number | null;
  performance_white: number | null;
  performance_black: number | null;
  opening_eco: string | null;
  opening_name: string | null;
  key_moments_json: string | null;
  phase_split_json: string | null;
  moves_json: string;
  prose_json: string | null;
  prose_version: number;
  prose_lang: string | null;
  prose_audience: string | null;
}

interface GameRow { user_color: 'white' | 'black' | null }

function rowToAnalysis(row: AnalysisRow): AnalysisResult {
  return {
    depth: row.depth,
    accuracy_white: row.accuracy_white,
    accuracy_black: row.accuracy_black,
    estimated_elo_white: row.estimated_elo_white,
    estimated_elo_black: row.estimated_elo_black,
    performance_white: row.performance_white,
    performance_black: row.performance_black,
    opening_eco: row.opening_eco,
    opening_name: row.opening_name,
    key_moments: row.key_moments_json ? (JSON.parse(row.key_moments_json) as KeyMomentSummary[]) : [],
    phase_split: row.phase_split_json ? (JSON.parse(row.phase_split_json) as PhaseSplit) : null,
    moves: JSON.parse(row.moves_json) as AnalyzedMove[],
  };
}

router.get('/:id/review', (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const game = db.prepare('SELECT user_color FROM games WHERE id = ? AND user_id = ?').get(id, user.id) as GameRow | undefined;
  if (!game) return c.json({ error: 'not_found' }, 404);
  const row = db.prepare(`SELECT prose_json, prose_version, prose_lang, prose_audience FROM analyses WHERE game_id = ?`).get(id) as
    | { prose_json: string | null; prose_version: number; prose_lang: string | null; prose_audience: string | null }
    | undefined;
  if (!row?.prose_json) return c.json({ review: null });
  // Validate the cached prose was generated for the same lang+audience+version.
  const wantKey = reviewCacheKey({ language: user.profile.language, audience: user.profile.audience });
  const haveKey = `${row.prose_version}|${row.prose_lang ?? ''}|${row.prose_audience ?? ''}`;
  if (wantKey !== haveKey) return c.json({ review: null, stale: true });
  try {
    return c.json({ review: JSON.parse(row.prose_json) as GameReview });
  } catch {
    return c.json({ review: null });
  }
});

router.post('/:id/review', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const game = db.prepare('SELECT pgn, user_color FROM games WHERE id = ? AND user_id = ?').get(id, user.id) as
    | { pgn: string; user_color: 'white' | 'black' | null }
    | undefined;
  if (!game) return c.json({ error: 'not_found' }, 404);
  const row = db.prepare(`SELECT depth, accuracy_white, accuracy_black,
    estimated_elo_white, estimated_elo_black, performance_white, performance_black,
    opening_eco, opening_name, key_moments_json, phase_split_json, moves_json,
    prose_json, prose_version, prose_lang, prose_audience
    FROM analyses WHERE game_id = ?`).get(id) as AnalysisRow | undefined;
  if (!row) return c.json({ error: 'analysis_required' }, 409);
  if (!llmUrl()) return c.json({ error: 'llm_not_configured' }, 503);

  const analysis = rowToAnalysis(row);
  const userColor = game.user_color ?? 'white';
  const language = user.profile.language;
  const audience = user.profile.audience;

  return streamSSE(c, async (stream) => {
    try {
      const review = await buildGameReview({
        pgn: game.pgn, analysis, language, audience, userColor,
        onProgress: async (ev) => {
          await stream.writeSSE({ event: 'progress', data: JSON.stringify(ev) });
        },
      });
      // Cache to DB
      db.prepare(`UPDATE analyses SET prose_json = ?, prose_version = ?, prose_lang = ?, prose_audience = ?
                  WHERE game_id = ?`)
        .run(JSON.stringify(review), REVIEW_PROSE_VERSION, language, audience, id);
      await stream.writeSSE({ event: 'done', data: JSON.stringify({ review }) });
    } catch (err) {
      await stream.writeSSE({ event: 'error', data: err instanceof Error ? err.message : String(err) });
    }
  });
});

export default router;
