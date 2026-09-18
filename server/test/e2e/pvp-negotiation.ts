// End-to-end drive of the PvP protocol (move relay, clocks, draw offers,
// takebacks, rematch) against a real server on a throwaway database. Not part
// of `npm test` — it binds a port and starts the whole server — run it with
// `npm run test:e2e`. It also proves the two players share one session (they
// did not, before 7.10: each side was keyed by its own games row id).

import WebSocket from 'ws';
import { setTimeout as sleep } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const PORT = Number(process.env.PORT ?? 8899);
const BASE = `http://127.0.0.1:${PORT}`;
process.env.PORT = String(PORT);
process.env.HOST = '127.0.0.1';
const dbPath = process.env.DB_PATH ?? join(tmpdir(), `patzer-e2e-${process.pid}.db`);
process.env.DB_PATH = dbPath;
for (const suffix of ['', '-wal', '-shm']) { try { rmSync(dbPath + suffix, { force: true }); } catch { /* ignore */ } }

let failures = 0;
function check(cond: unknown, label: string) {
  if (cond) console.log(`  ok   ${label}`);
  else { failures++; console.log(`  FAIL ${label}`); }
}

async function api(path: string, body?: unknown, cookie?: string): Promise<{ status: number; json: any; cookie?: string }> {
  const res = await fetch(BASE + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'patzer', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get('set-cookie') ?? undefined;
  let json: any = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json, cookie: setCookie ? setCookie.split(';')[0] : undefined };
}

