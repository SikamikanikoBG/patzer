import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The routes open the real database on import, so point it at a throwaway
// file first.
const dir = mkdtempSync(join(tmpdir(), 'patzer-theme-'));
process.env.DB_PATH = join(dir, 'theme.db');

type DbModule = typeof import('../src/db.js');
type Router = { request: (path: string, init?: RequestInit) => Response | Promise<Response> };

let db: DbModule['db'];
let settings: Router;
let cookie: string;

beforeAll(async () => {
  ({ db } = await import('../src/db.js'));
  settings = (await import('../src/routes/settings.js')).default;
  const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');
  db.prepare(`INSERT INTO users (id, username, password_hash, role) VALUES (1, 'player', 'x', 'user')`).run();
  db.prepare(`INSERT INTO profiles (user_id, display_name) VALUES (1, 'Player')`).run();
  cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(1))}`;
});

afterAll(() => {
  try { db.close(); } catch { /* ignore */ }
  rmSync(dir, { recursive: true, force: true });
});

const savedTheme = () => (db.prepare('SELECT ui_theme FROM profiles WHERE user_id = 1').get() as { ui_theme: string }).ui_theme;

async function patchTheme(uiTheme: unknown) {
  const res = await settings.request('/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ ui_theme: uiTheme }),
  });
  return res.status;
}

describe('profile theme', () => {
  it('starts on classic', () => {
    expect(savedTheme()).toBe('classic');
  });

  it('stores any well-formed id, because the web app owns the list of themes', async () => {
    expect(await patchTheme('some-new-theme-2')).toBe(200);
    expect(savedTheme()).toBe('some-new-theme-2');
  });

  it.each([['spaces', 'not a theme'], ['upper case', 'Pixel'], ['markup', '"><script>'], ['too long', 'x'.repeat(33)], ['empty', ''], ['not a string', 7]])(
    'rejects %s and keeps the saved theme',
    async (_label, value) => {
      const before = savedTheme();
      expect(await patchTheme(value)).toBe(400);
      expect(savedTheme()).toBe(before);
    },
  );
});
