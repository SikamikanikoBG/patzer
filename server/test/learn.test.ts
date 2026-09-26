import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The module under test opens the real database on import, so point it at a
// throwaway file first.
const dir = mkdtempSync(join(tmpdir(), 'patzer-learn-'));
process.env.DB_PATH = join(dir, 'learn.db');

type LearnModule = typeof import('../src/learnProgress.js');
type DbModule = typeof import('../src/db.js');
let learn: LearnModule;
let db: DbModule['db'];

const ME = 1;
const OTHER = 2;

beforeAll(async () => {
  ({ db } = await import('../src/db.js'));
  learn = await import('../src/learnProgress.js');
  const add = db.prepare(`INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, 'x', 'user')`);
  add.run(ME, 'me');
  add.run(OTHER, 'other');
});

afterAll(() => {
  try { db.close(); } catch { /* ignore */ }
  rmSync(dir, { recursive: true, force: true });
});

describe('learn progress', () => {
  it('remembers where an unfinished lesson stands', () => {
    learn.saveStep(ME, 'rook', 2, 0);
    const row = learn.saveStep(ME, 'rook', 3, 1);
    expect(row).toMatchObject({ lesson_id: 'rook', step: 3, flawed: 1, stars: 0, completed_at: null });
  });

  it('keeps the best result and the first completion, and starts the next run from the top', () => {
    const first = learn.saveFinished(ME, 'rook', 2);
    expect(first).toMatchObject({ step: 0, flawed: 0, stars: 2 });
    expect(first.completed_at).not.toBeNull();

    // A second, better run.
    learn.saveStep(ME, 'rook', 4, 0);
    expect(learn.saveFinished(ME, 'rook', 3).stars).toBe(3);
    // A worse run afterwards never takes stars away.
    const worse = learn.saveFinished(ME, 'rook', 1);
    expect(worse.stars).toBe(3);
    expect(worse.completed_at).toBe(first.completed_at);
  });

  it('is kept per profile', () => {
    learn.saveFinished(OTHER, 'knight', 3);
    expect(learn.listProgress(ME).map((r) => r.lesson_id)).toEqual(['rook']);
    expect(learn.listProgress(OTHER).map((r) => r.lesson_id)).toEqual(['knight']);
  });

  it('counts only finished lessons for the achievements', () => {
    learn.saveStep(ME, 'bishop', 1, 0);
    learn.saveFinished(ME, 'queen', 2);
    expect(learn.learnTotals(ME)).toEqual({ lessons: 2, stars: 5 });
  });

  it('accepts only content-style lesson ids', () => {
    expect(learn.LESSON_ID.test('mate-in-one')).toBe(true);
    for (const bad of ['', 'Rook', 'rook_1', '-rook', 'rook-', '../x', 'a b']) {
      expect(learn.LESSON_ID.test(bad), bad).toBe(false);
    }
  });

  it('stops taking new lessons at the limit, but keeps updating known ones', () => {
    const insert = db.prepare(`INSERT INTO learn_progress (user_id, lesson_id, step, flawed) VALUES (?, ?, 0, 0)`);
    const have = (db.prepare('SELECT COUNT(*) AS n FROM learn_progress WHERE user_id = ?').get(OTHER) as { n: number }).n;
    db.transaction(() => { for (let i = have; i < learn.MAX_LESSONS_PER_USER; i++) insert.run(OTHER, `filler-${i}`); })();
    expect(learn.hasRoomFor(OTHER, 'brand-new')).toBe(false);
    expect(learn.hasRoomFor(OTHER, `filler-${learn.MAX_LESSONS_PER_USER - 1}`)).toBe(true);
    expect(learn.hasRoomFor(ME, 'brand-new')).toBe(true);
    db.prepare('DELETE FROM learn_progress WHERE user_id = ?').run(OTHER);
  });
});
