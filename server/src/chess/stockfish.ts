import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../config.js';
import { getSetting } from '../db.js';

function discoverStockfishPath(): string | null {
  // Only well-known absolute paths and the explicit user hint are accepted.
  // We deliberately do NOT fall back to a bare "stockfish" PATH lookup — on a
  // host where someone has put a malicious `stockfish` earlier in $PATH, that
  // would silently launch attacker code with the server's privileges. If the
  // binary isn't in one of these locations, the operator must set
  // STOCKFISH_PATH (env) or stockfish_path (Admin → System).
  const candidates = [
    config.stockfishPathHint,
    getSetting('stockfish_path') || undefined,
    resolve(config.projectRoot, 'bin', process.platform === 'win32' ? 'stockfish.exe' : 'stockfish'),
    '/usr/games/stockfish',
    '/usr/bin/stockfish',
    '/usr/local/bin/stockfish',
    '/opt/homebrew/bin/stockfish',
  ].filter((p): p is string => Boolean(p));

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

// UCI commands are line-delimited. Any FEN or move string that smuggles a
// newline could inject arbitrary commands at the engine. chess.js never
// produces these today, but we assert at the boundary so a future caller
// can't regress us into the bug.
function assertNoNewline(s: string, label: string): void {
  if (/[\r\n]/.test(s)) throw new Error(`stockfish: ${label} contains newline`);
}

export interface EngineEval {
  cp: number | null; // centipawns from side-to-move's perspective
  mate: number | null; // moves to mate (positive = side-to-move mates)
  bestMoveUci: string | null;
  pv: string[]; // principal variation in UCI
  depth: number;
}

// One MultiPV candidate (line). cp/mate are from side-to-move's perspective —
// same convention as EngineEval — so callers can compare candidates directly.
export interface PvCandidate {
  cp: number | null;
  mate: number | null;
  pv: string[]; // UCI moves, first entry is the candidate move itself
  multipv: number; // 1-based rank
}

export interface EngineMultiEval extends EngineEval {
  candidates: PvCandidate[]; // sorted by multipv ascending; index 0 == best
}

/**
 * After a deadline we send `stop`; this is how long the `bestmove` that should
 * follow it may take before we write the engine off. Worth raising on hardware
 * where unwinding a search with many threads and a large hash is slow.
 */
function searchStopGraceMs(): number {
  return Math.max(100, Number(process.env.STOCKFISH_SEARCH_STOP_GRACE_MS) || 3_000);
}

/** Longest a running search may say nothing at all before we step in. */
function searchIdleMs(): number {
  return Math.max(1_000, Number(process.env.STOCKFISH_SEARCH_IDLE_MS) || 20_000);
}

/** Hard ceiling on one search, however talkative the engine is. */
function searchTotalMs(): number {
  return Math.max(5_000, Number(process.env.STOCKFISH_SEARCH_TIMEOUT_MS) || 600_000);
}

// Is the OS process still running? A child killed by a signal keeps
// `exitCode === null` forever (the status lands in `signalCode` instead), and
// `killed` only means "a signal was successfully *sent*" — neither alone is a
// liveness check, and `killed` in particular must never gate an escalation:
// SIGTERM sets it, which would make the SIGKILL below unreachable.
function isRunning(proc: ChildProcessWithoutNullStreams): boolean {
  return proc.exitCode === null && proc.signalCode === null;
}

// Every started engine, until its process is confirmed gone. The last line of
// defence: on server shutdown or a `tsx watch` reload these children would
// otherwise survive us and keep burning a core each. Entries are removed in
// exactly one place — the child's own `exit` event — so an engine that dies on
// its own (crash, OOM-kill, external SIGKILL) doesn't pin itself here forever.
const activeStockfishEngines = new Set<StockfishEngine>();

/** SIGKILL every engine whose process is still up. Sync — safe on `exit`. */
export function terminateAllActiveEngines(): void {
  for (const engine of activeStockfishEngines) engine.killNow();
  activeStockfishEngines.clear();
}

export class StockfishEngine {
  readonly kind = 'local' as const;
  // The handle callers talk to; quit() clears it so no further UCI goes out.
  private proc: ChildProcessWithoutNullStreams | null = null;
  // The same child, held until its `exit` fires. quit() must not drop this:
  // while the process is still winding down it has to stay reachable from the
  // shutdown hook, or a slow teardown during a server stop leaks an orphan.
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private waiters: ((line: string) => void)[] = [];
  // Reject callbacks for in-flight evaluate()/bestMove() promises. quit() walks
  // this set so callers never deadlock when the engine dies mid-search.
  private deathHandlers = new Set<(err: Error) => void>();
  private readonly path: string;
  private ready = false;

  constructor(path?: string) {
    const p = path ?? discoverStockfishPath();
    if (!p) throw new Error('Stockfish binary not found. Run setup.ps1 or set STOCKFISH_PATH.');
    this.path = p;
  }

  static async test(path?: string): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
    let e: StockfishEngine | null = null;
    try {
      e = new StockfishEngine(path);
      await e.start();
      const name = await e.name();
      return { ok: true, name };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      if (e) await e.quit();
    }
  }

  async start(): Promise<void> {
    const proc = spawn(this.path, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = proc;
    this.child = proc;
    activeStockfishEngines.add(this);
    // The only place an engine leaves the registry. Covers quit() *and* a
    // process that dies without us asking (crash, OOM-kill, outside SIGKILL),
    // which otherwise kept the engine object — and its buffer — alive for the
    // lifetime of the server.
    proc.once('exit', () => {
      this.child = null;
      this.ready = false;
      activeStockfishEngines.delete(this);
    });
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk: string) => this.onData(chunk));
    proc.on('error', (err) => console.error('[stockfish]', err));
    await this.send('uci');
    await this.waitFor((l) => l === 'uciok');
    this.ready = true;
  }

  /** Sync, unconditional SIGKILL. Used by the process-exit hook. */
  killNow(): void {
    const proc = this.child;
    if (!proc || !isRunning(proc)) return;
    try { proc.kill('SIGKILL'); } catch { /* ignore */ }
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, '');
      this.buffer = this.buffer.slice(idx + 1);
      const waiters = this.waiters;
      this.waiters = [];
      for (const w of waiters) w(line);
    }
  }

  private send(cmd: string): Promise<void> {
    return new Promise((res, rej) => {
      if (!this.proc) return rej(new Error('engine not started'));
      this.proc.stdin.write(cmd + '\n', (err) => (err ? rej(err) : res()));
    });
  }

  private waitFor(predicate: (line: string) => boolean, timeoutMs = 30_000): Promise<string> {
    return new Promise((resolveLine, rejectLine) => {
      const t = setTimeout(() => rejectLine(new Error('engine timeout')), timeoutMs);
      const check = (line: string) => {
        if (predicate(line)) {
          clearTimeout(t);
          resolveLine(line);
        } else {
          this.waiters.push(check);
        }
      };
      this.waiters.push(check);
    });
  }

  async setOption(name: string, value: string | number): Promise<void> {
    await this.send(`setoption name ${name} value ${value}`);
  }

  async newGame(): Promise<void> {
    await this.send('ucinewgame');
    await this.send('isready');
    await this.waitFor((l) => l === 'readyok');
  }

  async name(): Promise<string> {
    await this.send('uci');
    const line = await this.waitFor((l) => l.startsWith('id name') || l === 'uciok');
    if (line.startsWith('id name')) return line.replace('id name ', '');
    return 'Stockfish';
  }

  /**
   * Wait out one `go`. `onLine` gets every line and returns true once it has
   * seen the one that ends the search (`bestmove`); anything else keeps us
   * waiting. Resolves when the search is over, rejects if the engine has to be
   * written off.
   *
   * Why this exists: a search used to be awaited with no deadline whatsoever.
   * Stockfish 19 on twelve threads was seen to take a `go depth 14` and never
   * answer — twelve threads spinning, the engine's own main thread back to
   * reading stdin as if nothing was pending. The caller then awaits forever,
   * and a caller's `finally { engine.quit() }` never runs while the await above
   * it never returns, so nothing reaped it: one wedged search held twelve cores
   * for five hours, 61 hours of CPU.
   *
   * Two deadlines, because a healthy search can legitimately be very long but
   * is never quiet — it prints an `info` line each time it finishes a depth:
   *   - idle: nothing said for a while. The fast signal, and tolerant of deep
   *     searches on slow hardware.
   *   - total: the backstop for an engine that keeps talking and never lands.
   *
   * Either one first sends `stop`, which is how UCI ends a search and what the
   * wedged engine above was in fact sitting ready to read. If a `bestmove`
   * follows we hand back the shallower result rather than failing the caller.
   * Only an engine that won't even answer `stop` is rejected — and then killed,
   * since whatever it is doing, it is doing it with our cores.
   */
  private awaitSearch(onLine: (line: string) => boolean): Promise<void> {
    const idleMs = searchIdleMs();
    const totalMs = searchTotalMs();
    return new Promise<void>((res, rej) => {
      let settled = false;
      let stopSent = false;
      let idleTimer: NodeJS.Timeout;
      let graceTimer: NodeJS.Timeout | undefined;

      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(idleTimer);
        clearTimeout(totalTimer);
        clearTimeout(graceTimer);
        this.deathHandlers.delete(death);
        if (err) rej(err); else res();
      };

      // quit() walks these, so a terminated engine still unblocks us.
      const death = (err: Error) => finish(err);
      this.deathHandlers.add(death);

      const giveUp = (why: string) => {
        if (settled || stopSent) return;
        stopSent = true;
        console.warn(`[stockfish] search ${why}; sending stop`);
        try { this.proc?.stdin.write('stop\n'); } catch { /* ignore */ }
        graceTimer = setTimeout(() => {
          finish(new Error(`engine_search_timeout (${why})`));
          // It ignored `stop` mid-search: unusable, and expensive to leave be.
          void this.quit().catch(() => { /* ignore */ });
        }, searchStopGraceMs());
      };

      const armIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => giveUp(`said nothing for ${idleMs} ms`), idleMs);
      };
      const totalTimer = setTimeout(() => giveUp(`ran past ${totalMs} ms`), totalMs);

      const handler = (line: string) => {
        if (settled) return;
        armIdle();
        if (onLine(line)) finish();
        else this.waiters.push(handler);
      };
      this.waiters.push(handler);
      armIdle();
    });
  }

  async evaluate(fen: string, depth: number): Promise<EngineEval> {
    assertNoNewline(fen, 'fen');
    await this.send(`position fen ${fen}`);
    await this.send(`go depth ${depth}`);

    let lastInfo: { cp: number | null; mate: number | null; pv: string[]; depth: number; seldepth: number } = {
      cp: null,
      mate: null,
      pv: [],
      depth: 0,
      seldepth: 0,
    };
    let bestMove: string | null = null;

    await this.awaitSearch((line) => {
      if (line.startsWith('info ')) {
        const parsed = parseInfoLine(line);
        // Skip search noise: lines without a real score, lowerbound/upperbound,
        // currmove progress reports, and `info string` chatter. Accept only
        // when this depth/seldepth is at least as deep as what we have.
        if (
          parsed
          && (parsed.cp !== null || parsed.mate !== null)
          && !parsed.bound
          && (parsed.depth > lastInfo.depth
              || (parsed.depth === lastInfo.depth && parsed.seldepth >= lastInfo.seldepth))
        ) {
          lastInfo = parsed;
        }
        return false;
      }
      if (line.startsWith('bestmove')) {
        const m = line.split(' ')[1];
        bestMove = m === '(none)' ? null : (m ?? null);
        return true;
      }
      return false;
    });

    return {
      cp: lastInfo.cp,
      mate: lastInfo.mate,
      bestMoveUci: bestMove,
      pv: lastInfo.pv,
      depth: lastInfo.depth,
    };
  }

  // MultiPV evaluation: returns the engine's top-N candidate moves at the
  // requested depth. Required for "Great" (only-good-move detection) and for
  // gap-aware Brilliant gating. Tracks per-multipv lastInfo so a deeper line
  // for rank 2 doesn't overwrite a shallower line for rank 1.
  async evaluateMulti(fen: string, depth: number, n: number): Promise<EngineMultiEval> {
    assertNoNewline(fen, 'fen');
    const numLines = Math.max(1, Math.min(8, n));
    await this.setOption('MultiPV', numLines);
    await this.send(`position fen ${fen}`);
    await this.send(`go depth ${depth}`);

    const perRank = new Map<number, { cp: number | null; mate: number | null; pv: string[]; depth: number; seldepth: number }>();
    let bestMove: string | null = null;
    let topDepth = 0;

    await this.awaitSearch((line) => {
      if (line.startsWith('info ')) {
        const parsed = parseInfoLine(line);
        if (
          parsed
          && (parsed.cp !== null || parsed.mate !== null)
          && !parsed.bound
        ) {
          const rank = parsed.multipv ?? 1;
          const prev = perRank.get(rank);
          if (!prev
              || parsed.depth > prev.depth
              || (parsed.depth === prev.depth && parsed.seldepth >= prev.seldepth)) {
            perRank.set(rank, parsed);
            if (rank === 1) topDepth = Math.max(topDepth, parsed.depth);
          }
        }
        return false;
      }
      if (line.startsWith('bestmove')) {
        const m = line.split(' ')[1];
        bestMove = m === '(none)' ? null : (m ?? null);
        return true;
      }
      return false;
    });

    // Restore single-line mode for any later evaluate() callers on this engine.
    await this.setOption('MultiPV', 1);

    const ranks = Array.from(perRank.keys()).sort((a, b) => a - b);
    const candidates: PvCandidate[] = ranks.map((r) => {
      const info = perRank.get(r)!;
      return { cp: info.cp, mate: info.mate, pv: info.pv, multipv: r };
    });
    const top = perRank.get(1);

    return {
      cp: top?.cp ?? null,
      mate: top?.mate ?? null,
      bestMoveUci: bestMove,
      pv: top?.pv ?? [],
      depth: top?.depth ?? topDepth,
      candidates,
    };
  }

  async bestMove(fen: string, opts: { depth?: number; movetimeMs?: number; skill?: number }): Promise<string | null> {
    assertNoNewline(fen, 'fen');
    if (opts.skill !== undefined) await this.setOption('Skill Level', opts.skill);
    await this.send(`position fen ${fen}`);
    if (opts.movetimeMs !== undefined) await this.send(`go movetime ${opts.movetimeMs}`);
    else await this.send(`go depth ${opts.depth ?? 12}`);
    let best: string | null = null;
    await this.awaitSearch((line) => {
      if (line.startsWith('bestmove')) {
        const m = line.split(' ')[1];
        best = m === '(none)' ? null : (m ?? null);
        return true;
      }
      return false;
    });
    return best;
  }

  // Async, idempotent shutdown. Sends `stop` + `quit` so any in-flight `go`
  // finishes promptly, closes stdin (without which the engine sits blocked on
  // a stdin read), then escalates SIGTERM -> SIGKILL until the OS process is
  // actually gone. Rejects pending waiters so callers never deadlock.
  //
  // Each step is gated on `isRunning` only. An earlier version also checked
  // `!proc.killed`, which SIGTERM sets — so the SIGKILL step could never run
  // and quit() resolved on an engine that was still alive, exactly in the case
  // it exists for (a large Hash takes a while to free).
  async quit(): Promise<void> {
    const proc = this.proc;
    if (!proc) return;
    this.proc = null;
    this.ready = false;

    // Reject every dangling waiter so consumers don't deadlock.
    const handlers = Array.from(this.deathHandlers);
    this.deathHandlers.clear();
    this.waiters = [];
    for (const h of handlers) h(new Error('engine_terminated'));

    try {
      proc.stdin.write('stop\nquit\n');
      proc.stdin.end();
    } catch { /* ignore */ }

    if (!isRunning(proc)) return;

    await new Promise<void>((res) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(termTimer);
        clearTimeout(killTimer);
        clearTimeout(giveUpTimer);
        res();
      };

      proc.once('exit', finish);
      proc.once('close', finish);

      // Graceful UCI `quit` gets 250 ms, then SIGTERM.
      const termTimer = setTimeout(() => {
        if (isRunning(proc)) { try { proc.kill('SIGTERM'); } catch { /* ignore */ } }
      }, 250);

      // Still up 350 ms after SIGTERM: stop being polite.
      const killTimer = setTimeout(() => {
        if (isRunning(proc)) { try { proc.kill('SIGKILL'); } catch { /* ignore */ } }
      }, 600);

      // SIGKILL is not instantaneous, so give the kernel a moment to reap and
      // let `exit` resolve us normally. If even that doesn't land we stop
      // blocking the caller — but the engine stays in `activeStockfishEngines`
      // (it is dropped on `exit`, not here), so the shutdown hook can still
      // finish the job rather than leaving an orphan behind.
      const giveUpTimer = setTimeout(finish, 1_500);
    });
  }

  isReady(): boolean { return this.ready; }
}

