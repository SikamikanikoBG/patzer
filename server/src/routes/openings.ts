// Opening tree — a trie built from every analyzed game in the user's history,
// keyed by (ply, san-sequence). Each node tells the user "this is how often
// you reach this position, and how you score from it". Used by the frontend
// Repertoire view to surface "lines you play well" vs. "lines you bleed in".
//
// Depth is capped at ply 20 (10 full moves) — past that the tree splays into
// the hundreds of leaves per node and stops being a repertoire view.
// Children per node are capped at 8 so the wire payload stays bounded.

import { Hono } from 'hono';
import { z } from 'zod';
import { Chess } from 'chess.js';
import { db } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { SCORING_VERSION } from '../chess/classifier.js';
import { lookupOpeningByEpd, fenToEpd } from '../chess/openings.js';
import { masterStats } from '../chess/explorer.js';
import {
  TRAINER_LINES, LEARNED_AFTER, MAX_LINE_PLIES, MAX_REPERTOIRE_PLIES,
  replayLine, lineName, repertoireLine, recordMiss, removeMiss, queueSummary, dueReviews, answerReview, checkReview, dayOf,
} from '../chess/openingTrainer.js';
import type { AnalyzedMove, Color } from '../types.js';

const router = new Hono();
router.use('*', requireAuth);

const MAX_PLY = 20;
const MAX_CHILDREN = 8;

interface MutableNode {
  san: string;
  ply: number;
  fen: string;
  eco: string | null;
  opening_name: string | null;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  accSum: number;
  accN: number;
  children: Map<string, MutableNode>;
}

interface TreeNode {
  san: string;
  ply: number;
  fen: string;
  eco: string | null;
  opening_name: string | null;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  avg_accuracy: number | null;
  children: TreeNode[];
}

interface GameRow {
  pgn: string;
  user_color: Color | null;
  result: string | null;
  accuracy_user: number | null;
}

function makeNode(san: string, ply: number, fen: string): MutableNode {
  // EPD lookup is cheap (Map.get); attach eco/name on first creation so
  // repeated visits to the same node don't re-query.
  const opening = lookupOpeningByEpd(fenToEpd(fen));
  return {
    san,
    ply,
    fen,
    eco: opening?.eco ?? null,
    opening_name: opening?.name ?? null,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    accSum: 0,
    accN: 0,
    children: new Map(),
  };
}

function finalize(node: MutableNode): TreeNode {
  const children = Array.from(node.children.values())
    .sort((a, b) => b.played - a.played)
    .slice(0, MAX_CHILDREN)
    .map(finalize);
  return {
    san: node.san,
    ply: node.ply,
    fen: node.fen,
    eco: node.eco,
    opening_name: node.opening_name,
    played: node.played,
    wins: node.wins,
    draws: node.draws,
    losses: node.losses,
    avg_accuracy: node.accN > 0 ? Math.round((node.accSum / node.accN) * 10) / 10 : null,
    children,
  };
}

/** The games the tree is built from, newest first. */
function treeGames(userId: number): GameRow[] {
  return db.prepare(`
    SELECT g.pgn, g.user_color, g.result,
           CASE WHEN g.user_color='white' THEN a.accuracy_white ELSE a.accuracy_black END AS accuracy_user
    FROM analyses a JOIN games g ON g.id = a.game_id
    WHERE g.user_id = ? AND a.scoring_version >= ?
    ORDER BY g.end_time DESC, g.id DESC
  `).all(userId, SCORING_VERSION) as GameRow[];
}

router.get('/tree', (c) => {
  const me = c.get('user');

  const rows = treeGames(me.id);

  const root = makeNode('', 0, new Chess().fen());

  for (const r of rows) {
    const chess = new Chess();
    try {
      chess.loadPgn(r.pgn, { strict: false });
    } catch {
      continue;
    }
    const history = chess.history({ verbose: true });
    const replay = new Chess();

    // Per-game outcome from the user's perspective. Anything we don't
    // recognize as win/loss/draw is ignored for W/D/L bookkeeping.
    let win = 0, draw = 0, loss = 0;
    if (r.result === 'win') win = 1;
    else if (r.result === 'loss') loss = 1;
    else if (r.result === 'draw') draw = 1;

    const acc = typeof r.accuracy_user === 'number' ? r.accuracy_user : null;

    // Root counts every game.
    root.played++;
    root.wins += win; root.draws += draw; root.losses += loss;
    if (acc !== null) { root.accSum += acc; root.accN++; }

    let cursor: MutableNode = root;
    const upper = Math.min(history.length, MAX_PLY);
    for (let i = 0; i < upper; i++) {
      const move = history[i]!;
      replay.move({ from: move.from, to: move.to, promotion: move.promotion });
      const fen = replay.fen();
      const ply = i + 1;
      const key = move.san;
      let child = cursor.children.get(key);
      if (!child) {
        child = makeNode(move.san, ply, fen);
        cursor.children.set(key, child);
      }
      child.played++;
      child.wins += win; child.draws += draw; child.losses += loss;
      if (acc !== null) { child.accSum += acc; child.accN++; }
      cursor = child;
    }
  }

  return c.json({
    total_games: rows.length,
    root: finalize(root),
  });
});

