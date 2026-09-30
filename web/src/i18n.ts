import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import bg from './locales/bg.json';
import es from './locales/es.json';
import de from './locales/de.json';
import ru from './locales/ru.json';
import fa from './locales/fa.json';
import { LANGUAGE_CODES, isRtl, normalizeLanguage } from './lib/languages';

// <html lang> for fonts, hyphenation and screen readers; dir="rtl" flips the
// layout for Farsi. The board and chess notation opt back into ltr where
// they are rendered.
function applyDocumentLanguage(lng: string | undefined) {
  if (typeof document === 'undefined') return;
  const lang = normalizeLanguage(lng);
  document.documentElement.lang = lang;
  document.documentElement.dir = isRtl(lang) ? 'rtl' : 'ltr';
}

i18n.on('languageChanged', applyDocumentLanguage);

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en }, bg: { translation: bg }, es: { translation: es },
      de: { translation: de }, ru: { translation: ru }, fa: { translation: fa },
    },
    fallbackLng: 'en',
    supportedLngs: [...LANGUAGE_CODES],
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'lang',
    },
  });

export default i18n;
