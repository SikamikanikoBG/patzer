// A WebSocket that comes back.
//
// A game page can't treat a dropped socket as the end of the game: phones
// freeze backgrounded tabs, Wi-Fi hands over to mobile data, laptops suspend.
// Until v7.14.0 Patzer's play socket had `onclose = () => {}`, so any of those
// silently ended the game while the board carried on looking alive.
//
// Kept deliberately small and injectable — `open` and `random` are parameters
// so this can be tested without a browser or a server.

export type Msg = Record<string, unknown>;

export interface SocketLike {
  readyState: number;
  close(): void;
  send(data: string): void;
  onopen: (() => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

export const CONNECTING = 0;
export const OPEN = 1;

/**
 * 0.5s, 1s, 2s, 4s, then 8s forever, each jittered by ±20% so a server coming
 * back up doesn't get every client in the same millisecond.
 */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(8000, 500 * 2 ** attempt);
  return Math.round(base * (0.8 + random() * 0.4));
}

export interface ReconnectingSocketOptions {
  open: (url: string) => SocketLike;
  onMessage: (ev: MessageEvent) => void;
  onStatusChange: (connected: boolean) => void;
  random?: () => number;
}

export class ReconnectingSocket {
  private opts: ReconnectingSocketOptions;
  private ws: SocketLike | null = null;
  private url = '';
  private firstMessage: Msg | null = null;
  private reopenMessage: Msg | null = null;
  /** Whether a connection is wanted at all. Nothing reconnects while false. */
  private want = false;
  /** True once this connect() has been established at least once, so we know
   *  to send the reopen message rather than the opening one. */
  private established = false;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: ReconnectingSocketOptions) {
    this.opts = opts;
  }

  get connected(): boolean {
    return this.ws?.readyState === OPEN;
  }

  /**
   * Open `url`, sending `firstMessage` on the first connection and
   * `reopenMessage` on every reconnection after it. The two differ because
   * opening a bot game means "new game" but coming back to one means "resume".
   */
  connect(url: string, firstMessage: Msg | null, reopenMessage: Msg | null = firstMessage): void {
    this.url = url;
    this.firstMessage = firstMessage;
    this.reopenMessage = reopenMessage;
    this.want = true;
    this.established = false;
    this.attempt = 0;
    this.clearTimer();
    this.dial();
  }

  /** Stop wanting a connection and close the current one. */
  disconnect(): void {
    this.want = false;
    this.clearTimer();
    const ws = this.ws;
    this.ws = null;
    if (ws) { try { ws.close(); } catch { /* ignore */ } }
  }

  send(payload: Msg): boolean {
    if (!this.ws || this.ws.readyState !== OPEN) return false;
    try { this.ws.send(JSON.stringify(payload)); return true; } catch { return false; }
  }

  /**
   * "We're back" — from `visibilitychange`, `online` or `pageshow`. Retries
   * immediately and resets the backoff, because a scheduled retry may be 8
   * seconds away and the user is looking at the board right now.
   */
  wake(): void {
    if (!this.want) return;
    if (this.ws && (this.ws.readyState === OPEN || this.ws.readyState === CONNECTING)) return;
    this.attempt = 0;
    this.clearTimer();
    this.dial();
  }

  private dial(): void {
    if (!this.want) return;
    const ws = this.opts.open(this.url);
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.attempt = 0;
      const msg = this.established ? this.reopenMessage : this.firstMessage;
      this.established = true;
      if (msg) { try { ws.send(JSON.stringify(msg)); } catch { /* ignore */ } }
      this.opts.onStatusChange(true);
    };
    ws.onmessage = (ev) => { if (this.ws === ws) this.opts.onMessage(ev); };
    ws.onclose = () => {
      // A socket we already replaced is not news.
      if (this.ws !== ws) return;
      this.opts.onStatusChange(false);
      this.schedule();
    };
    ws.onerror = () => { /* onclose always follows */ };
  }

  private schedule(): void {
    if (!this.want || this.timer) return;
    const delay = backoffMs(this.attempt, this.opts.random ?? Math.random);
    this.attempt += 1;
    this.timer = setTimeout(() => { this.timer = null; this.dial(); }, delay);
  }

  private clearTimer(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }
}
