// Web Audio synthesized chess sound effects. No external assets — works
// offline, keeps the bundle tiny. The signal chain runs through a soft
// compressor + short convolution reverb (built from a decaying-noise impulse)
// so even the synthesized layers get a bit of room around them. Move/capture
// use wood-knock synthesis (transient noise click + low body resonance with
// quick pitch droop); check/promotion use inharmonic-bell additive synthesis
// (partials 1.0, 2.01, 2.99, 4.07 — close to a real handbell spectrum).

type SoundKind = 'move' | 'capture' | 'check' | 'castle' | 'promotion' | 'game_start' | 'game_end' | 'click';

let ctx: AudioContext | null = null;
let dryBus: GainNode | null = null;
let wetBus: GainNode | null = null;
let enabled = true;

interface Bus { c: AudioContext; dry: GainNode; wet: GainNode; now: number }

function ensureBus(): Bus | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    try {
      const Ctor = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
      ctx = new Ctor();
    } catch { return null; }
    const master = ctx.createGain();
    master.gain.value = 0.85;

    // Light glue-compression so transients (knocks) sit nicely against bells.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 14;
    comp.ratio.value = 3;
    comp.attack.value = 0.003;
    comp.release.value = 0.18;

    // Reverb: stereo decaying-noise impulse → small-room ambience.
    const verb = ctx.createConvolver();
    verb.buffer = synthImpulseResponse(ctx, 0.55, 2.4);

    dryBus = ctx.createGain();
    dryBus.gain.value = 1.0;
    wetBus = ctx.createGain();
    wetBus.gain.value = 0.28;

    dryBus.connect(comp);
    wetBus.connect(verb).connect(comp);
    comp.connect(master).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return { c: ctx, dry: dryBus!, wet: wetBus!, now: ctx.currentTime };
}

function synthImpulseResponse(c: AudioContext, durationSec: number, decay: number): AudioBuffer {
  const len = Math.floor(c.sampleRate * durationSec);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
    }
  }
  return buf;
}

// ---- Building blocks ---------------------------------------------------

function noiseClick(b: Bus, t0: number, opts: { duration?: number; gain?: number; cutoff?: number; highpass?: number; wet?: number }) {
  const { c, dry, wet } = b;
  const duration = opts.duration ?? 0.014;
  const buf = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * duration)), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);
  const src = c.createBufferSource();
  src.buffer = buf;
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = opts.highpass ?? 800;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = opts.cutoff ?? 3500;
  const peak = opts.gain ?? 0.35;
  const g = c.createGain();
  g.gain.setValueAtTime(peak, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  const sendWet = c.createGain();
  sendWet.gain.value = opts.wet ?? 0.45;
  src.connect(hp).connect(lp).connect(g);
  g.connect(dry);
  g.connect(sendWet).connect(wet);
  src.start(t0);
  src.stop(t0 + duration + 0.05);
}

function damped(b: Bus, t0: number, opts: { freq: number; duration: number; gain?: number; freqEnd?: number; type?: OscillatorType; wet?: number; attack?: number }) {
  const { c, dry, wet } = b;
  const peak = opts.gain ?? 0.16;
  const attack = opts.attack ?? 0.004;
  const osc = c.createOscillator();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(opts.freq, t0);
  if (opts.freqEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.freqEnd), t0 + opts.duration);
  }
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.duration);
  const sendWet = c.createGain();
  sendWet.gain.value = opts.wet ?? 0.3;
  osc.connect(g);
  g.connect(dry);
  g.connect(sendWet).connect(wet);
  osc.start(t0);
  osc.stop(t0 + opts.duration + 0.05);
}

function woodKnock(b: Bus, t0: number, opts: { pitch: number; duration?: number; gain?: number; bright?: boolean }) {
  const gain = opts.gain ?? 0.6;
  const duration = opts.duration ?? 0.09;
  const bright = opts.bright ?? false;
  noiseClick(b, t0, {
    duration: 0.014,
    gain: gain * 0.55,
    cutoff: bright ? 5000 : 3000,
    highpass: bright ? 1100 : 800,
    wet: 0.4,
  });
  damped(b, t0, {
    freq: opts.pitch,
    freqEnd: opts.pitch * 0.55,
    duration,
    gain: gain * 0.45,
    type: 'sine',
    wet: 0.25,
  });
  // Subtle higher partial for a touch of crispness.
  damped(b, t0, {
    freq: opts.pitch * 3.2,
    duration: duration * 0.5,
    gain: gain * 0.06,
    type: 'sine',
    wet: 0.4,
  });
}

