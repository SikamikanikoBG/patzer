// Chess.com public API client. The API is unauthenticated but requires a User-Agent.

const UA = 'patzer/3.1 (+https://github.com/SikamikanikoBG/patzer)';

// Chess.com usernames are 3–25 chars; we extend slightly for historical grandfathered handles.
const USERNAME_RE = /^[A-Za-z0-9_-]{2,40}$/;
function assertValidUsername(u: string): void {
  if (!USERNAME_RE.test(u)) throw new Error('invalid_username');
}

// Archive URLs come back from chess.com itself, but defense in depth: confirm
// each is on api.chess.com/pub/ before we GET it. Prevents an SSRF-style pivot
// if the archive list is ever influenced by an attacker.
function assertChessComUrl(u: string): void {
  let parsed: URL;
  try { parsed = new URL(u); } catch { throw new Error('invalid_url'); }
  if (parsed.protocol !== 'https:' || parsed.host !== 'api.chess.com' || !parsed.pathname.startsWith('/pub/')) {
    throw new Error('invalid_url');
  }
}

interface Archive { url: string }
interface ArchivesResponse { archives: string[] }

export interface ChessComGame {
  url: string;
  pgn: string;
  time_control: string;
  end_time: number;
  rated: boolean;
  time_class: string;
  rules: string;
  white: { username: string; rating: number; result: string };
  black: { username: string; rating: number; result: string };
}

interface MonthlyArchive { games: ChessComGame[] }

async function get(url: string): Promise<unknown> {
  // 15s ceiling: stops a slow chess.com response from pinning a request handler.
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) throw new Error('not_found');
  if (!res.ok) throw new Error(`chesscom_${res.status}`);
  return res.json();
}

export async function getPlayer(username: string): Promise<{ username: string; avatar?: string; country?: string } | null> {
  try {
    assertValidUsername(username);
    const data = (await get(`https://api.chess.com/pub/player/${encodeURIComponent(username)}`)) as Record<string, unknown>;
    return {
      username: String(data.username ?? username),
      avatar: typeof data.avatar === 'string' ? data.avatar : undefined,
      country: typeof data.country === 'string' ? data.country : undefined,
    };
  } catch {
    return null;
  }
}

export async function listArchives(username: string): Promise<string[]> {
  assertValidUsername(username);
  const data = (await get(`https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/archives`)) as ArchivesResponse;
  return (data.archives ?? []).filter((u) => {
    try { assertChessComUrl(u); return true; } catch { return false; }
  });
}

export async function getMonth(archiveUrl: string): Promise<ChessComGame[]> {
  assertChessComUrl(archiveUrl);
  const data = (await get(archiveUrl)) as MonthlyArchive;
  return data.games ?? [];
}

// Fetch the most recent N games for a user, walking archives backwards in time.
// `limit` may be Infinity to walk every monthly archive — the whole history.
export async function fetchRecentGames(username: string, limit: number): Promise<ChessComGame[]> {
  assertValidUsername(username);
  const archives = await listArchives(username);
  const out: ChessComGame[] = [];
  for (let i = archives.length - 1; i >= 0 && out.length < limit; i--) {
    const url = archives[i];
    if (!url) continue;
    const games = await getMonth(url);
    // Skip variants — we only analyze standard chess; importing king-of-the-hill
    // games and feeding them to a standard-chess classifier produces nonsense.
    const standard = games.filter((g) => g.rules === 'chess');
    standard.sort((a, b) => b.end_time - a.end_time);
    for (const g of standard) {
      out.push(g);
      if (out.length >= limit) break;
    }
  }
  return out;
}
