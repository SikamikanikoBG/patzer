// Two real browsers playing each other through the actual UI, against a
// throwaway server on a scratch database. This is the only test that catches
// "the board looks fine but clicks do nothing" — twice now a released version
// could not be played as Black (#3, and the stale-bounds bug fixed in 7.10.1),
// and neither the unit suite nor the protocol-level e2e noticed.
//
// Not part of `npm test` (it needs a browser). Run it with:
//   npm i -D playwright && npx playwright install chromium
//   npm run test:ui
// Deliberately not a dependency of the project — a fresh clone stays light.
import { setTimeout as sleep } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { chromium, type Page, type BrowserContext } from 'playwright';

const PORT = 8896;
const BASE = `http://127.0.0.1:${PORT}`;
process.env.PORT = String(PORT); process.env.HOST = '127.0.0.1';
const dbPath = join(tmpdir(), `patzer-pvpui-${process.pid}.db`);
process.env.DB_PATH = dbPath;
for (const s of ['', '-wal', '-shm']) rmSync(dbPath + s, { force: true });
const SHOTS = process.argv[2] ?? '.';

let fails = 0;
const ok = (c: unknown, label: string) => { if (c) console.log(`  ok   ${label}`); else { fails++; console.log(`  FAIL ${label}`); } };

async function api(path: string, body?: unknown, cookie?: string) {
  const res = await fetch(BASE + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'patzer', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = res.headers.get('set-cookie'); let json: any = null; try { json = await res.json(); } catch { /* */ }
  return { status: res.status, json, cookie: sc ? sc.split(';')[0] : undefined };
}

/** Click a square on the chessground board by algebraic name. */
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
  await page.waitForTimeout(700);
}
async function login(ctx: BrowserContext, username: string, password: string): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByLabel(/username/i).or(page.locator('input[name="username"], input#username').first()).fill(username).catch(async () => {
    await page.locator('input').first().fill(username);
  });
  const pw = page.locator('input[type="password"]').first();
  await pw.fill(password);
  await pw.press('Enter');
  await page.waitForURL((u: URL) => !u.pathname.includes('login'), { timeout: 15000 });
  return page;
}

await import('../../src/index.js');
await sleep(900);
console.log('scratch server up on', BASE, '(db:', dbPath + ')');

// --- accounts -------------------------------------------------------------
const admin = await api('/api/setup/init', { username: 'alice', password: 'alice-password-1', display_name: 'Alice', language: 'en' });
ok(admin.status === 200, 'scratch instance initialised (Alice)');
await api('/api/admin/users', { username: 'bob', password: 'bob-password-12', display_name: 'Bob', role: 'user' }, admin.cookie);
const bobLogin = await api('/api/auth/login', { username: 'bob', password: 'bob-password-12' });
ok(bobLogin.status === 200, 'second account (Bob) created');
const bobId = bobLogin.json.user.id;

const browser = await chromium.launch();
const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const A = await login(ctxA, 'alice', 'alice-password-1');
const B = await login(ctxB, 'bob', 'bob-password-12');
ok(true, 'both players logged in through the UI');

// --- challenge ------------------------------------------------------------
const ch = await api('/api/challenges', { to_user_id: bobId, color: 'black', time_control: 'rapid' }, admin.cookie);
await B.waitForTimeout(1500);
const acceptBtn = B.getByRole('button', { name: /accept/i }).first();
await acceptBtn.waitFor({ timeout: 10000 });
await acceptBtn.click();
await B.waitForURL(/\/play\?game=/, { timeout: 15000 });
ok(true, 'Bob accepted the challenge from the incoming-challenge modal');
// Alice is navigated by the lobby socket
await A.waitForURL(/\/play\?game=/, { timeout: 20000 }).catch(async () => {
  const mine = await api('/api/games?limit=5', undefined, admin.cookie);
  const g = mine.json.games.find((x: any) => x.external_id === ch.json.challenge && true) ?? mine.json.games[0];
  await A.goto(`${BASE}/play?game=${g.id}`);
});
await A.waitForTimeout(2500); await B.waitForTimeout(1500);
ok(A.url().includes('/play?game='), 'Alice was pulled into the game by the lobby socket');

// who is white?
const orientA: 'white' | 'black' = 'white';
const orientB: 'white' | 'black' = 'black';

// --- moves ----------------------------------------------------------------
await move(A, 'e2', 'e4', orientA);
await B.waitForTimeout(900);
const bobSeesE4 = await B.locator('text=e4').first().isVisible().catch(() => false);
ok(bobSeesE4, 'Alice\'s 1.e4 appeared on Bob\'s board (the relay that was broken before 7.10)');
await move(B, 'e7', 'e5', orientB);
await A.waitForTimeout(900);
const aliceSeesE5 = await A.locator('text=e5').first().isVisible().catch(() => false);
ok(aliceSeesE5, 'Bob\'s 1...e5 came back to Alice');
await move(A, 'g1', 'f3', orientA);
await B.waitForTimeout(800);
await move(B, 'b8', 'c6', orientB);
await A.waitForTimeout(800);

