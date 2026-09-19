import { Hono } from 'hono';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../config.js';
import { checkForUpdate, updateCheckEnabled } from '../updates.js';

const router = new Hono();

let cachedVersion: string | null = null;
function readVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    const pkg = JSON.parse(readFileSync(resolve(config.projectRoot, 'package.json'), 'utf8'));
    cachedVersion = String(pkg.version ?? 'unknown');
  } catch {
    cachedVersion = 'unknown';
  }
  return cachedVersion;
}

let cachedChangelog: string | null = null;
function readChangelog(): string {
  if (cachedChangelog !== null) return cachedChangelog;
  const path = resolve(config.projectRoot, 'CHANGELOG.md');
  cachedChangelog = existsSync(path) ? readFileSync(path, 'utf8') : '';
  return cachedChangelog;
}

router.get('/', (c) => {
  return c.json({ version: readVersion(), name: 'chess' });
});

// Is there a newer release than the one we're running? Answers from a cache
// that refreshes every six hours, never fails the request, and returns
// `enabled: false` when the check is switched off.
router.get('/update', async (c) => {
  if (!updateCheckEnabled()) {
    return c.json({ enabled: false, updateAvailable: false, current: readVersion(), latest: null, url: null, checkedAt: null });
  }
  const info = await checkForUpdate(readVersion());
  return c.json({ enabled: true, ...info });
});

router.get('/changelog', (c) => {
  return c.body(readChangelog(), 200, { 'Content-Type': 'text/markdown; charset=utf-8' });
});

export default router;
