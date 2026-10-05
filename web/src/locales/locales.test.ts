import { describe, expect, it } from 'vitest';
import { createInstance } from 'i18next';
import en from './en.json';
import de from './de.json';
import learnEn from './learn/en.json';
import learnDe from './learn/de.json';
import learnRu from './learn/ru.json';
import ru from './ru.json';
import { loadLearnTexts } from '../learn/content';
import { goalText } from '../lib/goalText';

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    if (typeof v === 'string') out[prefix + k] = v;
    else Object.assign(out, flatten(v, `${prefix}${k}.`));
  }
  return out;
}

const placeholders = (s: string) => (s.match(/{{\s*\w+\s*}}/g) ?? []).sort();

// i18next silently falls back to English for a missing key, so a gap in a
// locale never shows up as an error — only as an English word in the middle
// of a German screen. Pin German to full parity with English.
describe('de locale', () => {
  const enFlat = flatten(en as Tree);
  const deFlat = flatten(de as Tree);

  it('has every key that en has, and nothing else', () => {
    expect(Object.keys(deFlat).sort()).toEqual(Object.keys(enFlat).sort());
  });

  it('keeps every interpolation placeholder', () => {
    for (const key of Object.keys(enFlat)) {
      expect(placeholders(deFlat[key] ?? ''), key).toEqual(placeholders(enFlat[key]!));
    }
  });
});

// Lesson texts have their own namespace; missing keys must not silently put
// English sentences into a translated lesson.
describe.each([['de', learnDe], ['ru', learnRu]] as const)('%s lesson texts', (lang, texts) => {
  const enFlat = flatten(learnEn as Tree);
  const translated = flatten(texts as Tree);

  it('has every key that en has, and nothing else', () => {
    expect(Object.keys(translated).sort()).toEqual(Object.keys(enFlat).sort());
  });

  it('keeps every placeholder and every bold mark', () => {
    for (const key of Object.keys(enFlat)) {
      expect(placeholders(translated[key] ?? ''), key).toEqual(placeholders(enFlat[key]!));
      // **bold** pairs must stay pairs, or the markers would show as text.
      expect((translated[key]!.match(/\*\*/g) ?? []).length % 2, key).toBe(0);
    }
  });

  it('loads the translated namespace used by lessons', async () => {
    await loadLearnTexts(lang);
    const { default: i18n } = await import('../i18n');
    for (const [key, value] of Object.entries(translated)) {
      expect(i18n.getResource(lang, 'learn', key), key).toBe(value);
    }
  });
});

// Russian has four CLDR plural categories (one / few / many / other) where
// English has two, and i18next does not fall back from a missing "_few" to
// "_other" — it falls back to English. So every pluralised English key must
// carry all four Russian forms, and everything else must match one to one.
describe('ru locale', () => {
  const enFlat = flatten(en as Tree);
  const ruFlat = flatten(ru as Tree);
  const PLURAL = /_(one|few|many|other)$/;
  const RU_FORMS = ['one', 'few', 'many', 'other'];

  it('has every key that en has, and nothing else', () => {
    const expected = new Set<string>();
    for (const key of Object.keys(enFlat)) {
      if (PLURAL.test(key)) for (const f of RU_FORMS) expected.add(key.replace(PLURAL, `_${f}`));
      else expected.add(key);
    }
    expect(Object.keys(ruFlat).sort()).toEqual([...expected].sort());
  });

  it('keeps every interpolation placeholder', () => {
    for (const [key, value] of Object.entries(ruFlat)) {
      const enKey = PLURAL.test(key) ? key.replace(PLURAL, '_other') : key;
      expect(placeholders(value), key).toEqual(placeholders(enFlat[enKey]!));
    }
  });

  it('uses Russian plurals for lesson and trainer counts', async () => {
    const i18n = createInstance();
    await i18n.init({ lng: 'ru', fallbackLng: 'en', resources: {
      en: { translation: en }, ru: { translation: ru },
    } });
    for (const [count, form] of [[1, 'one'], [2, 'few'], [5, 'many'], [11, 'many'],
      [21, 'one'], [22, 'few'], [25, 'many'], [1.5, 'other']] as const) {
      for (const key of ['learn.tasks', 'learn.starsGained', 'learn.play.wonMate',
        'openings.trainer.branchCount', 'openings.trainer.practiseBranches']) {
        expect(i18n.t(key, { count }), `${key}: ${count}`).toBe(
          ruFlat[`${key}_${form}`]!.replace('{{count}}', String(count)),
        );
      }
    }
  });
});

describe('goalText', () => {
  const t = ((key: string, opts?: Record<string, unknown>) => {
    const v = flatten(de as Tree)[key];
    if (v === undefined) return opts?.defaultValue as string;
    return v.replace(/{{(\w+)}}/g, (_, n: string) => String(opts?.[n] ?? ''));
  }) as never;

  it('renders a stored goal in the user language from its kind and metadata', () => {
    const goal = {
      kind: 'opening_play',
      title: 'Play 3 games in Sicilian Defense',
      description: '…',
      target: 3,
      metadata: { eco: 'B20', opening_name: 'Sicilian Defense', color: 'black' },
    };
    expect(goalText(t, goal).title).toBe('Spiele 3 Partien mit Sicilian Defense');
    expect(goalText(t, goal).description).toContain('als Schwarz');
  });

  it('falls back to the stored text for an unknown kind', () => {
    const goal = { kind: 'something_new', title: 'Stored title', description: 'Stored description', target: 1, metadata: null };
    expect(goalText(t, goal)).toEqual({ title: 'Stored title', description: 'Stored description' });
  });
});