function bell(b: Bus, t0: number, opts: { freq: number; duration: number; gain?: number }) {
  // Inharmonic partials approximating a small handbell.
  const partials = [1.0, 2.01, 2.99, 4.07, 5.42];
  const amps =    [1.0, 0.55, 0.32, 0.18, 0.10];
  const peak = opts.gain ?? 0.18;
  for (let i = 0; i < partials.length; i++) {
    damped(b, t0, {
      freq: opts.freq * partials[i]!,
      duration: opts.duration * (1 - i * 0.1),
      gain: peak * amps[i]!,
      type: 'sine',
      wet: 0.45 + i * 0.05,
      attack: 0.003,
    });
  }
}

function pluck(b: Bus, t0: number, opts: { freq: number; duration: number; gain?: number }) {
  // Triangle with quick decay — a soft, modern UI "pluck".
  damped(b, t0, {
    freq: opts.freq,
    duration: opts.duration,
    gain: opts.gain ?? 0.14,
    type: 'triangle',
    wet: 0.2,
    attack: 0.005,
  });
  damped(b, t0, {
    freq: opts.freq * 2,
    duration: opts.duration * 0.6,
    gain: (opts.gain ?? 0.14) * 0.35,
    type: 'sine',
    wet: 0.25,
  });
}

// ---- Public API ---------------------------------------------------------

export function setSoundEnabled(on: boolean) { enabled = on; }
export function getSoundEnabled() { return enabled; }

// Some browsers require user interaction before audio plays. Call this once
// from a click/keydown handler to "warm" the context.
export function unlockAudio() {
  const b = ensureBus();
  if (b && b.c.state === 'suspended') void b.c.resume();
}

export function playSound(kind: SoundKind) {
  if (!enabled) return;
  const b = ensureBus();
  if (!b) return;
  const t = b.now + 0.005; // tiny lead-in so the first sample isn't clipped

  switch (kind) {
    case 'move':
      woodKnock(b, t, { pitch: 280, duration: 0.09, gain: 0.55 });
      break;
    case 'capture':
      // Heavier, slightly grittier knock — broader noise + lower body.
      woodKnock(b, t, { pitch: 165, duration: 0.13, gain: 0.7, bright: false });
      noiseClick(b, t + 0.008, { duration: 0.04, gain: 0.18, cutoff: 1200, highpass: 350, wet: 0.5 });
      break;
    case 'check': {
      // Two-tone bell — a small alert without being shrill.
      bell(b, t,         { freq: 1175, duration: 0.55, gain: 0.18 });   // D6
      bell(b, t + 0.09,  { freq: 880,  duration: 0.55, gain: 0.14 });   // A5
      break;
    }
    case 'castle':
      // Two crisp knocks (king + rook).
      woodKnock(b, t,        { pitch: 280, duration: 0.08, gain: 0.5, bright: true });
      woodKnock(b, t + 0.07, { pitch: 240, duration: 0.09, gain: 0.55, bright: true });
      break;
    case 'promotion': {
      // Bright ascending bell arpeggio — C major triad up to the octave.
      bell(b, t,         { freq: 523,  duration: 0.45, gain: 0.16 }); // C5
      bell(b, t + 0.08,  { freq: 659,  duration: 0.45, gain: 0.16 }); // E5
      bell(b, t + 0.16,  { freq: 784,  duration: 0.55, gain: 0.18 }); // G5
      bell(b, t + 0.26,  { freq: 1047, duration: 0.7,  gain: 0.20 }); // C6
      break;
    }
    case 'game_start': {
      // Major-third welcome chord with a small flourish.
      pluck(b, t,        { freq: 392, duration: 0.35, gain: 0.14 }); // G4
      pluck(b, t + 0.05, { freq: 523, duration: 0.45, gain: 0.14 }); // C5
      pluck(b, t + 0.10, { freq: 659, duration: 0.55, gain: 0.14 }); // E5
      break;
    }
    case 'game_end': {
      // Resolving cadence — descend G5 → E5 → C5 → low rumble.
      bell(b, t,        { freq: 784, duration: 0.55, gain: 0.16 });
      bell(b, t + 0.16, { freq: 659, duration: 0.6,  gain: 0.16 });
      bell(b, t + 0.34, { freq: 523, duration: 0.9,  gain: 0.20 });
      damped(b, t + 0.34, { freq: 130, duration: 0.6, gain: 0.10, type: 'sine', wet: 0.45 });
      break;
    }
    case 'click':
      // Short, soft UI tick.
      pluck(b, t, { freq: 880, duration: 0.08, gain: 0.08 });
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
