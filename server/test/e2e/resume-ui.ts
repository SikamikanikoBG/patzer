// The reported bug, driven through the real UI in a real browser: play a few
// moves, leave (or lose the network the way a phone does), come back, and the
// game is still there and still playable.
//
// The protocol-level test (`npm run test:resume`) proves the server keeps the
// game. This one proves the *page* does the right thing with it — the class of
// failure the repo has been bitten by twice, where the board looks fine and
// nothing works.
//
// Not part of `npm test` (it needs a browser). Run it with:
//   npm i -D playwright && npx playwright install chromium
//   npm run test:resume-ui
import { setTimeout as sleep } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { chromium, type Page, type BrowserContext } from 'playwright';

const PORT = 8895;
const BASE = `http://127.0.0.1:${PORT}`;
process.env.PORT = String(PORT); process.env.HOST = '127.0.0.1';
const dbPath = join(tmpdir(), `patzer-resumeui-${process.pid}.db`);
process.env.DB_PATH = dbPath;
for (const s of ['', '-wal', '-shm']) rmSync(dbPath + s, { force: true });

let fails = 0;
const ok = (c: unknown, label: string) => { if (c) console.log(`  ok   ${label}`); else { fails++; console.log(`  FAIL ${label}`); } };

async function api(path: string, body?: unknown, cookie?: string) {
  const res = await fetch(BASE + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'patzer', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const sc = res.headers.get('set-cookie'); let json: any = null; try { json = await res.json(); } catch { /* */ }
  return { status: res.status, json, cookie: sc ? sc.split(';')[0] : undefined };
}

async function square(page: Page, sq: string, orientation: 'white' | 'black') {
  const board = page.locator('cg-container').first();
  const box = (await board.boundingBox())!;
  const files = 'abcdefgh';
  let fx = files.indexOf(sq[0]!);
  let ry = 8 - Number(sq[1]);
  if (orientation === 'black') { fx = 7 - fx; ry = 7 - ry; }
  const cell = box.width / 8;
  return { x: box.x + cell * (fx + 0.5), y: box.y + cell * (ry + 0.5) };
}
async function move(page: Page, from: string, to: string, orientation: 'white' | 'black') {
  const a = await square(page, from, orientation);
  const b = await square(page, to, orientation);
  await page.mouse.click(a.x, a.y);
  await page.waitForTimeout(150);
  await page.mouse.click(b.x, b.y);
  await page.waitForTimeout(1200);
}
async function login(ctx: BrowserContext, username: string, password: string): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.locator('input').first().fill(username);
  const pw = page.locator('input[type="password"]').first();
  await pw.fill(password);
  await pw.press('Enter');
  await page.waitForURL((u: URL) => !u.pathname.includes('login'), { timeout: 15000 });
  return page;
}
/** How many moves the move list is showing. */
async function moveCount(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelectorAll('[data-ply]').length);
}
/** Close the live play socket from inside the page — what a sleeping phone does. */
async function dropSocket(page: Page): Promise<number> {
  return page.evaluate(() => {
    const all = (window as unknown as { __sockets: WebSocket[] }).__sockets ?? [];
    const live = all.filter((s) => s.url.includes('/ws/play') && s.readyState === WebSocket.OPEN);
    live.forEach((s) => s.close());
    return live.length;
  });
}

await import('../../src/index.js');
await sleep(900);
console.log('scratch server up on', BASE);

const admin = await api('/api/setup/init', { username: 'alice', password: 'alice-password-1', display_name: 'Alice', language: 'en' });
ok(admin.status === 200, 'scratch instance initialised');

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
// Playwright's offline mode doesn't tear down an already-open WebSocket, so
// keep a handle on every socket the page opens and close one on demand. From
// the page's point of view that is exactly what a sleeping phone does: the
// socket is simply gone.
await ctx.addInitScript(() => {
  const Native = window.WebSocket;
  (window as unknown as { __sockets: WebSocket[] }).__sockets = [];
  window.WebSocket = new Proxy(Native, {
    construct(target, args: [string, (string | string[])?]) {
      const ws = new target(...args);
      (window as unknown as { __sockets: WebSocket[] }).__sockets.push(ws);
      return ws;
    },
  });
});
const page = await login(ctx, 'alice', 'alice-password-1');

