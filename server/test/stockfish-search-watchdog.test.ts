import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// The engine module reaches for the real database on import.
const dir = mkdtempSync(join(tmpdir(), 'patzer-wd-'));
process.env.DB_PATH = join(dir, 'wd.db');

// A scripted UCI engine, not Stockfish: the real wedge is rare and
// nondeterministic, and reproducing it for real costs twelve pegged cores.
const FAKE = resolve(import.meta.dirname, 'fixtures/fake-engine.mjs');

type SfModule = typeof import('../src/chess/stockfish.js');
let Sf: SfModule;

beforeAll(async () => {
  Sf = await import('../src/chess/stockfish.js');
});

afterEach(() => {
  delete process.env.FAKE_ENGINE_MODE;
  delete process.env.STOCKFISH_SEARCH_IDLE_MS;
  delete process.env.STOCKFISH_SEARCH_TIMEOUT_MS;
  delete process.env.STOCKFISH_SEARCH_STOP_GRACE_MS;
});

// Keep the suite quick: the production defaults are seconds, and nothing here
// is testing the length of the grace itself.
function fastDeadlines(idleMs = '1000') {
  process.env.STOCKFISH_SEARCH_IDLE_MS = idleMs;
  process.env.STOCKFISH_SEARCH_STOP_GRACE_MS = '250';
}

/** Wait for `pid` to be gone, up to `ms`. Returns true if it went. */
async function waitGone(pid: number, ms = 3_000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (!alive(pid)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return !alive(pid);
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function engine(mode: string) {
  process.env.FAKE_ENGINE_MODE = mode;
  const e = new Sf.StockfishEngine(FAKE);
  await e.start();
  return e;
}

const pidOf = (e: unknown) => (e as { child: { pid: number } }).child.pid;

describe('search watchdog', () => {
  it('leaves a healthy search alone', async () => {
    fastDeadlines();
    const e = await engine('healthy');
    const ev = await e.evaluate('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 14);
    expect(ev.bestMoveUci).toBe('e2e4');
    expect(ev.depth).toBe(14);
    await e.quit();
  }, 10_000);

  it('recovers a silent search with stop, and keeps the shallower result', async () => {
    // What the real incident looked like: no bestmove for the `go`, but the
    // engine was sitting in read() on stdin the whole time, so `stop` lands.
    fastDeadlines();
    const e = await engine('wedge-honours-stop');
    const pid = pidOf(e);

    const t0 = Date.now();
    const ev = await e.evaluate('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 14);

    // Rescued rather than failed: a usable move at the depth it got to.
    expect(ev.bestMoveUci).toBe('d2d4');
    expect(ev.depth).toBe(7);
    expect(Date.now() - t0).toBeLessThan(5_000);
    // Still usable — `stop` is a normal part of UCI, not a fatal error.
    expect(alive(pid)).toBe(true);
    await e.quit();
  }, 10_000);

  it('rejects and kills an engine that will not answer stop', async () => {
    fastDeadlines();
    const e = await engine('wedge-ignores-stop');
    const pid = pidOf(e);

    await expect(
      e.evaluate('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 14),
    ).rejects.toThrow(/engine_search_timeout/);

    // The whole point: an engine we have written off must not keep running.
    // Before this watchdog existed the caller simply awaited forever, so the
    // quit() in its own finally never ran.
    expect(await waitGone(pid)).toBe(true);
  }, 20_000);

  it('stops a search that keeps talking but never lands', async () => {
    // The idle watchdog cannot see this one — info lines keep arriving — so the
    // total ceiling has to catch it.
    fastDeadlines('60000');
    process.env.STOCKFISH_SEARCH_TIMEOUT_MS = '5000';
    const e = await engine('chatty-never-lands');

    const t0 = Date.now();
    const ev = await e.evaluate('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 14);
    const ms = Date.now() - t0;

    expect(ev.bestMoveUci).toBe('e2e4');
    expect(ms).toBeGreaterThanOrEqual(4_500);
    expect(ms).toBeLessThan(8_000);
    await e.quit();
  }, 20_000);

  it('applies to evaluateMulti and bestMove too', async () => {
    fastDeadlines();
    const e = await engine('wedge-ignores-stop');
    await expect(e.evaluateMulti('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 14, 3))
      .rejects.toThrow(/engine_search_timeout/);

    const e2 = await engine('wedge-ignores-stop');
    await expect(e2.bestMove('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', { depth: 12 }))
      .rejects.toThrow(/engine_search_timeout/);
  }, 20_000);

  it('still unblocks a search when the engine is quit underneath it', async () => {
    fastDeadlines('60000');
    const e = await engine('wedge-ignores-stop');
    const search = e.evaluate('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 14)
      .then(() => null, (err: Error) => err);
    await new Promise((r) => setTimeout(r, 200));
    await e.quit();
    expect((await search)?.message).toBe('engine_terminated');
  }, 10_000);
});