function parseInfoLine(line: string): { cp: number | null; mate: number | null; pv: string[]; depth: number; seldepth: number; bound: boolean; multipv: number } | null {
  // `info string` is human-readable chatter — never carries a score we care about.
  if (line.startsWith('info string')) return null;
  const tokens = line.split(' ');
  let cp: number | null = null;
  let mate: number | null = null;
  let depth = 0;
  let seldepth = 0;
  let pv: string[] = [];
  let bound = false;
  let multipv = 1;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === 'depth') depth = Number(tokens[++i]);
    else if (t === 'seldepth') seldepth = Number(tokens[++i]);
    else if (t === 'multipv') multipv = Number(tokens[++i]);
    else if (t === 'score') {
      const kind = tokens[++i];
      const val = Number(tokens[++i]);
      if (kind === 'cp') cp = val;
      else if (kind === 'mate') mate = val;
      // Stockfish appends `lowerbound` / `upperbound` after the value when the
      // score is fail-soft. Those snapshots aren't reliable evals.
      const next = tokens[i + 1];
      if (next === 'lowerbound' || next === 'upperbound') { bound = true; i++; }
    } else if (t === 'pv') {
      pv = tokens.slice(i + 1);
      break;
    }
  }
  return { cp, mate, pv, depth, seldepth, bound, multipv };
}
