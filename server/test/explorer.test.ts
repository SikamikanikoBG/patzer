import { describe, it, expect, beforeEach } from 'vitest';
import { masterStats, parseLichess, positionKey, clearExplorerCache, type FetchLike } from '../src/chess/explorer.js';

const E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';

// Shape as documented at https://lichess.org/api#tag/Opening-Explorer
const LICHESS_BODY = {
  white: 1000, draws: 800, black: 500,
  moves: [
    { uci: 'e7e5', san: 'e5', averageRating: 2420, white: 500, draws: 400, black: 200, game: null },
    { uci: 'c7c5', san: 'c5', averageRating: 2450, white: 400, draws: 300, black: 250, game: null },
    { uci: 'e7e6', san: 'e6', averageRating: 2400, white: 100, draws: 100, black: 50, game: null },
  ],
  topGames: [],
  opening: { eco: 'B00', name: "King's Pawn Game" },
};

function fakeFetch(handler: (url: string) => { status: number; body?: unknown } | Error): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const fetch: FetchLike = async (url) => {
    calls.push(url);
    const r = handler(url);
    if (r instanceof Error) throw r;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  };
  return { fetch, calls };
}

beforeEach(() => clearExplorerCache());

describe('positionKey', () => {
  it('drops the move counters and normalises through chess.js', () => {
    // chess.js drops an en-passant square no pawn can actually use → more cache hits
    expect(positionKey(E4)).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -');
    expect(positionKey('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 5 9')).toBe(positionKey(E4));
    expect(positionKey('garbage')).toBeNull();
  });
});

describe('parseLichess', () => {
  it('maps the documented response and caps the move list', () => {
    const s = parseLichess({ ...LICHESS_BODY, moves: Array.from({ length: 12 }, (_, i) => ({ uci: `a${i}`, san: `m${i}`, white: 1, draws: 1, black: 1 })) })!;
    expect(s.total).toBe(2300);
    expect(s.moves).toHaveLength(6);
    expect(s.opening).toEqual({ eco: 'B00', name: "King's Pawn Game" });
  });
  it('tolerates missing fields and rejects garbage', () => {
    expect(parseLichess({ white: 1, draws: 0, black: 0 })!.moves).toEqual([]);
    expect(parseLichess({ white: 1, draws: 0, black: 0, opening: null })!.opening).toBeNull();
    expect(parseLichess(null)).toBeNull();
    expect(parseLichess('nope')).toBeNull();
    expect(parseLichess({ white: 'x' })).toBeNull();
  });
});

describe('masterStats', () => {
  it('fetches once per position and serves the cache afterwards', async () => {
    const f = fakeFetch(() => ({ status: 200, body: LICHESS_BODY }));
    const a = await masterStats(E4, f.fetch);
    const b = await masterStats(E4.replace(' 0 1', ' 3 7'), f.fetch); // same position, different counters
    expect(a).toMatchObject({ ok: true, cached: false });
    expect(b).toMatchObject({ ok: true, cached: true });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toContain('/masters?fen=');
    expect(decodeURIComponent(f.calls[0]!)).toContain('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
    if (a.ok) {
      expect(a.stats.total).toBe(2300);
      expect(a.stats.moves[0]).toMatchObject({ san: 'e5', white: 500, draws: 400, black: 200, averageRating: 2420 });
    }
  });

  it('degrades to unavailable on HTTP errors, and negative-caches for a while', async () => {
    const f = fakeFetch(() => ({ status: 401 }));
    expect(await masterStats(E4, f.fetch)).toEqual({ ok: false, reason: 'unavailable', cached: false });
    expect(await masterStats(E4, f.fetch)).toEqual({ ok: false, reason: 'unavailable', cached: true });
    expect(f.calls).toHaveLength(1);
  });

  it('degrades on network errors / timeouts and on unparseable bodies', async () => {
    const boom = fakeFetch(() => new Error('ECONNRESET'));
    expect(await masterStats(E4, boom.fetch)).toMatchObject({ ok: false, reason: 'unavailable' });
    clearExplorerCache();
    const junk = fakeFetch(() => ({ status: 200, body: '<html>' }));
    expect(await masterStats(E4, junk.fetch)).toMatchObject({ ok: false, reason: 'unavailable' });
  });

  it('rejects an invalid FEN without touching the network', async () => {
    const f = fakeFetch(() => ({ status: 200, body: LICHESS_BODY }));
    expect(await masterStats('not a fen', f.fetch)).toEqual({ ok: false, reason: 'invalid_fen', cached: false });
    expect(f.calls).toHaveLength(0);
  });

  it('honours LICHESS_EXPLORER_URL for a self-hosted explorer', async () => {
    process.env.LICHESS_EXPLORER_URL = 'http://explorer.local:9002/';
    try {
      const f = fakeFetch(() => ({ status: 200, body: LICHESS_BODY }));
      await masterStats(E4, f.fetch);
      expect(f.calls[0]!.startsWith('http://explorer.local:9002/masters?')).toBe(true);
    } finally {
      delete process.env.LICHESS_EXPLORER_URL;
    }
  });
});
