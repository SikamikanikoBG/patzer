import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withBusyRetry } from './busyRetry';

const busy = () => Object.assign(new Error('already_analyzing'), { status: 429 });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('withBusyRetry (#89)', () => {
  it('retries a 429 and returns the answer that follows', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(busy())
      .mockResolvedValueOnce({ lines: [{ uci: 'e2e4' }] });
    const p = withBusyRetry(send, () => false);
    await vi.advanceTimersByTimeAsync(900);
    await expect(p).resolves.toEqual({ lines: [{ uci: 'e2e4' }] });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('passes any other error straight through, without retrying', async () => {
    const boom = Object.assign(new Error('engine_failed'), { status: 500 });
    const send = vi.fn().mockRejectedValue(boom);
    await expect(withBusyRetry(send, () => false)).rejects.toBe(boom);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('gives up after the last retry', async () => {
    const send = vi.fn().mockRejectedValue(busy());
    const p = withBusyRetry(send, () => false, { retries: 2, delayMs: 10 });
    const settled = p.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(100);
    expect(((await settled) as { status: number }).status).toBe(429);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('stops retrying once the caller has moved on', async () => {
    let gone = false;
    const send = vi.fn().mockRejectedValue(busy());
    const p = withBusyRetry(send, () => gone);
    const settled = p.catch((e: unknown) => e);
    gone = true;
    await vi.advanceTimersByTimeAsync(5_000);
    await settled;
    expect(send).toHaveBeenCalledTimes(1);
  });
});

// The bug itself: Game Review's two callers of the single-flight endpoint must
// both retry, or whichever loses the race stays empty (#89).
describe('callers of /api/analyze/position in Game Review', () => {
  for (const file of ['../pages/GameAnalyzer.tsx', '../components/ThreatPanel.tsx']) {
    it(`${file} sends it through withBusyRetry`, () => {
      const src = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
      const calls = src.split("'/api/analyze/position'").length - 1;
      expect(calls).toBeGreaterThan(0);
      const wrapped = src.split(/withBusyRetry\(\(\) => api\.post<[^>]*>\('\/api\/analyze\/position'/).length - 1;
      expect(wrapped).toBe(calls);
    });
  }
});
