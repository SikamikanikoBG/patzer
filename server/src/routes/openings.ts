// Opening tree — a trie built from every analyzed game in the user's history,
// keyed by (ply, san-sequence). Each node tells the user "this is how often
// you reach this position, and how you score from it". Used by the frontend
// Repertoire view to surface "lines you play well" vs. "lines you bleed in".
//
// Depth is capped at ply 20 (10 full moves) — past that the tree splays into
// the hundreds of leaves per node and stops being a repertoire view.
// Children per node are capped at 8 so the wire payload stays bounded.

import { Hono } from 'hono';
import { Chess } from 'chess.js';
import { db } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { SCORING_VERSION } from '../chess/classifier.js';
import { lookupOpeningByEpd, fenToEpd } from '../chess/openings.js';
import type { Color } from '../types.js';

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

router.get('/tree', (c) => {
  const me = c.get('user');

  const rows = db.prepare(`
    SELECT g.pgn, g.user_color, g.result,
           CASE WHEN g.user_color='white' THEN a.accuracy_white ELSE a.accuracy_black END AS accuracy_user
    FROM analyses a JOIN games g ON g.id = a.game_id
    WHERE g.user_id = ? AND a.scoring_version >= ?
    ORDER BY g.end_time DESC, g.id DESC
  `).all(me.id, SCORING_VERSION) as GameRow[];

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

export default router;