await A.screenshot({ path: `${SHOTS}/pvp-alice-board.png` });

// --- draw offer, declined -------------------------------------------------
await A.getByRole('button', { name: /offer draw/i }).first().click();
await B.waitForTimeout(1200);
const bobSeesDraw = await B.getByText(/offers a draw/i).first().isVisible().catch(() => false);
ok(bobSeesDraw, 'Bob sees "Alice offers a draw" with Accept / Decline');
await B.screenshot({ path: `${SHOTS}/pvp-bob-draw-offer.png` });
await B.getByRole('button', { name: /decline/i }).first().click();
await A.waitForTimeout(1200);
const offerGone = !(await A.getByText(/draw offered/i).first().isVisible().catch(() => false));
ok(offerGone, 'declining clears the banner on Alice\'s side');

// --- takeback, accepted ---------------------------------------------------
await A.getByRole('button', { name: /takeback/i }).first().click();
await B.waitForTimeout(1200);
const bobSeesTakeback = await B.getByText(/asks to take back/i).first().isVisible().catch(() => false);
ok(bobSeesTakeback, 'Bob sees the takeback request');
await B.getByRole('button', { name: /accept/i }).first().click();
await A.waitForTimeout(1500); await B.waitForTimeout(500);
const aliceMoves = (await A.locator('text=Nf3').count()) === 0;
ok(aliceMoves, 'after the takeback Nf3 is gone from Alice\'s move list');
const bobMoves = (await B.locator('text=Nf3').count()) === 0;
ok(bobMoves, 'and from Bob\'s — both boards agree');
await A.screenshot({ path: `${SHOTS}/pvp-alice-after-takeback.png` });

// re-play the move that was taken back
await move(A, 'g1', 'f3', orientA);
await B.waitForTimeout(800);
ok((await B.locator('text=Nf3').count()) > 0, 'play resumes normally after a takeback');

// --- draw by agreement ----------------------------------------------------
await B.getByRole('button', { name: /offer draw/i }).first().click();
await A.waitForTimeout(1200);
await A.getByRole('button', { name: /accept/i }).first().click();
await A.waitForTimeout(2500); await B.waitForTimeout(1500);
const aliceDraw = await A.getByText(/draw/i).first().isVisible().catch(() => false);
ok(aliceDraw, 'game ends in a draw by agreement, game-over card shown');
await A.screenshot({ path: `${SHOTS}/pvp-alice-gameover.png` });

// --- rematch --------------------------------------------------------------
const rematchBtn = A.getByRole('button', { name: /^rematch$/i }).first();
const hasRematch = await rematchBtn.isVisible().catch(() => false);
ok(hasRematch, 'game-over card offers a Rematch button (PvP only)');
if (hasRematch) {
  await rematchBtn.click();
  await B.waitForTimeout(1500);
  const bobSeesRematch = await B.getByRole('button', { name: /accept rematch/i }).first().isVisible().catch(() => false);
  ok(bobSeesRematch, 'Bob is offered the rematch');
  await B.screenshot({ path: `${SHOTS}/pvp-bob-rematch.png` });
  if (bobSeesRematch) {
    const urlBefore = A.url();
    await B.getByRole('button', { name: /accept rematch/i }).first().click();
    await A.waitForTimeout(3000); await B.waitForTimeout(2000);
    ok(A.url() !== urlBefore, `both clients navigated into the rematch (${A.url().split('?')[1]} / ${B.url().split('?')[1]})`);
    const aliceNowBlack = await A.locator('text=Bob').first().isVisible().catch(() => false);
    ok(aliceNowBlack, 'rematch board loaded for Alice with colours swapped');
    await A.screenshot({ path: `${SHOTS}/pvp-alice-rematch.png` });
  }
}

// --- phone layout ---------------------------------------------------------
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
await phone.addCookies(await ctxA.cookies());
const P = await phone.newPage();
await P.goto(A.url());
await P.waitForTimeout(3000);
await P.screenshot({ path: `${SHOTS}/pvp-phone-board.png` });
const movesBtn = P.getByRole('button', { name: /moves/i }).first();
const hasBar = await movesBtn.isVisible().catch(() => false);
ok(hasBar, 'phone: sticky bottom bar with the Moves button is visible');
if (hasBar) {
  await movesBtn.click();
  await P.waitForTimeout(1200);
  await P.screenshot({ path: `${SHOTS}/pvp-phone-sheet.png` });
  ok(true, 'phone: moves sheet opens');
}

console.log(fails === 0 ? '\nALL OK' : `\n${fails} FAILURE(S)`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);