// --- start a bot game and play two moves ----------------------------------
await page.goto(`${BASE}/play`);
await page.getByRole('button', { name: /^easy$/i }).first().click().catch(() => { /* default is fine */ });
await page.getByRole('button', { name: /white/i }).first().click().catch(() => { /* default */ });
await page.getByRole('button', { name: /start|play/i }).last().click();
await page.waitForTimeout(2500);
ok(await page.locator('cg-container').first().isVisible(), 'board is up');

await move(page, 'e2', 'e4', 'white');
await page.waitForTimeout(1500);
await move(page, 'd2', 'd4', 'white');
await page.waitForTimeout(1500);
const beforeLeaving = await moveCount(page);
ok(beforeLeaving >= 3, `played into the game (${beforeLeaving} moves on the board)`);

// --- 1. the phone loses the network ---------------------------------------
console.log('\nscenario 1: the network drops under a live game');
await ctx.setOffline(true);
ok(await dropSocket(page) === 1, 'the play socket was dropped under the game');
await page.waitForTimeout(2500);
const banner = await page.getByText(/reconnecting/i).first().isVisible().catch(() => false);
ok(banner, 'the page admits it is offline instead of looking alive');

// Still offline: the retries must be failing and the banner must stay up,
// rather than the page declaring victory over a socket that never opened.
await page.waitForTimeout(4000);
ok(await page.getByText(/reconnecting/i).first().isVisible().catch(() => false),
   'and keeps saying so while the network is still down');

await ctx.setOffline(false);
await page.waitForTimeout(9000);
const bannerGone = !(await page.getByText(/reconnecting/i).first().isVisible().catch(() => false));
ok(bannerGone, 'and reconnects by itself once the network is back');
const afterReconnect = await moveCount(page);
ok(afterReconnect >= beforeLeaving, `the game came back intact (${afterReconnect} moves)`);

await move(page, 'g1', 'f3', 'white');
await page.waitForTimeout(2000);
const afterMove = await moveCount(page);
ok(afterMove > afterReconnect, `and it is still playable after reconnecting (${afterMove} moves)`);

// --- 2. navigate away entirely, the way you do on a phone -----------------
console.log('\nscenario 2: leave the app, come back later');
await page.goto(`${BASE}/insights`);
await page.waitForTimeout(1200);
await page.goto(`${BASE}/play`);
await page.waitForTimeout(1500);

const resumeCard = await page.getByText(/continue where you left off/i).first().isVisible().catch(() => false);
ok(resumeCard, 'the setup screen offers the game back');

await page.getByRole('button', { name: /^resume$/i }).first().click();
await page.waitForTimeout(3000);
const afterResume = await moveCount(page);
ok(afterResume >= afterMove, `resuming restores every move (${afterResume})`);

await move(page, 'b1', 'c3', 'white');
await page.waitForTimeout(2000);
ok((await moveCount(page)) > afterResume, 'and the resumed game accepts moves');

// --- 3. a full page reload mid-game ---------------------------------------
console.log('\nscenario 3: hard reload');
const beforeReload = await moveCount(page);
await page.reload();
await page.waitForTimeout(1500);
await page.getByRole('button', { name: /^resume$/i }).first().click();
await page.waitForTimeout(3000);
ok((await moveCount(page)) >= beforeReload, 'survives a hard reload too');

// --- 4. discarding it means it is gone ------------------------------------
console.log('\nscenario 4: discard');
await page.goto(`${BASE}/play`);
await page.waitForTimeout(1500);
await page.getByRole('button', { name: /discard/i }).first().click();
await page.waitForTimeout(1200);
const stillThere = await page.getByText(/continue where you left off/i).first().isVisible().catch(() => false);
ok(!stillThere, 'discarding removes the offer');

await browser.close();
console.log(fails === 0 ? '\nAll resume-UI checks passed.' : `\n${fails} check(s) FAILED.`);
process.exit(fails === 0 ? 0 : 1);
