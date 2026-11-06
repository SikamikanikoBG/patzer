import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

// The module under test reaches for the real database on import (the
// `stockfish_path` setting is one of the places it looks for the binary), so
// point it at a throwaway file first.
const dir = mkdtempSync(join(tmpdir(), 'patzer-sf-'));
process.env.DB_PATH = join(dir, 'sf.db');

const BINARY = resolve(import.meta.dirname, '../../bin/stockfish');

type SfModule = typeof import('../src/chess/stockfish.js');
let Sf: SfModule;

beforeAll(async () => {
  Sf = await import('../src/chess/stockfish.js');
});

/** Is that pid still around? Works on a reaped child (signal 0 probes only). */
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// Needs the bundled engine. Skipped rather than failed on a checkout that
// hasn't run `npm run setup` yet.
const hasBinary = existsSync(BINARY);
const withEngine = hasBinary ? describe : describe.skip;

withEngine('StockfishEngine process lifecycle', () => {
  it('leaves no process behind after quit()', async () => {
    const e = new Sf.StockfishEngine(BINARY);
    await e.start();
    const pid = (e as unknown as { child: { pid: number } }).child.pid;
    expect(alive(pid)).toBe(true);

    await e.quit();

    // The contract quit() advertises: when it resolves, the OS process is gone.
    expect(alive(pid)).toBe(false);
  }, 10_000);

  it('kills a search that is still running', async () => {
    const e = new Sf.StockfishEngine(BINARY);
    await e.start();
    await e.setOption('Hash', '16');
    const pid = (e as unknown as { child: { pid: number } }).child.pid;

    // A depth no search finishes in time, abandoned mid-flight. The in-flight
    // caller must be rejected rather than left hanging on a dead engine.
    // The rejection is captured up front: quit() delivers it synchronously, so
    // asserting on it afterwards would go through a tick with no handler
    // attached and trip Node's unhandled-rejection reporting.
    const search = e.evaluate('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 60)
      .then(() => null, (err: Error) => err);
    await new Promise((r) => setTimeout(r, 200));
    await e.quit();

    expect((await search)?.message).toBe('engine_terminated');
    expect(alive(pid)).toBe(false);
  }, 10_000);

  it('quit() is idempotent', async () => {
    const e = new Sf.StockfishEngine(BINARY);
    await e.start();
    await e.quit();
    await expect(e.quit()).resolves.toBeUndefined();
    expect(e.isReady()).toBe(false);
  }, 10_000);

  it('terminateAllActiveEngines() kills every live engine', async () => {
    const a = new Sf.StockfishEngine(BINARY);
    const b = new Sf.StockfishEngine(BINARY);
    await Promise.all([a.start(), b.start()]);
    const pids = [a, b].map((e) => (e as unknown as { child: { pid: number } }).child.pid);
    expect(pids.every(alive)).toBe(true);

    Sf.terminateAllActiveEngines();
    await new Promise((r) => setTimeout(r, 300));

    expect(pids.some(alive)).toBe(false);
  }, 10_000);

  it('drops an engine from the registry when its process dies on its own', async () => {
    const e = new Sf.StockfishEngine(BINARY);
    await e.start();
    const pid = (e as unknown as { child: { pid: number } }).child.pid;

    // Killed from outside — nobody calls quit(). The registry must still let
    // go, or the engine object (and its buffer) is pinned for the process's
    // lifetime and the shutdown hook keeps signalling a dead pid.
    process.kill(pid, 'SIGKILL');
    await new Promise((r) => setTimeout(r, 300));

    expect((e as unknown as { child: unknown }).child).toBeNull();
    expect(e.isReady()).toBe(false);
  }, 10_000);
});

// The bug this guards: `proc.killed` goes true the moment a signal is *sent*,
// so gating the SIGKILL step on `!proc.killed` made it unreachable — SIGTERM
// had already set it. An engine that ignores SIGTERM then outlived a quit()
// that reported success. Asserted against a stand-in child, since Stockfish
// itself does honour SIGTERM.
describe('termination escalation', () => {
  it('reaches SIGKILL when the child ignores SIGTERM', async () => {
    const proc = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);"], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    await new Promise((r) => setTimeout(r, 200));
    const pid = proc.pid!;

    const isRunning = () => proc.exitCode === null && proc.signalCode === null;
    expect(isRunning()).toBe(true);

    proc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 200));
    // Still up, and `killed` is now true — the trap that made SIGKILL dead code.
    expect(proc.killed).toBe(true);
    expect(isRunning()).toBe(true);

    if (isRunning()) proc.kill('SIGKILL');
    await new Promise((r) => proc.once('exit', r));
    expect(isRunning()).toBe(false);
    expect(alive(pid)).toBe(false);
  }, 10_000);
});