// Master-game statistics for a position, proxied from the Lichess Opening
// Explorer (server-side: no CORS, one cache, one rate limit). See
// chess/explorer.ts. Returns { available: false } — never an error — when the
// upstream is unreachable so the UI can hide the panel instead of breaking.
router.get('/explorer', async (c) => {
  const fen = c.req.query('fen') ?? '';
  if (fen.length < 10 || fen.length > 120) return c.json({ error: 'invalid_fen' }, 400);
  const result = await masterStats(fen);
  if (!result.ok) {
    if (result.reason === 'invalid_fen') return c.json({ error: 'invalid_fen' }, 400);
    return c.json({ available: false, cached: result.cached });
  }
  c.header('Cache-Control', 'private, max-age=3600');
  return c.json({ available: true, cached: result.cached, ...result.stats });
});

// ---- Opening trainer (roadmap #6) — see chess/openingTrainer.ts ----------

// The browser's calendar day (?today= or { today }), see dayOf.
const todayOf = (v: unknown) => dayOf(typeof v === 'string' ? v : null);

// Classifications that make a move a habit worth losing, not drilling.
const FLAWS = new Set(['mistake', 'blunder', 'miss']);

router.get('/trainer', (c) => {
  const me = c.get('user');
  return c.json({ lines: TRAINER_LINES, learned_after: LEARNED_AFTER, ...queueSummary(me.id, todayOf(c.req.query('today'))) });
});

// A line from your own repertoire: the moves up to a tree node, continued the
// way your games most often went on — once for each color, so the page can
// preselect the side you actually reach this position with.
router.get('/trainer/repertoire', (c) => {
  const me = c.get('user');
  const raw = (c.req.query('moves') ?? '').trim();
  const prefix = raw ? raw.split(/\s+/) : [];
  if (prefix.length > MAX_REPERTOIRE_PLIES) return c.json({ error: 'invalid_line' }, 400);
  const replayed = replayLine(prefix);
  if (!replayed) return c.json({ error: 'invalid_line' }, 400);
  const sans = replayed.map((m) => m.san);

  // The same games as the tree, with the analysis' verdict on every move.
  const rows = db.prepare(`
    SELECT g.pgn, g.user_color, a.moves_json
    FROM analyses a JOIN games g ON g.id = a.game_id
    WHERE g.user_id = ? AND a.scoring_version >= ?
    ORDER BY g.end_time DESC, g.id DESC
  `).all(me.id, SCORING_VERSION) as { pgn: string; user_color: Color | null; moves_json: string }[];
  const byColor: Record<Color, { games: string[][]; flawed: boolean[][] }> = {
    white: { games: [], flawed: [] },
    black: { games: [], flawed: [] },
  };
  for (const r of rows) {
    if (r.user_color !== 'white' && r.user_color !== 'black') continue;
    const chess = new Chess();
    try { chess.loadPgn(r.pgn, { strict: false }); } catch { continue; }
    // A game from a custom position can't be a line from the start.
    if (chess.getHeaders().SetUp === '1') continue;
    const sans = chess.history().slice(0, MAX_REPERTOIRE_PLIES);
    let analysed: AnalyzedMove[] = [];
    try { analysed = JSON.parse(r.moves_json) as AnalyzedMove[]; } catch { /* no verdicts, then */ }
    byColor[r.user_color].games.push(sans);
    byColor[r.user_color].flawed.push(sans.map((san, i) => analysed[i]?.san === san && FLAWS.has(analysed[i]!.classification)));
  }
  const result = (color: Color) => {
    const line = repertoireLine(byColor[color].games, sans, undefined, undefined, { color, flawed: byColor[color].flawed });
    return { ...line, name: lineName(line.moves) };
  };
  return c.json({ white: result('white'), black: result('black') });
});

const missSchema = z.object({
  moves: z.array(z.string().min(1).max(12)).min(1).max(MAX_LINE_PLIES),
  color: z.enum(['white', 'black']),
  line_name: z.string().max(200).nullish(),
  today: z.string().max(10).optional(),
});

// The user missed the last move of `moves` — put it in the review queue.
router.post('/trainer/miss', async (c) => {
  const me = c.get('user');
  const parsed = missSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  const res = recordMiss(me.id, { moves: parsed.data.moves, color: parsed.data.color, lineName: parsed.data.line_name }, todayOf(parsed.data.today));
  if (res === 'invalid') return c.json({ error: 'invalid_line' }, 400);
  if (res === 'full') return c.json({ error: 'queue_full' }, 409);
  return c.json({ ok: true });
});

router.get('/trainer/review', (c) => {
  const me = c.get('user');
  return c.json({ items: dueReviews(me.id, todayOf(c.req.query('today'))) });
});

// "Remove from review": the move leaves the queue for good.
router.delete('/trainer/review/:id', (c) => {
  const me = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid_input' }, 400);
  if (!removeMiss(me.id, id)) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});

// Either the move played, or { reveal: true } for "show me the move". With
// `first`, a wrong move only says so ({ retry: true }) and one more try follows.
const answerSchema = z.union([
  z.object({ uci: z.string().regex(/^[a-h][1-8][a-h][1-8][nbrq]?$/i), first: z.boolean().optional(), today: z.string().max(10).optional() }),
  z.object({ reveal: z.literal(true), today: z.string().max(10).optional() }),
]);

router.post('/trainer/review/:id', async (c) => {
  const me = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid_input' }, 400);
  const parsed = answerSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  if ('uci' in parsed.data && parsed.data.first) {
    const right = checkReview(me.id, id, parsed.data.uci.toLowerCase());
    if (right === null) return c.json({ error: 'not_found' }, 404);
    if (!right) return c.json({ correct: false, retry: true });
  }
  const answer = answerReview(me.id, id, 'uci' in parsed.data ? parsed.data.uci.toLowerCase() : null, todayOf(parsed.data.today));
  if (!answer) return c.json({ error: 'not_found' }, 404);
  return c.json(answer);
});

export default router;
