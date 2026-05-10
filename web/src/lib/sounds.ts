// Web Audio synthesized chess sound effects. No external assets — works offline,
// keeps the bundle tiny. Each sound is a short shaped tone or noise burst.

type SoundKind = 'move' | 'capture' | 'check' | 'castle' | 'promotion' | 'game_start' | 'game_end' | 'click';

let ctx: AudioContext | null = null;
let enabled = true;

function audioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (ctx) return ctx;
  try {
    const Ctor = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    ctx = new Ctor();
  } catch { return null; }
  return ctx;
}

export function setSoundEnabled(on: boolean) { enabled = on; }
export function getSoundEnabled() { return enabled; }

// Some browsers require user interaction before audio plays. Call this once
// from a click/keydown handler to "warm" the context.
export function unlockAudio() {
  const c = audioCtx();
  if (c && c.state === 'suspended') void c.resume();
}

function tone(opts: { freq: number; duration: number; type?: OscillatorType; gain?: number; attack?: number; release?: number; freqEnd?: number }) {
  if (!enabled) return;
  const c = audioCtx();
  if (!c) return;
  if (c.state === 'suspended') void c.resume();
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(opts.freq, c.currentTime);
  if (opts.freqEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.freqEnd), c.currentTime + opts.duration);
  }
  const peak = opts.gain ?? 0.18;
  const attack = opts.attack ?? 0.005;
  const release = opts.release ?? opts.duration;
  g.gain.setValueAtTime(0.0001, c.currentTime);
  g.gain.exponentialRampToValueAtTime(peak, c.currentTime + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + release);
  osc.connect(g).connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + opts.duration + 0.05);
}

function noiseBurst(opts: { duration: number; gain?: number; cutoff?: number; q?: number }) {
  if (!enabled) return;
  const c = audioCtx();
  if (!c) return;
  if (c.state === 'suspended') void c.resume();
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * opts.duration), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = opts.cutoff ?? 1500;
  filter.Q.value = opts.q ?? 1;
  const g = c.createGain();
  const peak = opts.gain ?? 0.16;
  g.gain.setValueAtTime(peak, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + opts.duration);
  src.connect(filter).connect(g).connect(c.destination);
  src.start();
  src.stop(c.currentTime + opts.duration + 0.05);
}

export function playSound(kind: SoundKind) {
  if (!enabled) return;
  switch (kind) {
    case 'move':
      tone({ freq: 220, duration: 0.06, type: 'triangle', gain: 0.16 });
      break;
    case 'capture':
      noiseBurst({ duration: 0.10, cutoff: 1200, gain: 0.22 });
      tone({ freq: 130, duration: 0.10, type: 'square', gain: 0.12 });
      break;
    case 'check':
      tone({ freq: 880, duration: 0.10, type: 'sine', gain: 0.16 });
      setTimeout(() => tone({ freq: 660, duration: 0.18, type: 'sine', gain: 0.14 }), 90);
      break;
    case 'castle':
      tone({ freq: 200, duration: 0.05, type: 'triangle', gain: 0.14 });
      setTimeout(() => tone({ freq: 240, duration: 0.05, type: 'triangle', gain: 0.14 }), 45);
      break;
    case 'promotion':
      tone({ freq: 440, duration: 0.18, type: 'sine', gain: 0.16, freqEnd: 880 });
      break;
    case 'game_start':
      tone({ freq: 392, duration: 0.10, type: 'sine', gain: 0.14 });
      setTimeout(() => tone({ freq: 523, duration: 0.18, type: 'sine', gain: 0.14 }), 90);
      break;
    case 'game_end':
      tone({ freq: 523, duration: 0.16, type: 'sine', gain: 0.14 });
      setTimeout(() => tone({ freq: 392, duration: 0.20, type: 'sine', gain: 0.14, freqEnd: 261 }), 140);
      break;
    case 'click':
      tone({ freq: 700, duration: 0.04, type: 'sine', gain: 0.10 });
      break;
  }
}

// Decide which sound to play for a SAN/UCI move + flags.
export function soundForMove(args: { san?: string; capture?: boolean; check?: boolean; castle?: boolean; promotion?: boolean }) {
  if (args.castle) return playSound('castle');
  if (args.promotion) return playSound('promotion');
  if (args.check) return playSound('check');
  if (args.capture) return playSound('capture');
  return playSound('move');
}

// Quick deduce flags from SAN string (used in places where chess.js move object isn't handy).
export function inferMoveFlagsFromSan(san: string): { capture: boolean; check: boolean; castle: boolean; promotion: boolean } {
  return {
    capture: san.includes('x'),
    check: san.endsWith('+') || san.endsWith('#'),
    castle: san === 'O-O' || san === 'O-O-O' || san === '0-0' || san === '0-0-0',
    promotion: /=[QRBN]/.test(san),
  };
}
