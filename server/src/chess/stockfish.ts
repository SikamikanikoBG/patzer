import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../config.js';
import { getSetting } from '../db.js';

let activeEngineCount = 0;

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

export class StockfishEngine {
  private proc: ChildProcessWithoutNullStreams | null = null;
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
    if (config.demoMode && activeEngineCount >= config.demoStockfishCap) {
      throw new Error('engine_limit_reached');
    }
    this.proc = spawn(this.path, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    activeEngineCount++;
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk: string) => this.onData(chunk));
    this.proc.on('error', (err) => console.error('[stockfish]', err));
    await this.send('uci');
    await this.waitFor((l) => l === 'uciok');
    this.ready = true;
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

    await new Promise<void>((res, rej) => {
      const reject = (err: Error) => { this.deathHandlers.delete(reject); rej(err); };
      this.deathHandlers.add(reject);
      const handler = (line: string) => {
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
          this.waiters.push(handler);
        } else if (line.startsWith('bestmove')) {
          const m = line.split(' ')[1];
          bestMove = m === '(none)' ? null : (m ?? null);
          this.deathHandlers.delete(reject);
          res();
        } else {
          this.waiters.push(handler);
        }
      };
      this.waiters.push(handler);
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

    await new Promise<void>((res, rej) => {
      const reject = (err: Error) => { this.deathHandlers.delete(reject); rej(err); };
      this.deathHandlers.add(reject);
      const handler = (line: string) => {
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
          this.waiters.push(handler);
        } else if (line.startsWith('bestmove')) {
          const m = line.split(' ')[1];
          bestMove = m === '(none)' ? null : (m ?? null);
          this.deathHandlers.delete(reject);
          res();
        } else {
          this.waiters.push(handler);
        }
      };
      this.waiters.push(handler);
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
    await new Promise<void>((res, rej) => {
      const reject = (err: Error) => { this.deathHandlers.delete(reject); rej(err); };
      this.deathHandlers.add(reject);
      const handler = (line: string) => {
        if (line.startsWith('bestmove')) {
          const m = line.split(' ')[1];
          best = m === '(none)' ? null : (m ?? null);
          this.deathHandlers.delete(reject);
          res();
        } else {
          this.waiters.push(handler);
        }
      };
      this.waiters.push(handler);
    });
    return best;
  }

  // Async, idempotent shutdown. Sends `stop` + `quit` so any in-flight `go`
  // finishes promptly, awaits the `bestmove`, then guarantees the OS process
  // is gone within ~250 ms. Rejects pending waiters so callers stop hanging.
  async quit(): Promise<void> {
    const proc = this.proc;
    if (!proc) return;
    this.proc = null;
    this.ready = false;
    activeEngineCount--;
    try { proc.stdin.write('stop\nquit\n'); } catch { /* ignore */ }

    const exited = new Promise<void>((res) => {
      if (proc.exitCode !== null) return res();
      proc.once('exit', () => res());
    });
    const killed = new Promise<void>((res) => setTimeout(() => {
      if (proc.exitCode === null) { try { proc.kill('SIGKILL'); } catch { /* ignore */ } }
      res();
    }, 250));
    await Promise.race([exited, killed]);

    // Reject every dangling waiter so consumers don't deadlock.
    const handlers = Array.from(this.deathHandlers);
    this.deathHandlers.clear();
    this.waiters = [];
    for (const h of handlers) h(new Error('engine_terminated'));
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
