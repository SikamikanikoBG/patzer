import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Chess } from 'chess.js';
import type { AnalysisResult, AnalyzedMove, Classification, KeyMomentSummary } from '../src/types.js';

// The written Game Review must know whose move it is talking about. Before
// v4 every key moment was described to the player as "you played …", so an
// opponent's blunder read as the player's own; and the summary got nothing
// but accuracy numbers, so it could only repeat them. These tests pin what
// the model now gets.

const dir = mkdtempSync(join(tmpdir(), 'patzer-review-'));
process.env.DB_PATH = join(dir, 'review.db');

type Review = typeof import('../src/coach/review.js');
let review: Review;
let restoreEngine: () => void;

// 1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6?? 4.Qxf7# — the player is White.
const SAN = ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'];
const CLS: Classification[] = ['book', 'book', 'inaccuracy', 'book', 'good', 'blunder', 'best'];
const EVAL: [number, number][] = [[20, 30], [30, 30], [30, -20], [-20, -20], [-20, 0], [0, 10000], [10000, 10000]];
const BEST: (string | null)[] = [null, null, 'Nf3', null, null, 'g6', null];

function buildMoves(): AnalyzedMove[] {
  const c = new Chess();
  return SAN.map((san, i) => {
    const fen_before = c.fen();
    const m = c.move(san);
    return {
      ply: i + 1, san, uci: m.from + m.to, fen_before, fen_after: c.fen(),
      eval_before_cp: EVAL[i]![0], eval_after_cp: EVAL[i]![1], mate_before: null, mate_after: null,
      best_move_uci: null, best_move_san: BEST[i] ?? san, best_pv: BEST[i] ? [BEST[i]!] : [],
      centipawn_loss: CLS[i] === 'blunder' ? 1000 : CLS[i] === 'inaccuracy' ? 50 : 0, classification: CLS[i]!,
    };
  });
}

function analysisOf(moves: AnalyzedMove[]): AnalysisResult {
  return {
    depth: 16, moves, accuracy_white: 91.7, accuracy_black: 40.2,
    estimated_elo_white: 1500, estimated_elo_black: 600, performance_white: null, performance_black: null,
    opening_eco: 'C20', opening_name: "King's Pawn Game: Wayward Queen Attack",
    key_moments: [], phase_split: null,
  };
}

const momentOf = (m: AnalyzedMove): KeyMomentSummary => ({
  ply: m.ply, side: m.ply % 2 === 1 ? 'white' : 'black', san: m.san, fen_before: m.fen_before,
  classification: m.classification, cp_loss: m.centipawn_loss, win_pct_delta: 50, best_san: m.best_move_san, best_pv: m.best_pv,
});

beforeAll(async () => {
  review = await import('../src/coach/review.js');
  // No Stockfish in tests: the coach's engine answers nothing and the facts
  // come from chess.js alone.
  const coaching = await import('../src/coach/coaching.js');
  const prev = coaching.setCoachEngine(async () => null);
  restoreEngine = () => coaching.setCoachEngine(prev);
});

afterAll(() => {
  restoreEngine?.();
  rmSync(dir, { recursive: true, force: true });
});

describe('Game Review: whose move', () => {
  it("describes the opponent's blunder as the opponent's, with how the player answered it", async () => {
    const moves = buildMoves();
    const facts = await review.keyMomentFacts(momentOf(moves[5]!), moves, 'white', 'en', 'intermediate');
    expect(facts.moment.who_moved).toBe('the opponent');
    expect(facts.moment.takeaway).toBeNull();
    // White's reply was the mate — the player took the chance.
    expect(facts.moment.your_answer?.verdict).toMatch(/top choice/);
    // "your pieces" are the player's (White's) even on Black's move.
    expect(facts.moment.your_pieces).toEqual(expect.arrayContaining([expect.stringMatching(/queen/)]));
    // Win chances are the mover's: Black's collapses after the blunder.
    expect(facts.moment.win_pct_after).toBeLessThan(10);
  });

  it("describes the player's own move as theirs", async () => {
    const moves = buildMoves();
    const facts = await review.keyMomentFacts(momentOf(moves[2]!), moves, 'white', 'bg', 'intermediate');
    expect(facts.moment.who_moved).toBe('ти');
    expect(facts.moment).not.toHaveProperty('your_answer');
  });

  it('gives the summary the story of the game, not just numbers', () => {
    const moves = buildMoves();
    const pgn = '[Result "1-0"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0';
    const { facts } = review.summaryFacts(analysisOf(moves), pgn, 'white', 'en', 'intermediate');
    expect(facts.result).toBe('you won');
    expect(facts.turning_point).toMatchObject({ move_number: 3, by: 'the opponent' });
    expect(facts.opponent_gifts).toHaveLength(1);
    expect(facts.opponent_gifts[0]!.your_answer).toMatchObject({ by: 'you', move_number: 4 });
    // The player's own costly moves only — the opponent's blunder is not among them.
    expect(facts.your_costliest_moves.every((m) => m.by === 'you')).toBe(true);
  });

  it('reads the result from the player’s side', () => {
    const moves = buildMoves();
    const { facts } = review.summaryFacts(analysisOf(moves), '[Result "1-0"]', 'black', 'bg', 'intermediate');
    expect(facts.result).toBe('ти загуби');
  });
});
