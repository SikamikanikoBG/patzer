import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReconnectingSocket, backoffMs, OPEN, CONNECTING, type SocketLike } from './reconnectingSocket';

// A socket we can open, drop and inspect by hand — the whole point of this
// module is what happens when the network misbehaves, which a real socket is
// not going to do on request.
class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  readyState = CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { FakeSocket.all.push(this); }
  send(data: string) { this.sent.push(data); }
  close() { this.drop(); }
  /** The server accepted us. */
  accept() { this.readyState = OPEN; this.onopen?.(); }
  /** The connection went away, for whatever reason. */
  drop() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.();
  }
  deliver(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent); }
  get payloads() { return this.sent.map((s) => JSON.parse(s)); }
}

const latest = () => FakeSocket.all[FakeSocket.all.length - 1]!;

function build() {
  const messages: unknown[] = [];
  const statuses: boolean[] = [];
  const rs = new ReconnectingSocket({
    open: (url) => new FakeSocket(url),
    onMessage: (ev) => messages.push(JSON.parse((ev as MessageEvent).data)),
    onStatusChange: (up) => statuses.push(up),
    random: () => 0.5, // no jitter, so delays are predictable
  });
  return { rs, messages, statuses };
}

beforeEach(() => { FakeSocket.all = []; vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('backoffMs', () => {
  it('doubles up to an 8s ceiling', () => {
    const r = () => 0.5;
    expect(backoffMs(0, r)).toBe(500);
    expect(backoffMs(1, r)).toBe(1000);
    expect(backoffMs(2, r)).toBe(2000);
    expect(backoffMs(3, r)).toBe(4000);
    expect(backoffMs(4, r)).toBe(8000);
    expect(backoffMs(40, r)).toBe(8000);
  });
  it('jitters by ±20% so a restarted server is not stampeded', () => {
    expect(backoffMs(4, () => 0)).toBe(6400);
    expect(backoffMs(4, () => 1)).toBe(9600);
  });
});

describe('ReconnectingSocket', () => {
  it('sends the opening message once connected', () => {
    const { rs, statuses } = build();
    rs.connect('ws://x/play', { type: 'new_game' }, { type: 'resume' });
    expect(latest().payloads).toEqual([]); // nothing before the server answers
    latest().accept();
    expect(latest().payloads).toEqual([{ type: 'new_game' }]);
    expect(statuses).toEqual([true]);
  });

  it('reconnects after a drop and asks to RESUME, not to start a new game', () => {
    // The bug this guards: reconnecting with the opening message would deal a
    // fresh game over the top of the one the player was in.
    const { rs, statuses } = build();
    rs.connect('ws://x/play', { type: 'new_game' }, { type: 'resume' });
    latest().accept();

    latest().drop();
    expect(statuses).toEqual([true, false]);
    expect(FakeSocket.all).toHaveLength(1); // not yet — backoff is running

    vi.advanceTimersByTime(500);
    expect(FakeSocket.all).toHaveLength(2);
    latest().accept();
    expect(latest().payloads).toEqual([{ type: 'resume' }]);
    expect(statuses).toEqual([true, false, true]);
  });

  it('backs off across repeated failures and resets once it gets through', () => {
    const { rs } = build();
    rs.connect('ws://x/play', null);
    latest().accept();

    latest().drop();
    vi.advanceTimersByTime(500);
    expect(FakeSocket.all).toHaveLength(2);
    latest().drop();                       // second attempt fails too
    vi.advanceTimersByTime(999);
    expect(FakeSocket.all).toHaveLength(2); // 1000ms this time
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(3);

    latest().accept();                     // through — the ladder resets
    latest().drop();
    vi.advanceTimersByTime(500);
    expect(FakeSocket.all).toHaveLength(4);
  });

  it('retries immediately on wake instead of waiting out the backoff', () => {
    // The phone case: the retry may be 8s away and the user is looking at the
    // board right now.
    const { rs } = build();
    rs.connect('ws://x/play', null);
    latest().accept();
    latest().drop();
    vi.advanceTimersByTime(500);
    latest().drop();
    vi.advanceTimersByTime(1000);
    latest().drop();                        // next scheduled retry is 2s out

    rs.wake();
    expect(FakeSocket.all).toHaveLength(4); // immediately, not in 2s
    latest().accept();
    latest().drop();
    vi.advanceTimersByTime(500);            // and the ladder restarted at 500ms
    expect(FakeSocket.all).toHaveLength(5);
  });

  it('does nothing on wake while already connected or still dialling', () => {
    const { rs } = build();
    rs.connect('ws://x/play', null);
    rs.wake();
    expect(FakeSocket.all).toHaveLength(1); // still CONNECTING
    latest().accept();
    rs.wake();
    expect(FakeSocket.all).toHaveLength(1);
  });

  it('stops reconnecting once disconnected, and stays stopped', () => {
    const { rs } = build();
    rs.connect('ws://x/play', null);
    latest().accept();

    rs.disconnect();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(1);
    rs.wake();
    expect(FakeSocket.all).toHaveLength(1);
  });

  it('ignores a superseded socket that closes late', () => {
    const { rs, messages, statuses } = build();
    rs.connect('ws://x/play', null);
    const first = latest();
    first.accept();

    rs.connect('ws://x/play?game=7', null); // e.g. accepting a rematch
    const second = latest();
    second.accept();

    first.drop();          // the old socket finally notices it is gone
    first.deliver({ type: 'stale' });
    vi.advanceTimersByTime(10_000);

    expect(messages).toEqual([]);            // nothing from the dead socket
    expect(FakeSocket.all).toHaveLength(2);  // and no phantom reconnect
    expect(statuses).toEqual([true, true]);
  });

  it('routes messages from the live socket', () => {
    const { rs, messages } = build();
    rs.connect('ws://x/play', null);
    latest().accept();
    latest().deliver({ type: 'move_made', san: 'e4' });
    expect(messages).toEqual([{ type: 'move_made', san: 'e4' }]);
  });

  it('reports send failures instead of throwing while offline', () => {
    const { rs } = build();
    rs.connect('ws://x/play', null);
    expect(rs.send({ type: 'move' })).toBe(false); // not open yet
    latest().accept();
    expect(rs.send({ type: 'move', uci: 'e2e4' })).toBe(true);
    latest().drop();
    expect(rs.send({ type: 'move' })).toBe(false);
  });
});
