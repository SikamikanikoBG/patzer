// Automatic post-game review. When a game finishes, ws/play.ts calls
// kickAutoReview() right after writing the analysis row; this worker then
// writes the AI Game Review (prose) for every game that has an analysis but no
// cached review yet — so a finished game gets its full review without a second
// click. One worker runs at a time and kicks while it is busy coalesce into a
// single re-sweep, so a flurry of finished games never spawns N concurrent LLM
// pipelines.

import { db } from './db.js';
import { llmConfigured } from './coach/llm.js';
import { buildGameReview, REVIEW_PROSE_VERSION } from './coach/review.js';
import { rowToAnalysis, type AnalysisRow } from './routes/analyze.js';
import type { Audience, Language } from './types.js';

interface ReviewRow extends AnalysisRow {
  game_id: number;
  pgn: string;
  user_id: number;
  user_color: 'white' | 'black' | null;
}

let running = false;
let pending = false;

export function kickAutoReview(): void {
  if (running) {
    pending = true;
    return;
  }
  running = true;
  // setImmediate so the caller (the websocket end-of-game handler) has already
  // committed the analysis row before the sweep reads it.
  setImmediate(() => {
    void sweep()
      .catch((err) => console.error('[auto-review]', err))
      .finally(() => {
        running = false;
        if (pending) {
          pending = false;
          kickAutoReview();
        }
      });
  });
}

async function sweep(): Promise<void> {
  // No LLM configured means there is nothing to write — leave the review for
  // whenever the operator wires one up (the manual Review button still works).
  if (!llmConfigured()) return;

  const rows = db.prepare(`
    SELECT g.id AS game_id, g.pgn, g.user_id, g.user_color,
           a.depth, a.accuracy_white, a.accuracy_black,
           a.estimated_elo_white, a.estimated_elo_black,
           a.performance_white, a.performance_black,
           a.opening_eco, a.opening_name,
           a.key_moments_json, a.phase_split_json, a.moves_json
      FROM analyses a
      JOIN games g ON g.id = a.game_id
     WHERE a.prose_json IS NULL
     ORDER BY g.id ASC
  `).all() as ReviewRow[];

  for (const row of rows) {
    const profile = db.prepare('SELECT language, audience FROM profiles WHERE user_id = ?').get(row.user_id) as
      | { language: Language; audience: Audience }
      | undefined;
    const language = profile?.language ?? 'en';
    const audience = profile?.audience ?? 'intermediate';
    const userColor = row.user_color ?? 'white';
    try {
      const review = await buildGameReview({
        pgn: row.pgn,
        analysis: rowToAnalysis(row),
        language,
        audience,
        userColor,
      });
      db.prepare(`
        UPDATE analyses SET prose_json = ?, prose_version = ?, prose_lang = ?, prose_audience = ?
        WHERE game_id = ?
      `).run(JSON.stringify(review), REVIEW_PROSE_VERSION, language, audience, row.game_id);
    } catch (err) {
      // One bad game must not sink the sweep — log and move on. It'll be
      // retried the next time a game finishes (or on the next server start).
      console.error('[auto-review] game', row.game_id, err);
    }
  }
}
