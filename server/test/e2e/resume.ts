// End-to-end proof that a game survives losing its socket — the thing that
// broke when you switched apps on a phone and came back. Drives a real server
// on a throwaway database: play, kill the socket outright, reconnect, and
// check the game is still there and still playable.
//
// Not part of `npm test` (it binds a port and starts the whole server plus
// Stockfish). Run it with `npm run test:resume`.

import WebSocket from 'ws';
import { setTimeout as sleep } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const PORT = Number(process.env.PORT ?? 8897);
const BASE = `http://127.0.0.1:${PORT}`;
process.env.PORT = String(PORT);
process.env.HOST = '127.0.0.1';
const dbPath = process.env.DB_PATH ?? join(tmpdir(), `patzer-resume-${process.pid}.db`);
process.env.DB_PATH = dbPath;
for (const suffix of ['', '-wal', '-shm']) { try { rmSync(dbPath + suffix, { force: true }); } catch { /* ignore */ } }

let failures = 0;
function check(cond: unknown, label: string) {
  if (cond) console.log(`  ok   ${label}`);
  else { failures++; console.log(`  FAIL ${label}`); }
}

async function api(path: string, body?: unknown, cookie?: string, method?: string): Promise<{ status: number; json: any; cookie?: string }> {
  const res = await fetch(BASE + path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
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
  constructor(url: string, cookie: string) {
    this.ws = new WebSocket(url, { headers: { Cookie: cookie } });
    this.ws.on('message', (raw) => this.msgs.push(JSON.parse(raw.toString())));
    this.ws.on('error', () => { /* a deliberately killed socket is not news */ });
  }
  open() { return new Promise<void>((res, rej) => { this.ws.once('open', () => res()); this.ws.once('error', rej); }); }
  send(type: string, extra: Record<string, unknown> = {}) { this.ws.send(JSON.stringify({ type, ...extra })); }
  async wait(type: string, timeoutMs = 15000): Promise<any> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const i = this.msgs.findIndex((m) => m.type === type);
      if (i >= 0) return this.msgs.splice(i, 1)[0];
      await sleep(25);
    }
    throw new Error(`timeout waiting for ${type}; have ${JSON.stringify(this.msgs)}`);
  }
  /** Not close() — terminate(), because a phone going to sleep doesn't say goodbye. */
  kill() { this.ws.terminate(); }
}

const botUrl = `ws://127.0.0.1:${PORT}/ws/play`;

