import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';

// The module under test opens the real database on import, so point it at a
// throwaway file first.
const dir = mkdtempSync(join(tmpdir(), 'patzer-tactics-'));
process.env.DB_PATH = join(dir, 'tactics.db');

type TacticsModule = typeof import('../src/chess/tactics.js');
let tactics: TacticsModule;
let db: typeof import('../src/db.js')['db'];

beforeAll(async () => {
  ({ db } = await import('../src/db.js'));
  tactics = await import('../src/chess/tactics.js');
  db.prepare(`INSERT INTO users (id, username, password_hash, role) VALUES (1, 'me', 'x', 'user'), (2, 'other', 'x', 'user')`).run();
});

afterAll(() => {
  try { db.close(); } catch { /* ignore */ }
  rmSync(dir, { recursive: true, force: true });
});

describe('the puzzle set', () => {
  it('has thousands of legal puzzles over the whole rating range, each id once', () => {
    const all = tactics.allPuzzles();
    expect(all.length).toBeGreaterThan(3000);
    expect(new Set(all.map((p) => p.id)).size).toBe(all.length);
    expect(all[0]!.rating).toBeLessThan(500);
    expect(all.at(-1)!.rating).toBeGreaterThan(2400);
    for (const p of all) {
      const chess = new Chess(p.fen);
      for (const uci of p.moves) {
        // Throws on an illegal move.
        chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined });
      }
      // The opponent moves first, the line ends with yours.
      expect(p.moves.length % 2, p.id).toBe(0);
    }
  }, 30_000); // replays ~20,000 moves — slow on a busy machine

  it('ships as one JSON file under 1 MB and leaves out the Learn puzzles', () => {
    const file = fileURLToPath(new URL('../src/chess/tacticsSet.json', import.meta.url));
    expect(statSync(file).size).toBeLessThan(1024 * 1024);
    // scripts/build-tactics-set.mjs skips the puzzles the lessons use — after
    // new lessons, run it again.
    const lessons = fileURLToPath(new URL('../../web/src/learn/content', import.meta.url));
    const inLessons = new Set<string>();
    for (const f of readdirSync(lessons).filter((n) => n.endsWith('.json'))) {
      for (const m of readFileSync(join(lessons, f), 'utf8').matchAll(/"src":\s*"([^"]+)"/g)) inLessons.add(m[1]!);
    }
    expect(inLessons.size).toBeGreaterThan(0);
    expect(tactics.allPuzzles().filter((p) => inLessons.has(p.id)).map((p) => p.id)).toEqual([]);
  });

  it('has puzzles for every theme filter', () => {
    for (const [theme, tags] of Object.entries(tactics.THEME_FILTERS)) {
      const n = tactics.allPuzzles().filter((p) => p.themes.some((t) => tags.includes(t))).length;
      expect(n, theme).toBeGreaterThan(100);
    }
  });
});

describe('picking and rating', () => {
  it('starts you at 1200 and picks a puzzle close to it', () => {
    expect(tactics.statsOf(1)).toMatchObject({ rating: 1200, provisional: true, played: 0, solved: 0 });
    const p = tactics.nextPuzzle(1, null, () => 0)!;
    expect(Math.abs(p.rating - 1200)).toBeLessThanOrEqual(75);
  });

  it('only picks puzzles of the chosen theme', () => {
    const p = tactics.nextPuzzle(1, 'fork', () => 0.5)!;
    expect(p.themes).toContain('fork');
  });

  it('rates the first try only, up for a solve and down for a miss', () => {
    const [a, b] = tactics.allPuzzles().filter((p) => p.rating > 1150 && p.rating < 1250);
    const won = tactics.recordAttempt(1, a!.id, true)!;
    expect(won.rated).toBe(true);
    expect(won.rating_after).toBeGreaterThan(won.rating_before);
    // A second go at the same puzzle changes nothing.
    const again = tactics.recordAttempt(1, a!.id, false)!;
    expect(again).toEqual({ rated: false, rating_before: won.rating_after, rating_after: won.rating_after });
    const lost = tactics.recordAttempt(1, b!.id, false)!;
    expect(lost.rating_after).toBeLessThan(lost.rating_before);
    expect(tactics.statsOf(1)).toMatchObject({ played: 2, solved: 1, best: Math.round(won.rating_after) });
    expect(tactics.statsOf(1).recent.map((r) => r.solved)).toEqual([false, true]);
    // Other profiles are untouched.
    expect(tactics.statsOf(2)).toMatchObject({ rating: 1200, played: 0 });
  });

  it('never gives you a puzzle you already tried', () => {
    const tried = new Set((db.prepare('SELECT puzzle_id FROM tactics_attempts WHERE user_id = 1').all() as { puzzle_id: string }[]).map((r) => r.puzzle_id));
    for (let i = 0; i < 20; i++) expect(tried.has(tactics.nextPuzzle(1, null, () => i / 20)!.id)).toBe(false);
  });

  it('refuses a puzzle that does not exist', () => {
    expect(tactics.recordAttempt(1, 'nope!', true)).toBeNull();
  });
});
