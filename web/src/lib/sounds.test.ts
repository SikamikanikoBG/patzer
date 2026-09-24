// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A minimal Web Audio stand-in that records the start frequency of every
// oscillator, which is enough to tell the bell sounds from the marimba ones.
const started: number[] = [];

class FakeParam {
  value = 0;
  setValueAtTime(v: number) { this.value = v; return this; }
  exponentialRampToValueAtTime() { return this; }
}
class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  threshold = new FakeParam(); knee = new FakeParam(); ratio = new FakeParam();
  attack = new FakeParam(); release = new FakeParam();
  type = ''; buffer: unknown = null;
  connect<T>(n: T) { return n; }
  start() { started.push(this.frequency.value); }
  stop() {}
}
class FakeContext {
  sampleRate = 8000; currentTime = 0; state = 'running'; destination = new FakeNode();
  createGain() { return new FakeNode(); }
  createOscillator() { return new FakeNode(); }
  createBiquadFilter() { return new FakeNode(); }
  createBufferSource() { const n = new FakeNode(); n.start = () => {}; return n; }
  createDynamicsCompressor() { return new FakeNode(); }
  createConvolver() { return new FakeNode(); }
  createBuffer(_c: number, len: number) { return { getChannelData: () => new Float32Array(len) }; }
  resume() { return Promise.resolve(); }
}

describe('sound sets', () => {
  beforeEach(() => {
    started.length = 0;
    vi.resetModules();
    vi.stubGlobal('AudioContext', FakeContext);
  });

  it('classic check is the original two-tone bell', async () => {
    const { playSound } = await import('./sounds');
    playSound('check');
    expect(started).toContain(1175);
    expect(started).toContain(880);
  });

  it('soft check is two marimba notes, no bell', async () => {
    const { playSound, setSoundSet } = await import('./sounds');
    setSoundSet('soft');
    playSound('check');
    expect(started).toContain(659);
    expect(started).toContain(880);
    expect(started).not.toContain(1175);
  });

  it('soft game end keeps the classic G5 → E5 → C5 cadence', async () => {
    const { playSound, setSoundSet } = await import('./sounds');
    setSoundSet('soft');
    playSound('game_end');
    for (const f of [784, 659, 523]) expect(started).toContain(f);
  });

  it('an unknown set falls back to classic', async () => {
    const { playSound, setSoundSet } = await import('./sounds');
    setSoundSet('loud' as never);
    playSound('check');
    expect(started).toContain(1175);
  });

  it('move and capture sound the same in both sets', async () => {
    const { playSound, setSoundSet } = await import('./sounds');
    playSound('move'); playSound('capture');
    const classic = [...started];
    started.length = 0;
    setSoundSet('soft');
    playSound('move'); playSound('capture');
    expect(started).toEqual(classic);
  });
});
