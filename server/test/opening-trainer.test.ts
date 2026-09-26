import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The module under test opens the real database on import, so point it at a
// throwaway file first.
const dir = mkdtempSync(join(tmpdir(), 'patzer-opening-trainer-'));
process.env.DB_PATH = join(dir, 'trainer.db');

type TrainerModule = typeof import('../src/chess/openingTrainer.js');
type DbModule = typeof import('../src/db.js');
let trainer: TrainerModule;
let db: DbModule['db'];

const ME = 1;
const OTHER = 2;

beforeAll(async () => {
  ({ db } = await import('../src/db.js'));
  trainer = await import('../src/chess/openingTrainer.js');
  const add = db.prepare(`INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, 'x', 'user')`);
  add.run(ME, 'me');
  add.run(OTHER, 'other');
});

afterAll(() => {
  try { db.close(); } catch { /* ignore */ }
  rmSync(dir, { recursive: true, force: true });
});

/** Pretend a day went by: everything scheduled for tomorrow is due now. */
function nextDay() {
  db.prepare(`UPDATE opening_misses SET due_on = date('now') WHERE due_on IS NOT NULL`).run();
}

describe('built-in lines', () => {
  it('are all legal, uniquely named and short enough to drill', () => {
    const ids = new Set<string>();
    for (const line of trainer.TRAINER_LINES) {
      expect(ids.has(line.id), line.id).toBe(false);
      ids.add(line.id);
      const replayed = trainer.replayLine(line.moves);
      expect(replayed, line.id).not.toBeNull();
      // Written in chess.js' own spelling, so the browser's SAN comparison holds.
      expect(replayed!.map((m) => m.san), line.id).toEqual(line.moves);
      expect(line.moves.length, line.id).toBeLessThanOrEqual(trainer.MAX_LINE_PLIES);
      const own = line.moves.filter((_, i) => trainer.sideOfPly(i) === line.color).length;
      expect(own, line.id).toBeGreaterThanOrEqual(5);
    }
  });

  it('offer lines for both colors', () => {
    expect(trainer.TRAINER_LINES.some((l) => l.color === 'white')).toBe(true);
    expect(trainer.TRAINER_LINES.some((l) => l.color === 'black')).toBe(true);
  });
});

