import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isNewer, parseVersion } from '../src/updates.js';

describe('parseVersion', () => {
  it('reads plain and v-prefixed tags', () => {
    expect(parseVersion('7.10.1')).toEqual([7, 10, 1]);
    expect(parseVersion('v7.10.1')).toEqual([7, 10, 1]);
    expect(parseVersion(' v8.0.0 ')).toEqual([8, 0, 0]);
    expect(parseVersion('7.10.1-rc.2')).toEqual([7, 10, 1]);
  });
  it('gives up on anything else', () => {
    expect(parseVersion('unknown')).toEqual([]);
    expect(parseVersion('7.10')).toEqual([]);
    expect(parseVersion('')).toEqual([]);
  });
});

describe('isNewer', () => {
  it('compares numerically, not as strings', () => {
    // The string comparison everyone writes first gets this one wrong.
    expect(isNewer('7.10.0', '7.9.0')).toBe(true);
    expect(isNewer('7.9.0', '7.10.0')).toBe(false);
  });
  it('handles each position', () => {
    expect(isNewer('8.0.0', '7.10.1')).toBe(true);
    expect(isNewer('7.11.0', '7.10.1')).toBe(true);
    expect(isNewer('7.10.2', '7.10.1')).toBe(true);
    expect(isNewer('7.10.1', '7.10.1')).toBe(false);
    expect(isNewer('7.10.0', '7.10.1')).toBe(false);
    expect(isNewer('6.0.0', '7.10.1')).toBe(false);
  });
  it('never nags on junk — a weird upstream tag must not produce a notification', () => {
    expect(isNewer('latest', '7.10.1')).toBe(false);
    expect(isNewer('7.11.0', 'unknown')).toBe(false);
    expect(isNewer('', '')).toBe(false);
  });
  it('ignores a v prefix on either side', () => {
    expect(isNewer('v7.11.0', '7.10.1')).toBe(true);
    expect(isNewer('7.11.0', 'v7.10.1')).toBe(true);
  });
});

// The caching/HTTP half needs the db module, which opens SQLite on import, so
// it's covered by the e2e run rather than here. What matters most is the
// comparison above: it is the thing that decides whether a user sees a nudge.
describe('update check wiring', () => {
  beforeEach(() => vi.clearAllMocks());
  it('the module exposes what the route needs', async () => {
    const mod = await import('../src/updates.js');
    expect(typeof mod.checkForUpdate).toBe('function');
    expect(typeof mod.updateCheckEnabled).toBe('function');
    expect(typeof mod.setUpdateCheckEnabled).toBe('function');
  });
});
