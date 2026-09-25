// Which engine Game Review runs on.
//
// Two backends, one contract:
//   - `local`    — the bundled Stockfish binary (opt-in via ENGINE_BACKEND=local).
//   - `chessapi` — chess-api.com, a hosted Stockfish 18 NNUE reached over HTTPS.
//
// chess-api.com is the default backend; the bundled binary is the fallback and
// the explicit opt-out. Measured against the live service (2026-09):
//   - The free tier stops each search at 50–100 ms, so a request for depth 18
//     comes back at depth 11–13 — shallower than the local default of 16.
//   - The HTTP endpoint returns ONE line per position however many `variants`
//     you ask for. The classifier needs a second line for "Great" and for the
//     gap-aware "Brilliant" gate; with one line those rules simply don't fire
//     (see refineClassification — it degrades gracefully).
//   - Every analysed position leaves your network.
// What it buys: a box too weak to run Stockfish at depth 16 in reasonable time
// (a Pi Zero, a busy NAS) gets reviews in seconds without burning its CPU.
//
// Scope: analysis only — Game Review, the Lab / explorer lines, and the
// automatic post-game review. Bot play and the in-game blunder warning stay on
// the local engine: they need an answer in milliseconds, per move, and a
// network hop per move is the wrong trade.

import { Chess } from 'chess.js';
import { getSetting } from '../db.js';
import { StockfishEngine, type EngineMultiEval } from './stockfish.js';

export type EngineBackend = 'local' | 'chessapi';

export const CHESS_API_URL = 'https://chess-api.com/v1';
// chess-api.com's documented ceilings for the free tier.
const CHESS_API_MAX_DEPTH = 18;
const CHESS_API_MAX_THINK_MS = 100;
const CHESS_API_TIMEOUT_MS = 10_000;

/** The subset of StockfishEngine the analyzer uses. */
export interface AnalysisEngine {
  readonly kind: EngineBackend;
  start(): Promise<void>;
  setOption(name: string, value: string | number): Promise<void>;
  newGame(): Promise<void>;
  evaluateMulti(fen: string, depth: number, n: number): Promise<EngineMultiEval>;
  quit(): Promise<void>;
}

export function engineBackend(): EngineBackend {
  // Env wins so a deployment can pin the backend regardless of the UI. The
  // default is the hosted chess-api.com engine; set ENGINE_BACKEND=local (or
  // the `engine_backend` setting) to keep analysis on the bundled binary.
  const v = process.env.ENGINE_BACKEND ?? getSetting('engine_backend');
  return v === 'local' ? 'local' : 'chessapi';
}

export function createAnalysisEngine(backend: EngineBackend = engineBackend()): AnalysisEngine {
  return backend === 'chessapi' ? new ChessApiEngine() : new StockfishEngine();
}

// ---- chess-api.com ----

export type FetchLike = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

/**
 * chess-api.com response → Patzer's EngineMultiEval.
 *
 * chess-api reports `eval` / `centipawns` / `mate` from WHITE's point of view
 * ("negative = Black winning"); the local engine and everything downstream use
 * the side to move's. `centipawns` arrives as a string on some responses and a
 * number on others. Throws on anything that isn't a usable best move, so the
 * caller can fall back to the local engine.
 */
export function parseChessApiResponse(body: unknown, fen: string): EngineMultiEval {
  if (!body || typeof body !== 'object') throw new Error('chessapi: empty response');
  const j = body as Record<string, unknown>;
  if (j.type === 'error') throw new Error(`chessapi: ${String(j.text ?? 'error')}`);
  const move = typeof j.move === 'string' ? j.move : '';
  if (!UCI_RE.test(move)) throw new Error('chessapi: no best move');

  const sign = fen.split(' ')[1] === 'b' ? -1 : 1;
  const rawMate = j.mate == null ? null : Number(j.mate);
  const mate = rawMate !== null && Number.isFinite(rawMate) ? rawMate * sign : null;
  const rawCp = j.centipawns == null ? null : Number(j.centipawns);
  const cp = mate === null && rawCp !== null && Number.isFinite(rawCp) ? rawCp * sign : null;
  if (cp === null && mate === null) throw new Error('chessapi: no score');

  const cont = Array.isArray(j.continuationArr) ? j.continuationArr.filter((u): u is string => typeof u === 'string' && UCI_RE.test(u)) : [];
  const pv = [move, ...cont];
  const depth = Number(j.depth) || 0;
  return { cp, mate, bestMoveUci: move, pv, depth, candidates: [{ cp, mate, pv, multipv: 1 }] };
}

