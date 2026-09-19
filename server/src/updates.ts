// "There's a new version" check.
//
// Self-hosted apps have no way to tell you they're stale — you find out months
// later when something you wanted was fixed in a release you never pulled. So
// Patzer asks GitHub, at most once every six hours, whether there's a newer
// tag than the one it's running, and the UI shows a quiet nudge when there is.
//
// Rules this follows deliberately:
//   - Off is a real option (`UPDATE_CHECK=0`, or the toggle in Admin → System).
//     Some people run genuinely offline and a failing request every six hours
//     is noise.
//   - It sends nothing about you. It's an unauthenticated GET of a public
//     endpoint; no instance id, no usage, no telemetry of any kind.
//   - A failure is silent. No network, no GitHub, rate-limited — the app
//     behaves exactly as if there were no update.

import { getSetting, setSetting } from './db.js';

const RELEASES_URL = 'https://api.github.com/repos/SikamikanikoBG/patzer/releases/latest';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const TIMEOUT_MS = 6000;
const SETTING_ENABLED = 'update_check_enabled';
const SETTING_CACHE = 'update_check_cache';

export interface UpdateInfo {
  /** Latest version seen upstream, e.g. "7.11.0". Null if never successfully checked. */
  latest: string | null;
  /** Release page for `latest`. */
  url: string | null;
  /** When we last got an answer (ISO), null if never. */
  checkedAt: string | null;
}

interface CacheShape extends UpdateInfo { failedAt?: string | null }

export function updateCheckEnabled(): boolean {
  // Env wins so an admin can hard-disable it for a whole deployment.
  if (process.env.UPDATE_CHECK === '0') return false;
  return getSetting(SETTING_ENABLED) !== '0';
}

export function setUpdateCheckEnabled(on: boolean): void {
  setSetting(SETTING_ENABLED, on ? '1' : '0');
}

function readCache(): CacheShape {
  try {
    const raw = getSetting(SETTING_CACHE);
    if (raw) return JSON.parse(raw) as CacheShape;
  } catch { /* fall through to empty */ }
  return { latest: null, url: null, checkedAt: null };
}

function writeCache(c: CacheShape): void {
  try { setSetting(SETTING_CACHE, JSON.stringify(c)); } catch { /* not worth failing a request over */ }
}

/** "7.10.1" → [7, 10, 1]. Tolerates a leading v and trailing pre-release junk. */
export function parseVersion(v: string): number[] {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  if (!m) return [];
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** True when `latest` is strictly newer than `current`. Unparseable → false, so
 *  a weird tag upstream can never nag people. */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest), b = parseVersion(current);
  if (a.length !== 3 || b.length !== 3) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i]! > b[i]!) return true;
    if (a[i]! < b[i]!) return false;
  }
  return false;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

let inFlight: Promise<UpdateInfo> | null = null;

/** Cached check. Hits GitHub at most once per CHECK_INTERVAL_MS, and only one
 *  request is ever in flight however many clients ask at once. */
export async function checkForUpdate(currentVersion: string, fetchImpl: FetchLike = fetch): Promise<UpdateInfo & { updateAvailable: boolean; current: string }> {
  const cache = readCache();
  const shape = (c: CacheShape) => ({
    latest: c.latest,
    url: c.url,
    checkedAt: c.checkedAt,
    current: currentVersion,
    updateAvailable: !!c.latest && isNewer(c.latest, currentVersion),
  });

  if (!updateCheckEnabled()) return { ...shape(cache), latest: null, url: null, updateAvailable: false };

  const last = cache.checkedAt ?? cache.failedAt;
  const fresh = last && Date.now() - Date.parse(last) < CHECK_INTERVAL_MS;
  if (fresh) return shape(cache);

  if (!inFlight) {
    inFlight = (async (): Promise<UpdateInfo> => {
      try {
        const res = await fetchImpl(RELEASES_URL, {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'patzer (+https://github.com/SikamikanikoBG/patzer)' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`github ${res.status}`);
        const body = await res.json() as { tag_name?: unknown; html_url?: unknown };
        const tag = typeof body.tag_name === 'string' ? body.tag_name : null;
        if (!tag || parseVersion(tag).length !== 3) throw new Error('no usable tag');
        const next: CacheShape = {
          latest: tag.replace(/^v/, ''),
          url: typeof body.html_url === 'string' ? body.html_url : null,
          checkedAt: new Date().toISOString(),
          failedAt: null,
        };
        writeCache(next);
        return next;
      } catch {
        // Remember the failure so a box with no internet doesn't retry on
        // every single page load; keep whatever we knew before.
        writeCache({ ...cache, failedAt: new Date().toISOString() });
        return cache;
      } finally {
        inFlight = null;
      }
    })();
  }
  return shape(await inFlight as CacheShape);
}

/** Test hook. */
export function resetUpdateCheck(): void { inFlight = null; }