describe('replayLine', () => {
  it('returns null for an illegal move', () => {
    expect(trainer.replayLine(['e4', 'e5', 'Ke3'])).toBeNull();
    expect(trainer.replayLine(['e4', 'nonsense'])).toBeNull();
  });

  it('gives each move as UCI with the position before it', () => {
    const r = trainer.replayLine(['e4', 'e5', 'Nf3'])!;
    expect(r.map((m) => m.uci)).toEqual(['e2e4', 'e7e5', 'g1f3']);
    expect(r[0]!.fenBefore.startsWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w')).toBe(true);
  });
});

describe('repertoireLine', () => {
  const games = [
    ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'],
    ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6'],
    ['e4', 'e5', 'Nf3', 'd6', 'd4'],
    ['e4', 'c5', 'Nf3', 'd6'],
    ['d4', 'd5'],
  ];

  it('follows the continuation most games agree on', () => {
    expect(trainer.repertoireLine(games, [])).toEqual({ games: 5, moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'] });
  });

  it('always keeps the chosen moves, even when only one game reached them', () => {
    expect(trainer.repertoireLine(games, ['e4', 'c5'])).toEqual({ games: 1, moves: ['e4', 'c5'] });
  });

  it('breaks a tie towards the more recent game (games come newest first)', () => {
    expect(trainer.repertoireLine(games, ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'], 1).moves)
      .toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5']);
  });

  it('counts no games for a line you never reached', () => {
    expect(trainer.repertoireLine(games, ['c4'])).toEqual({ games: 0, moves: ['c4'] });
  });

  it('stops at the depth limit', () => {
    expect(trainer.repertoireLine(games, [], 2, 3).moves).toEqual(['e4', 'e5', 'Nf3']);
  });

  it('stops before your own move when the analysis calls it a mistake in most games', () => {
    // Both games that play 5.Bc4 have it marked as a mistake (ply index 4).
    const flawed = games.map((g, n) => g.map((_, i) => i === 4 && n < 2));
    expect(trainer.repertoireLine(games, [], 2, 20, { color: 'white', flawed }))
      .toEqual({ games: 5, moves: ['e4', 'e5', 'Nf3', 'Nc6'], stoppedBefore: 'Bc4' });
    // Only a minority marked: the line goes on.
    const once = games.map((g, n) => g.map((_, i) => i === 4 && n === 0));
    expect(trainer.repertoireLine(games, [], 2, 20, { color: 'white', flawed: once }).moves)
      .toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']);
    // The opponent's mistakes are theirs to make — a Black line still stops only at Black's moves.
    expect(trainer.repertoireLine(games, [], 2, 20, { color: 'black', flawed }).moves)
      .toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4']);
  });
});

describe('dayOf', () => {
  const now = new Date('2026-09-26T23:30:00Z');
  it('takes the browser’s date when it is within a day of UTC', () => {
    expect(trainer.dayOf('2026-09-27', now)).toBe('2026-09-27');
    expect(trainer.dayOf('2026-09-25', now)).toBe('2026-09-25');
  });
  it('falls back to the UTC date for anything else', () => {
    expect(trainer.dayOf(undefined, now)).toBe('2026-09-26');
    expect(trainer.dayOf('2026-10-30', now)).toBe('2026-09-26');
    expect(trainer.dayOf('27.09.2026', now)).toBe('2026-09-26');
    expect(trainer.dayOf('2026-13-45', now)).toBe('2026-09-26');
    expect(trainer.dayOf('2026-09-31', new Date('2026-09-30T12:00:00Z'))).toBe('2026-09-30');
  });
});

describe('lineName', () => {
  it('uses the deepest known opening name', () => {
    expect(trainer.lineName(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'])).toBe('Ruy Lopez: Morphy Defense');
    expect(trainer.lineName([])).toBeNull();
  });
});

describe('missed moves and the daily review queue', () => {
  const ruy = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'];

  it('refuses a miss on the opponent’s move or an illegal line', () => {
    expect(trainer.recordMiss(ME, { moves: ruy, color: 'black' })).toBe('invalid');
    expect(trainer.recordMiss(ME, { moves: ['e4', 'Ke7'], color: 'black' })).toBe('invalid');
    expect(trainer.recordMiss(ME, { moves: [], color: 'white' })).toBe('invalid');
    expect(trainer.queueSummary(ME)).toEqual({ due: 0, learning: 0, learned: 0 });
  });

  it('puts a missed move into today’s queue', () => {
    expect(trainer.recordMiss(ME, { moves: ruy, color: 'white', lineName: 'Ruy Lopez: Closed' })).toBe('ok');
    expect(trainer.queueSummary(ME)).toEqual({ due: 1, learning: 1, learned: 0 });

    const [item] = trainer.dueReviews(ME);
    expect(item).toMatchObject({ line_name: 'Ruy Lopez: Closed', line_id: 'ruy-lopez', color: 'white', moves: ['e4', 'e5', 'Nf3', 'Nc6'], misses: 1, streak: 0 });
    expect(item!.fen.split(' ')[1]).toBe('w');
    // The answer itself is not handed to the browser before it answers.
    expect(JSON.stringify(item)).not.toContain('Bb5');
  });

  it('keeps one entry when the same move is missed again', () => {
    trainer.recordMiss(ME, { moves: ruy, color: 'white', lineName: 'Ruy Lopez: Closed' });
    const items = trainer.dueReviews(ME);
    expect(items).toHaveLength(1);
    expect(items[0]!.misses).toBe(2);
  });

  it('keeps other people’s queues apart', () => {
    expect(trainer.dueReviews(OTHER)).toEqual([]);
    const id = trainer.dueReviews(ME)[0]!.id;
    expect(trainer.answerReview(OTHER, id, 'f1b5')).toBeNull();
  });

  it('checks a first try without giving the move away or rescheduling', () => {
    const id = trainer.dueReviews(ME)[0]!.id;
    expect(trainer.checkReview(ME, id, 'f1c4')).toBe(false);
    expect(trainer.checkReview(ME, id, 'f1b5')).toBe(true);
    expect(trainer.checkReview(OTHER, id, 'f1b5')).toBeNull();
    expect(trainer.dueReviews(ME)[0]).toMatchObject({ id, misses: 2, streak: 0 });
  });

  it('moves a wrong answer to tomorrow and starts it over', () => {
    const id = trainer.dueReviews(ME)[0]!.id;
    expect(trainer.answerReview(ME, id, 'f1c4')).toMatchObject({ correct: false, expected_san: 'Bb5', expected_uci: 'f1b5', streak: 0, learned: false });
    expect(trainer.queueSummary(ME)).toEqual({ due: 0, learning: 1, learned: 0 });
  });

  it('does not reschedule an item that is not due', () => {
    const id = (db.prepare(`SELECT id FROM opening_misses WHERE user_id = ?`).get(ME) as { id: number }).id;
    expect(trainer.answerReview(ME, id, 'f1b5')).toMatchObject({ correct: true, streak: 0, learned: false });
    expect(trainer.queueSummary(ME)).toEqual({ due: 0, learning: 1, learned: 0 });
  });

  it('counts a move as learned after three right answers on different days', () => {
    for (let day = 1; day <= trainer.LEARNED_AFTER; day++) {
      nextDay();
      const [item] = trainer.dueReviews(ME);
      expect(item, `day ${day}`).toBeDefined();
      const answer = trainer.answerReview(ME, item!.id, 'f1b5')!;
      expect(answer.correct).toBe(true);
      expect(answer.streak).toBe(day);
      expect(answer.learned).toBe(day === trainer.LEARNED_AFTER);
      expect(trainer.dueReviews(ME), `day ${day}`).toEqual([]);
    }
    nextDay();
    expect(trainer.dueReviews(ME)).toEqual([]);
    expect(trainer.queueSummary(ME)).toEqual({ due: 0, learning: 0, learned: 1 });
  });

  it('brings a learned move back when it is missed again', () => {
    trainer.recordMiss(ME, { moves: ruy, color: 'white' });
    expect(trainer.queueSummary(ME)).toEqual({ due: 1, learning: 1, learned: 0 });
  });

  it('names a line from the ECO map when none is given, and records Black’s misses too', () => {
    expect(trainer.recordMiss(ME, { moves: ['e4', 'e6', 'd4', 'd5', 'e5', 'c5'], color: 'black' })).toBe('ok');
    const french = trainer.dueReviews(ME).find((i) => i.color === 'black')!;
    expect(french.line_name).toBe('French: Advance');
    expect(french.line_id).toBeNull();
    expect(french.fen.split(' ')[1]).toBe('b');
  });

  it('counts "show me the move" as not knowing it', () => {
    nextDay();
    const french = trainer.dueReviews(ME).find((i) => i.color === 'black')!;
    expect(trainer.answerReview(ME, french.id, null)).toMatchObject({ correct: false, expected_san: 'c5', streak: 0, learned: false });
    expect(trainer.dueReviews(ME).find((i) => i.id === french.id)).toBeUndefined();
    const row = db.prepare(`SELECT misses, due_on > date('now') AS tomorrow FROM opening_misses WHERE id = ?`).get(french.id);
    expect(row).toEqual({ misses: 2, tomorrow: 1 });
  });

  it('accepts a promotion or an illegal move as an answer without crashing', () => {
    const id = trainer.dueReviews(ME)[0]!.id;
    expect(trainer.answerReview(ME, id, 'a7a8q')).toMatchObject({ correct: false });
  });

  it('uses the day it is given, so the queue turns over at the user’s midnight', () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const id = (db.prepare(`SELECT id FROM opening_misses WHERE user_id = ? AND due_on > date('now')`).get(ME) as { id: number }).id;
    expect(trainer.dueReviews(ME).find((i) => i.id === id)).toBeUndefined();
    expect(trainer.dueReviews(ME, tomorrow).find((i) => i.id === id)).toBeDefined();
    trainer.answerReview(ME, id, null, tomorrow);
    const row = db.prepare(`SELECT due_on FROM opening_misses WHERE id = ?`).get(id) as { due_on: string };
    expect(row.due_on).toBe(new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10));
  });

  it('removes a move from the queue, but only your own', () => {
    const id = (db.prepare(`SELECT id FROM opening_misses WHERE user_id = ?`).get(ME) as { id: number }).id;
    expect(trainer.removeMiss(OTHER, id)).toBe(false);
    expect(trainer.removeMiss(ME, id)).toBe(true);
    expect(db.prepare(`SELECT 1 FROM opening_misses WHERE id = ?`).get(id)).toBeUndefined();
  });

  it('stops taking new moves once the queue is full, but still updates known ones', () => {
    const insert = db.prepare(`INSERT INTO opening_misses (user_id, user_color, moves, position, expected_san, expected_uci) VALUES (?, 'white', '', ?, 'e4', 'e2e4')`);
    const have = (db.prepare(`SELECT COUNT(*) AS n FROM opening_misses WHERE user_id = ?`).get(OTHER) as { n: number }).n;
    db.transaction(() => { for (let i = have; i < trainer.MAX_MISSES_PER_USER; i++) insert.run(OTHER, `filler ${i}`); })();
    expect(trainer.recordMiss(OTHER, { moves: ruy, color: 'white' })).toBe('full');
    db.prepare(`DELETE FROM opening_misses WHERE user_id = ? AND position = 'filler 0'`).run(OTHER);
    expect(trainer.recordMiss(OTHER, { moves: ruy, color: 'white' })).toBe('ok');
    insert.run(OTHER, 'filler 0');
    expect(trainer.recordMiss(OTHER, { moves: ruy, color: 'white' })).toBe('ok');
    db.prepare(`DELETE FROM opening_misses WHERE user_id = ?`).run(OTHER);
  });
});
