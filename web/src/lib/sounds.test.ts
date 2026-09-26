// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A minimal Web Audio stand-in that records the start frequency of every
// oscillator, which is enough to tell the bell sounds from the marimba ones,
// and which recording (by URL) every decoded-sample source plays.
const started: number[] = [];
const samples: string[] = [];

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
  playbackRate = new FakeParam();
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
  createBufferSource() {
    const n = new FakeNode();
    n.start = () => { const tag = (n.buffer as { tag?: string } | null)?.tag; if (tag) samples.push(tag); };
    return n;
  }
  createDynamicsCompressor() { return new FakeNode(); }
  createConvolver() { return new FakeNode(); }
  createBuffer(_c: number, len: number) { return { getChannelData: () => new Float32Array(len) }; }
  resume() { return Promise.resolve(); }
  // The fake fetch below hands back the URL as the "bytes", so each decoded
  // buffer remembers which file it came from.
  decodeAudioData(data: unknown) { return Promise.resolve({ tag: String(data) }); }
}
const fetchOk = vi.fn(async (url: string) => ({ ok: true, status: 200, arrayBuffer: async () => url }));

describe('sound sets', () => {
  beforeEach(() => {
    started.length = 0;
    samples.length = 0;
    vi.resetModules();
    vi.stubGlobal('AudioContext', FakeContext);
    fetchOk.mockClear();
    vi.stubGlobal('fetch', fetchOk);
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

describe('board move sounds', () => {
  beforeEach(() => {
    started.length = 0;
    samples.length = 0;
    vi.resetModules();
    vi.stubGlobal('AudioContext', FakeContext);
    fetchOk.mockClear();
    vi.stubGlobal('fetch', fetchOk);
  });

  it('classic stays the default and never downloads the recordings', async () => {
    const { playSound } = await import('./sounds');
    playSound('move'); playSound('capture'); playSound('castle');
    expect(started).toContain(280);
    expect(samples).toEqual([]);
    expect(fetchOk).not.toHaveBeenCalled();
  });

  it('board plays the recordings for move, capture and castle (king + rook)', async () => {
    const { playSound, setMoveSoundSet, moveSoundsReady } = await import('./sounds');
    setMoveSoundSet('board');
    await moveSoundsReady();
    playSound('move'); playSound('capture'); playSound('castle');
    expect(samples).toEqual([
      expect.stringMatching(/board-move\.wav$/),
      expect.stringMatching(/board-capture\.wav$/),
      expect.stringMatching(/board-move\.wav$/),
      expect.stringMatching(/board-move\.wav$/),
    ]);
    // no synthesized knock underneath
    for (const f of [280, 165, 240]) expect(started).not.toContain(f);
  });

  it('check, promotion and game end keep their own sounds', async () => {
    const { playSound, setMoveSoundSet, moveSoundsReady } = await import('./sounds');
    setMoveSoundSet('board');
    await moveSoundsReady();
    playSound('check'); playSound('promotion'); playSound('game_end');
    expect(samples).toEqual([]);
    expect(started).toContain(1175);
  });

  it('falls back to the synthesized knock while the recordings are still loading', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const { playSound, setMoveSoundSet } = await import('./sounds');
    setMoveSoundSet('board');
    playSound('move');
    expect(started).toContain(280);
    expect(samples).toEqual([]);
  });

  it('falls back to the synthesized knock if the recordings cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, arrayBuffer: async () => '' })));
    const { playSound, setMoveSoundSet, moveSoundsReady } = await import('./sounds');
    setMoveSoundSet('board');
    await moveSoundsReady();
    playSound('move');
    expect(started).toContain(280);
    expect(samples).toEqual([]);
  });

  it('switching back to classic uses the synthesized knock again', async () => {
    const { playSound, setMoveSoundSet, moveSoundsReady } = await import('./sounds');
    setMoveSoundSet('board');
    await moveSoundsReady();
    setMoveSoundSet('classic');
    playSound('move');
    expect(started).toContain(280);
    expect(samples).toEqual([]);
  });
});