class Client {
  msgs: any[] = [];
  ws: WebSocket;
  constructor(gameId: number, cookie: string) {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/play?game=${gameId}`, { headers: { Cookie: cookie } });
    this.ws.on('message', (raw) => this.msgs.push(JSON.parse(raw.toString())));
  }
  open() { return new Promise<void>((res, rej) => { this.ws.once('open', () => res()); this.ws.once('error', rej); }); }
  send(type: string, extra: Record<string, unknown> = {}) { this.ws.send(JSON.stringify({ type, ...extra })); }
  async wait(type: string, timeoutMs = 4000): Promise<any> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const i = this.msgs.findIndex((m) => m.type === type);
      if (i >= 0) return this.msgs.splice(i, 1)[0];
      await sleep(25);
    }
    throw new Error(`timeout waiting for ${type}; have ${JSON.stringify(this.msgs)}`);
  }
  has(type: string) { return this.msgs.some((m) => m.type === type); }
  close() { this.ws.close(); }
}

async function main() {
  await import('../../src/index.js');
  await sleep(800);

  console.log('setup + users');
  const admin = await api('/api/setup/init', { username: 'alice', password: 'alicepassword1', display_name: 'Alice' });
  check(admin.status === 200 && admin.cookie, 'setup creates admin + session');
  const aliceCookie = admin.cookie!;
  const bobCreate = await api('/api/admin/users', { username: 'bob', password: 'bobpassword12', display_name: 'Bob', role: 'user' }, aliceCookie);
  check(bobCreate.status === 200 || bobCreate.status === 201, `admin creates bob (${bobCreate.status})`);
  const bobLogin = await api('/api/auth/login', { username: 'bob', password: 'bobpassword12' });
  check(bobLogin.status === 200 && bobLogin.cookie, 'bob logs in');
  const bobCookie = bobLogin.cookie!;
  const bobId = bobLogin.json?.user?.id ?? bobCreate.json?.user?.id;

  console.log('challenge → accept (rapid)');
  // `color` is the colour the *acceptor* plays.
  const ch = await api('/api/challenges', { to_user_id: bobId, color: 'black', time_control: 'rapid' }, aliceCookie);
  check(ch.status === 200, 'alice challenges bob (bob to play black)');
  const acc = await api(`/api/challenges/${ch.json.challenge.id}/accept`, {}, bobCookie);
  check(acc.status === 200 && acc.json.your_color === 'black', 'bob accepts, gets black');
  const bobGame = acc.json.game_id as number;
  // Alice's own row id: lobby WS would deliver it; look it up via her games list.
  const aliceGames = await api('/api/games?limit=5', undefined, aliceCookie);
  const aliceGame = (aliceGames.json?.games ?? aliceGames.json ?? []).find((g: any) => g.external_id === acc.json.external_id)?.id
    ?? (bobGame - 1);

  const A = new Client(aliceGame, aliceCookie);
  const B = new Client(bobGame, bobCookie);
  await Promise.all([A.open(), B.open()]);
  const helloA = await A.wait('pvp_hello');
  const helloB = await B.wait('pvp_hello');
  await A.wait('opponent_status').catch(() => null);
  check(helloA.your_color === 'white' && helloB.your_color === 'black', 'colours as expected');
  check(helloA.whiteTimeMs === 600_000 && helloB.blackTimeMs === 600_000, `clocks resolved from "600+0" (got ${helloA.whiteTimeMs})`);

  console.log('draw: offer → decline → offer → accept');
  A.send('offer_draw');
  check((await B.wait('draw_offered')).by === 'white', 'bob sees the offer');
  await A.wait('draw_offered');
  B.send('decline_draw');
  check((await A.wait('draw_declined')).by === 'black', 'alice sees the decline');
  await B.wait('draw_declined');
  A.send('move', { uci: 'e2e4' }); await A.wait('move_made'); await B.wait('move_made');
  B.send('move', { uci: 'e7e5' }); await A.wait('move_made'); await B.wait('move_made');
  B.send('accept_draw');
  await sleep(200);
  check(!A.has('game_over'), 'accepting a non-existent offer does nothing');

  console.log('takeback: alice plays Nf3, bob replies Nc6, alice wants Nf3 back');
  A.send('move', { uci: 'g1f3' }); await A.wait('move_made'); await B.wait('move_made');
  B.send('move', { uci: 'b8c6' }); await A.wait('move_made'); await B.wait('move_made');
  A.send('request_takeback');
  check((await B.wait('takeback_requested')).by === 'white', 'bob sees the takeback request');
  await A.wait('takeback_requested');
  B.send('accept_takeback');
  const tbA = await A.wait('takeback_applied');
  const tbB = await B.wait('takeback_applied');
  check(JSON.stringify(tbA.history) === JSON.stringify(['e4', 'e5']) && tbA.turn === 'w', `two plies undone → ${tbA.history.join(' ')}`);
  check(tbB.fen === tbA.fen, 'both sides agree on the position');
  A.send('move', { uci: 'f1c4' }); await A.wait('move_made'); await B.wait('move_made');
  B.send('request_takeback');
  await A.wait('takeback_requested'); await B.wait('takeback_requested');
  A.send('decline_takeback');
  check((await B.wait('takeback_declined')).by === 'white', 'takeback can be declined');

  console.log('draw by agreement');
  B.send('offer_draw'); await A.wait('draw_offered'); await B.wait('draw_offered');
  A.send('accept_draw');
  const goA = await A.wait('game_over');
  const goB = await B.wait('game_over');
  check(goA.result === '1/2-1/2' && goA.reason === 'agreement' && goB.reason === 'agreement', 'game_over 1/2-1/2 by agreement');
  await A.wait('game_saved'); await B.wait('game_saved');

  console.log('rematch: offer → accept → colours swapped, same clocks');
  B.send('offer_rematch');
  check((await A.wait('rematch_offered')).by === 'black', 'alice sees the rematch offer');
  await B.wait('rematch_offered');
  A.send('accept_rematch');
  const rsA = await A.wait('rematch_start');
  const rsB = await B.wait('rematch_start');
  check(rsA.game_id && rsB.game_id && rsA.game_id !== rsB.game_id, `each side gets its own new game id (${rsA.game_id}/${rsB.game_id})`);
  A.close(); B.close();
  const A2 = new Client(rsA.game_id, aliceCookie);
  const B2 = new Client(rsB.game_id, bobCookie);
  await Promise.all([A2.open(), B2.open()]);
  const h2A = await A2.wait('pvp_hello');
  const h2B = await B2.wait('pvp_hello');
  check(h2A.your_color === 'black' && h2B.your_color === 'white', 'colours swapped for the rematch');
  check(h2A.whiteTimeMs === 600_000 && h2A.time_control === '600+0', `rematch keeps the time control (${h2A.time_control})`);
  check(h2A.history.length === 0, 'fresh board');
  A2.close(); B2.close();

  console.log(failures === 0 ? '\nALL OK' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
