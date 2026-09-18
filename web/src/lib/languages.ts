// Single source of truth for the UI languages. Adding a language = one entry
// here + a locale JSON + the server-side zod enums (grep for `'es'` in
// server/src/routes). Everything else (toggles, TTS, signup default) iterates
// this list.
export type Language = 'en' | 'bg' | 'es';

export interface LanguageInfo {
  code: Language;
  /** Short badge used in the EN / BG / ES toggles. */
  short: string;
  /** i18n key for the full name shown in selects. */
  nameKey: string;
  /** Native name, used where the label must be readable in the *target* language. */
  native: string;
  /** BCP-47 tag handed to the Web Speech API. */
  bcp47: string;
}

export const LANGUAGES: readonly LanguageInfo[] = [
  { code: 'en', short: 'EN', nameKey: 'common.english', native: 'English', bcp47: 'en-US' },
  { code: 'bg', short: 'BG', nameKey: 'common.bulgarian', native: 'Български', bcp47: 'bg-BG' },
  { code: 'es', short: 'ES', nameKey: 'common.spanish', native: 'Español', bcp47: 'es-ES' },
] as const;

export const LANGUAGE_CODES: readonly Language[] = LANGUAGES.map((l) => l.code);

export function isLanguage(v: unknown): v is Language {
  return typeof v === 'string' && (LANGUAGE_CODES as readonly string[]).includes(v);
}

/** Map whatever i18next detected ("es-MX", "bg", "en-GB"…) onto a supported code. */
export function normalizeLanguage(detected: string | undefined | null): Language {
  const base = (detected ?? '').toLowerCase().split('-')[0];
  return isLanguage(base) ? base : 'en';
}

export function bcp47For(lang: Language): string {
  return LANGUAGES.find((l) => l.code === lang)?.bcp47 ?? 'en-US';
}