/**
 * A position with no legal moves never goes over the wire — the answer is
 * known, and the API has nothing sensible to return for it. Mirrors what the
 * local engine reports: `mate 0` for checkmate, `cp 0` for stalemate.
 */
function terminalEval(fen: string): EngineMultiEval | null {
  let pos: Chess;
  try { pos = new Chess(fen); } catch { return null; }
  if (pos.moves().length > 0) return null;
  const mate = pos.isCheckmate() ? 0 : null;
  const cp = mate === null ? 0 : null;
  return { cp, mate, bestMoveUci: null, pv: [], depth: 0, candidates: [{ cp, mate, pv: [], multipv: 1 }] };
}

// chess-api.com parses FEN strictly: it requires all six fields and rejects
// any en-passant square — even a legal one. chess.js emits a legal en-passant
// square right after a double pawn push, and some callers send a 4/5-field FEN,
// so normalize both before the request. Clearing en-passant is a tiny, rare
// accuracy trade (the engine just won't consider that one capture) and is far
// better than falling back to the local engine for the whole game.
export function strictFen(fen: string): string {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 4) return fen;
  parts[3] = '-';
  if (parts.length < 5) parts[4] = '0';
  if (parts.length < 6) parts[5] = '1';
  return parts.slice(0, 6).join(' ');
}

export class ChessApiEngine implements AnalysisEngine {
  readonly kind = 'chessapi' as const;
  // Lazily started the first time the API fails. Once we fall back we stay on
  // the local engine for the rest of this game, so one review doesn't mix two
  // engines' opinions move by move.
  private fallback: StockfishEngine | null = null;
  private options: [string, string | number][] = [];

  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  static async test(fetchImpl: FetchLike = fetch): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
    const e = new ChessApiEngine(fetchImpl);
    try {
      const r = await e.query(new Chess().fen(), CHESS_API_MAX_DEPTH);
      return { ok: true, name: `chess-api.com (depth ${r.depth}, best ${r.bestMoveUci})` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async start(): Promise<void> { /* stateless HTTP — nothing to start */ }

  async setOption(name: string, value: string | number): Promise<void> {
    // Remembered for the fallback engine; meaningless to the API.
    this.options.push([name, value]);
    if (this.fallback) await this.fallback.setOption(name, value);
  }

  async newGame(): Promise<void> {
    if (this.fallback) await this.fallback.newGame();
  }

  async evaluateMulti(fen: string, depth: number, n: number): Promise<EngineMultiEval> {
    const terminal = terminalEval(fen);
    if (terminal) return terminal;
    if (!this.fallback) {
      try {
        return await this.query(fen, depth, n);
      } catch (err) {
        // One retry covers a dropped connection or a momentary 429/5xx.
        await new Promise((r) => setTimeout(r, 1000));
        try {
          return await this.query(fen, depth, n);
        } catch {
          console.warn('[chess-api] unavailable, falling back to local Stockfish:', err instanceof Error ? err.message : err);
          await this.startFallback();
        }
      }
    }
    return this.fallback!.evaluateMulti(fen, depth, n);
  }

  async quit(): Promise<void> {
    const f = this.fallback;
    this.fallback = null;
    if (f) await f.quit();
  }

  private async query(fen: string, depth: number, n = 1): Promise<EngineMultiEval> {
    const res = await this.fetchImpl(CHESS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'patzer (+https://github.com/SikamikanikoBG/patzer)' },
      body: JSON.stringify({
        fen: strictFen(fen),
        depth: Math.min(depth, CHESS_API_MAX_DEPTH),
        variants: Math.max(1, Math.min(5, n)),
        maxThinkingTime: CHESS_API_MAX_THINK_MS,
      }),
      signal: AbortSignal.timeout(CHESS_API_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`chessapi_${res.status}`);
    return parseChessApiResponse(await res.json(), fen);
  }

  private async startFallback(): Promise<void> {
    // Throws "Stockfish binary not found" when there is no local engine at
    // all — the analysis then fails loudly instead of silently half-finishing.
    const e = new StockfishEngine();
    await e.start();
    for (const [k, v] of this.options) await e.setOption(k, v);
    await e.newGame();
    this.fallback = e;
  }
}