async function main() {
  await import('../../src/index.js');
  await sleep(800);

  console.log('setup');
  const admin = await api('/api/setup/init', { username: 'alice', password: 'alicepassword1', display_name: 'Alice' });
  check(admin.status === 200 && !!admin.cookie, 'setup creates admin + session');
  const alice = admin.cookie!;

  console.log('bot game: nothing to resume on a clean account');
  const live0 = await api('/api/games/live', undefined, alice);
  check(live0.status === 200 && live0.json.bot === null && live0.json.pvp.length === 0, 'no live games yet');

  console.log('bot game: play two moves');
  const A = new Client(botUrl, alice);
  await A.open();
  await A.wait('hello');
  A.send('new_game', { difficulty: 'kid', color: 'white', time_control: 'rapid' });
  await A.wait('game_started');
  A.send('move', { uci: 'e2e4' });
  await A.wait('move_made');            // ours
  const botReply = await A.wait('move_made'); // the engine's
  check(botReply.by === 'engine', 'the bot replied');
  A.send('move', { uci: 'd2d4' });
  await A.wait('move_made');
  await A.wait('move_made');
  await sleep(300);

  const live1 = await api('/api/games/live', undefined, alice);
  check(live1.json.bot?.ply === 4, `the game in progress is listed (ply ${live1.json.bot?.ply})`);
  check(live1.json.bot?.difficulty === 'kid' && live1.json.bot?.user_color === 'white', 'with its difficulty and colour');

  console.log('bot game: kill the socket the way a sleeping phone does');
  A.kill();
  await sleep(500);

  const stillThere = await api('/api/games/live', undefined, alice);
  check(stillThere.json.bot?.ply === 4, 'the game is still there after the socket died');

  const B = new Client(botUrl, alice);
  await B.open();
  await B.wait('hello');
  B.send('resume');
  const resumed = await B.wait('game_started');
  check(resumed.resumed === true, 'server confirms this is a resume');
  check(resumed.history?.length === 4, `the moves came back (${(resumed.history ?? []).join(' ')})`);
  check(resumed.userColor === 'white' && resumed.difficulty === 'kid', 'same colour, same opponent');
  check(resumed.turn === 'w', 'and it is our move again');

  console.log('bot game: it is still playable');
  B.send('move', { uci: 'g1f3' });
  const mine = await B.wait('move_made');
  check(mine.by === 'user', 'the resumed game accepts a move');
  await B.wait('move_made');
  await sleep(300);
  const live2 = await api('/api/games/live', undefined, alice);
  check(live2.json.bot?.ply === 6, `and keeps saving (ply ${live2.json.bot?.ply})`);

  console.log('bot game: resigning clears it');
  B.send('resign');
  await B.wait('game_over');
  await B.wait('game_saved');
  const live3 = await api('/api/games/live', undefined, alice);
  check(live3.json.bot === null, 'a finished game is no longer resumable');
  B.kill();

  console.log('bot game: discard');
  const C = new Client(botUrl, alice);
  await C.open();
  await C.wait('hello');
  C.send('new_game', { difficulty: 'kid', color: 'white', time_control: 'untimed' });
  await C.wait('game_started');
  C.send('move', { uci: 'e2e4' });
  await C.wait('move_made'); await C.wait('move_made');
  await sleep(300);
  check((await api('/api/games/live', undefined, alice)).json.bot !== null, 'game stored');
  const del = await api('/api/games/live/bot', undefined, alice, 'DELETE');
  check(del.status === 200, 'discard returns ok');
  check((await api('/api/games/live', undefined, alice)).json.bot === null, 'and the game is gone');
  C.kill();

  console.log('pvp: a friend game outlives both sockets');
  const bobCreate = await api('/api/admin/users', { username: 'bob', password: 'bobpassword12', display_name: 'Bob', role: 'user' }, alice);
  check(bobCreate.status === 200 || bobCreate.status === 201, 'bob exists');
  const bobLogin = await api('/api/auth/login', { username: 'bob', password: 'bobpassword12' });
  const bob = bobLogin.cookie!;
  const bobId = bobLogin.json?.user?.id ?? bobCreate.json?.user?.id;

  const ch = await api('/api/challenges', { to_user_id: bobId, color: 'black', time_control: 'rapid' }, alice);
  const acc = await api(`/api/challenges/${ch.json.challenge.id}/accept`, {}, bob);
  const bobGame = acc.json.game_id as number;
  const aliceGames = await api('/api/games?limit=5', undefined, alice);
  const aliceGame = (aliceGames.json?.games ?? []).find((g: any) => g.external_id === acc.json.external_id)?.id ?? (bobGame - 1);

  const P = new Client(`${botUrl}?game=${aliceGame}`, alice);
  const Q = new Client(`${botUrl}?game=${bobGame}`, bob);
  await Promise.all([P.open(), Q.open()]);
  await P.wait('pvp_hello'); await Q.wait('pvp_hello');
  P.send('move', { uci: 'e2e4' }); await P.wait('move_made'); await Q.wait('move_made');
  Q.send('move', { uci: 'e7e5' }); await P.wait('move_made'); await Q.wait('move_made');

  const livePvp = await api('/api/games/live', undefined, alice);
  check(livePvp.json.pvp.length === 1 && livePvp.json.pvp[0].ply === 2, 'the unfinished friend game is listed');
  check(livePvp.json.pvp[0].opponent === 'Bob' && livePvp.json.pvp[0].game_id === aliceGame, 'with the opponent and a way back in');

  console.log('pvp: both phones go to sleep');
  P.kill(); Q.kill();
  await sleep(500);

  const P2 = new Client(`${botUrl}?game=${aliceGame}`, alice);
  await P2.open();
  const back = await P2.wait('pvp_hello');
  check(JSON.stringify(back.history) === JSON.stringify(['e4', 'e5']), `alice gets her game back (${(back.history ?? []).join(' ')})`);
  check(back.whiteTimeMs < 600_000, 'her clock kept running while she was away, as a real clock would');

  const Q2 = new Client(`${botUrl}?game=${bobGame}`, bob);
  await Q2.open();
  await Q2.wait('pvp_hello');
  P2.send('move', { uci: 'g1f3' });
  const relayed = await Q2.wait('move_made');
  check(relayed.san === 'Nf3', 'and the game plays on between the reconnected pair');
  P2.kill(); Q2.kill();

  await sleep(200);
  console.log(failures === 0 ? '\nAll resume checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
