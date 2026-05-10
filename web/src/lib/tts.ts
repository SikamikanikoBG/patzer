// Wrapper around the browser Web Speech API. On Edge/Chrome/Windows this uses
// installed Windows SAPI voices; on macOS uses system voices; on Android Chrome
// uses Android voices. Always sets utterance.lang explicitly so the OS picks an
// appropriate voice when our preferred one isn't available.

import { stripMarkdown, stripReasoning } from './markdown';

const LANG_BCP47: Record<'en' | 'bg', string> = {
  en: 'en-US',
  bg: 'bg-BG',
};

export function getVoices(): SpeechSynthesisVoice[] {
  if (typeof speechSynthesis === 'undefined') return [];
  return speechSynthesis.getVoices();
}

export function onVoicesReady(cb: () => void): () => void {
  if (typeof speechSynthesis === 'undefined') return () => {};
  if (speechSynthesis.getVoices().length > 0) { cb(); return () => {}; }
  const handler = () => cb();
  speechSynthesis.addEventListener('voiceschanged', handler);
  return () => speechSynthesis.removeEventListener('voiceschanged', handler);
}

export function voicesForLang(lang: 'en' | 'bg'): SpeechSynthesisVoice[] {
  const prefix = lang === 'bg' ? 'bg' : 'en';
  return getVoices().filter((v) => v.lang.toLowerCase().startsWith(prefix));
}

export interface SpeakOpts { voice?: string | null; rate?: number; pitch?: number; lang?: 'en' | 'bg' }

function pickVoice(opts: SpeakOpts): SpeechSynthesisVoice | undefined {
  const voices = getVoices();
  if (opts.voice) {
    const explicit = voices.find((v) => v.voiceURI === opts.voice || v.name === opts.voice);
    if (explicit) return explicit;
    // Stored voice no longer exists (different machine, removed pack); fall through
  }
  if (opts.lang) {
    const langVoices = voicesForLang(opts.lang);
    if (langVoices.length === 0) return undefined;
    // Prefer non-network voices (faster, more reliable on Windows)
    const local = langVoices.find((v) => v.localService);
    return local ?? langVoices[0];
  }
  return undefined;
}

export function speak(text: string, opts: SpeakOpts = {}): SpeechSynthesisUtterance | null {
  if (typeof speechSynthesis === 'undefined') return null;
  const clean = stripMarkdown(stripReasoning(text));
  if (!clean) return null;

  // Voices may not be ready yet on Windows; wait briefly then retry.
  if (getVoices().length === 0) {
    const off = onVoicesReady(() => { off(); speak(text, opts); });
    return null;
  }

  speechSynthesis.cancel();

  const u = new SpeechSynthesisUtterance(clean);
  u.rate = opts.rate ?? 1;
  u.pitch = opts.pitch ?? 1;

  // ALWAYS set lang to a BCP-47 code so the OS can pick an appropriate voice
  // when our preferred one is absent. Without this, Chrome on Windows defaults
  // to en-US and reads Cyrillic text as gibberish.
  if (opts.lang) u.lang = LANG_BCP47[opts.lang];

  const voice = pickVoice(opts);
  if (voice) {
    u.voice = voice;
    u.lang = voice.lang; // make sure lang matches the picked voice
  }

  // Surface failures in the console so we can debug if TTS goes silent.
  u.onerror = (ev) => console.warn('[tts] error', ev.error, { text: clean.slice(0, 60), lang: u.lang, voice: u.voice?.name });

  // Chrome bug: cancel() then immediate speak() can be ignored. Defer one tick.
  setTimeout(() => speechSynthesis.speak(u), 0);
  return u;
}

export function cancel() {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}
