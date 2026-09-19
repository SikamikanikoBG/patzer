// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { speak, cancel } from './tts';

// The coach's mute button ultimately calls cancel(). Speech starts on two
// deferred paths — a setTimeout(0) to dodge a Chrome bug, and a wait for the
// OS voice list — and a cancel landing inside either window used to be
// ignored, so the coach kept talking after you muted it.

type Listener = () => void;
let spoken: string[];
let voices: { name: string; lang: string; voiceURI: string }[];
let voicesListeners: Listener[];

beforeEach(() => {
  vi.useFakeTimers();
  spoken = [];
  voicesListeners = [];
  voices = [{ name: 'Test Voice', lang: 'en-US', voiceURI: 'test' }];
  (globalThis as unknown as { speechSynthesis: unknown }).speechSynthesis = {
    getVoices: () => voices,
    speak: (u: { text: string }) => { spoken.push(u.text); },
    cancel: () => { /* native cancel clears the queue; our own state is the generation counter */ },
    addEventListener: (_: string, cb: Listener) => { voicesListeners.push(cb); },
    removeEventListener: (_: string, cb: Listener) => { voicesListeners = voicesListeners.filter((l) => l !== cb); },
  };
  (globalThis as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance =
    class { text: string; rate = 1; pitch = 1; lang = ''; voice: unknown = null; onend: unknown = null; onerror: unknown = null;
      constructor(t: string) { this.text = t; } };
});

describe('tts cancel', () => {
  it('speaks normally when nothing cancels', () => {
    speak('your knight is hanging');
    vi.runAllTimers();
    expect(spoken).toEqual(['your knight is hanging']);
  });

  it('a cancel inside the deferral window stops the utterance', () => {
    speak('your knight is hanging');
    cancel(); // this is what the mute button does
    vi.runAllTimers();
    expect(spoken).toEqual([]);
  });

  it('a cancel while waiting for the OS voice list stops the queued speech', () => {
    voices = []; // Windows/Chrome often has no voices on first use
    speak('your knight is hanging');
    expect(spoken).toEqual([]);

    cancel();
    voices = [{ name: 'Test Voice', lang: 'en-US', voiceURI: 'test' }];
    voicesListeners.forEach((cb) => cb()); // voiceschanged fires later
    vi.runAllTimers();

    expect(spoken).toEqual([]);
  });

  it('still speaks when the voice list arrives and nothing cancelled', () => {
    voices = [];
    speak('your knight is hanging');
    voices = [{ name: 'Test Voice', lang: 'en-US', voiceURI: 'test' }];
    voicesListeners.forEach((cb) => cb());
    vi.runAllTimers();
    expect(spoken).toEqual(['your knight is hanging']);
  });

  it('a cancel does not block the next thing you ask for', () => {
    speak('first');
    cancel();
    vi.runAllTimers();
    expect(spoken).toEqual([]);

    speak('second');
    vi.runAllTimers();
    expect(spoken).toEqual(['second']);
  });
});
