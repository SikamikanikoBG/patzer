import { describe, it, expect } from 'vitest';
import { fetchRecentGames, parseNdjson, toImportRow, type FetchLike, type LichessGame } from '../src/chess/lichess.js';

// Shape as returned by GET /api/games/user/{username}?pgnInJson=true (NDJSON).
function game(over: Partial<LichessGame> = {}): LichessGame {
  return {
    id: 'kAdOQKeh',
    rated: true,
    variant: 'standard',
    speed: 'blitz',
    createdAt: 1775677143033,
    lastMoveAt: 1775677513708,
    status: 'resign',
    players: {
      white: { user: { name: 'respects_55', id: 'respects_55' }, rating: 2644 },
      black: { user: { name: 'DrNykterstein', id: 'drnykterstein' }, rating: 3145 },
    },
    winner: 'black',
    clock: { initial: 180, increment: 0 },
    pgn: '[Event "Rated blitz game"]\n[Site "https://lichess.org/kAdOQKeh"]\n\n1. e4 Nf6 2. e5 Nd5 0-1\n\n\n',
    ...over,
  };
}

describe('toImportRow', () => {
  it('maps a game onto Patzer columns from the importing user’s side', () => {
    const row = toImportRow(game(), 'DrNykterstein')!;
    expect(row).toMatchObject({
      external_id: 'kAdOQKeh',
      white: 'respects_55',
      black: 'DrNykterstein',
      user_color: 'black',
      result: 'win',
      time_control: '180+0',
      time_class: 'blitz',
      end_time: new Date(1775677513708).toISOString(),
    });
    expect(row.pgn.endsWith('0-1')).toBe(true);
  });

  it('matches the username case-insensitively and scores losses and draws', () => {
    expect(toImportRow(game(), 'RESPECTS_55')!).toMatchObject({ user_color: 'white', result: 'loss' });
    expect(toImportRow(game({ winner: undefined, status: 'draw' }), 'drnykterstein')!.result).toBe('draw');
    expect(toImportRow(game({ winner: undefined, status: 'stalemate' }), 'drnykterstein')!.result).toBe('draw');
  });

  it('scores a game the user is not in from White’s side, like the chess.com importer', () => {
    expect(toImportRow(game(), 'someone_else')!).toMatchObject({ user_color: null, result: 'loss' });
  });

  it('classifies time controls with Patzer’s own rules', () => {
    expect(toImportRow(game({ clock: { initial: 60, increment: 0 } }), 'x')!.time_class).toBe('bullet');
    expect(toImportRow(game({ clock: { initial: 600, increment: 5 } }), 'x')!.time_class).toBe('rapid');
    const corr = toImportRow(game({ clock: undefined, daysPerTurn: 3, speed: 'correspondence' }), 'x')!;
    expect(corr).toMatchObject({ time_control: '1/259200', time_class: 'daily' });
    const unlimited = toImportRow(game({ clock: undefined, speed: 'correspondence' }), 'x')!;
    expect(unlimited).toMatchObject({ time_control: 'untimed', time_class: null });
  });

  it('names computer and anonymous opponents', () => {
    const vsAi = toImportRow(game({ players: { white: { user: { name: 'me', id: 'me' } }, black: { aiLevel: 4 } } }), 'me')!;
    expect(vsAi.black).toBe('Stockfish level 4');
    const vsAnon = toImportRow(game({ players: { white: { user: { name: 'me', id: 'me' } }, black: {} } }), 'me')!;
    expect(vsAnon.black).toBe('Anonymous');
  });

  it('skips variants and games that never really happened', () => {
    expect(toImportRow(game({ variant: 'chess960' }), 'x')).toBeNull();
    expect(toImportRow(game({ variant: 'fromPosition' }), 'x')).toBeNull();
    expect(toImportRow(game({ status: 'aborted' }), 'x')).toBeNull();
    expect(toImportRow(game({ status: 'noStart' }), 'x')).toBeNull();
    expect(toImportRow(game({ pgn: undefined }), 'x')).toBeNull();
  });
});

describe('parseNdjson', () => {
  it('reads one game per line and tolerates blank and torn lines', () => {
    const body = `${JSON.stringify(game())}\n\n${JSON.stringify(game({ id: 'second' }))}\n{"id": "torn`;
    expect(parseNdjson(body).map((g) => g.id)).toEqual(['kAdOQKeh', 'second']);
  });
});

describe('fetchRecentGames', () => {
  function fakeFetch(status: number, body = ''): { fetch: FetchLike; calls: { url: string; headers: Record<string, string> }[] } {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetch: FetchLike = async (url, init) => {
      calls.push({ url, headers: init.headers });
      return { ok: status >= 200 && status < 300, status, text: async () => body };
    };
    return { fetch, calls };
  }

  it('asks for NDJSON with a User-Agent and passes max / since through', async () => {
    const { fetch, calls } = fakeFetch(200, JSON.stringify(game()));
    const games = await fetchRecentGames('DrNykterstein', { max: 20, since: 1700000000000 }, fetch);
    expect(games).toHaveLength(1);
    const url = new URL(calls[0]!.url);
    expect(url.origin + url.pathname).toBe('https://lichess.org/api/games/user/DrNykterstein');
    expect(url.searchParams.get('max')).toBe('20');
    expect(url.searchParams.get('since')).toBe('1700000000000');
    expect(url.searchParams.get('pgnInJson')).toBe('true');
    expect(calls[0]!.headers.Accept).toBe('application/x-ndjson');
    expect(calls[0]!.headers['User-Agent']).toMatch(/patzer/);
  });

  it('turns 404 and 429 into codes the route can map', async () => {
    await expect(fetchRecentGames('nobody_here', { max: 1 }, fakeFetch(404).fetch)).rejects.toThrow('not_found');
    await expect(fetchRecentGames('someone', { max: 1 }, fakeFetch(429).fetch)).rejects.toThrow('rate_limited');
    await expect(fetchRecentGames('someone', { max: 1 }, fakeFetch(503).fetch)).rejects.toThrow('lichess_503');
  });

  it('rejects an invalid username without calling Lichess', async () => {
    const { fetch, calls } = fakeFetch(200);
    await expect(fetchRecentGames('../admin', { max: 1 }, fetch)).rejects.toThrow('invalid_username');
    expect(calls).toHaveLength(0);
  });

  it('sends one request at a time, even after a failure', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const slow: FetchLike = async () => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { ok: false, status: 500, text: async () => '' };
    };
    await Promise.allSettled([1, 2, 3].map(() => fetchRecentGames('someone', { max: 1 }, slow)));
    expect(maxInFlight).toBe(1);
  });
});
