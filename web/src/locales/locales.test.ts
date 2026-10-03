import { describe, expect, it } from 'vitest';
import en from './en.json';
import de from './de.json';
import learnEn from './learn/en.json';
import learnDe from './learn/de.json';
import ru from './ru.json';
import fa from './fa.json';
import learnFa from './learn/fa.json';
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

// The lesson texts are their own namespace; same rule. A missing German key
// would put an English sentence into a German lesson.
describe('de lesson texts', () => {
  const enFlat = flatten(learnEn as Tree);
  const deFlat = flatten(learnDe as Tree);

  it('has every key that en has, and nothing else', () => {
    expect(Object.keys(deFlat).sort()).toEqual(Object.keys(enFlat).sort());
  });

  it('keeps every placeholder and every bold mark', () => {
    for (const key of Object.keys(enFlat)) {
      expect(placeholders(deFlat[key] ?? ''), key).toEqual(placeholders(enFlat[key]!));
      // **bold** pairs must stay pairs, or the markers would show as text.
      expect((deFlat[key]!.match(/\*\*/g) ?? []).length % 2, key).toBe(0);
    }
  });
});

// Farsi ships complete: every UI string and every lesson. Its CLDR plural
// categories are one / other, the same as English, so the keys match one to
// one.
describe('fa locale', () => {
  const enFlat = flatten(en as Tree);
  const faFlat = flatten(fa as Tree);

  it('has every key that en has, and nothing else', () => {
    expect(Object.keys(faFlat).sort()).toEqual(Object.keys(enFlat).sort());
  });

  it('keeps every interpolation placeholder and markup tag', () => {
    for (const key of Object.keys(enFlat)) {
      expect(placeholders(faFlat[key] ?? ''), key).toEqual(placeholders(enFlat[key]!));
      const tags = (s: string) => (s.match(/<\/?\w+>/g) ?? []).sort();
      expect(tags(faFlat[key] ?? ''), key).toEqual(tags(enFlat[key]!));
    }
  });

  it('has lesson texts for every lesson, with placeholders and bold marks intact', () => {
    const enLearn = flatten(learnEn as Tree);
    const faLearn = flatten(learnFa as Tree);
    expect(Object.keys(faLearn).sort()).toEqual(Object.keys(enLearn).sort());
    for (const key of Object.keys(enLearn)) {
      expect(placeholders(faLearn[key]!), key).toEqual(placeholders(enLearn[key]!));
      expect((faLearn[key]!.match(/\*\*/g) ?? []).length % 2, key).toBe(0);
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
  // Keys that landed in the same release as Russian (7.16.0), before they
  // could be translated. The trainer and Learn texts are still in beta and
  // moving, so they wait until they settle; until then these fall back to
  // English. Every other key — including any added later — must be in ru.json.
  const PENDING = [
    'openings.trainer.', 'openings.emptyTrainer', 'learn.', 'home.learn', 'shortcuts.goLearn',
    'insights.ach.learning', 'common.beta',
    'achievements.first_lesson.', 'achievements.eager_student.', 'achievements.star_collector.',
    'admin.deepseek', 'admin.engineBackendNote', 'setup.llmHint', 'review.importError.import_in_progress',
    'insights.moveQuality', 'insights.brilliantMoves', 'insights.noBrilliant', 'insights.vsOpponent',
    'train.tabs.', 'train.puzzles.',
  ];

  it('has every key that en has, and nothing else', () => {
    const expected = new Set<string>();
    for (const key of Object.keys(enFlat)) {
      if (PENDING.some((p) => key.startsWith(p)) && !(key in ruFlat)) continue;
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
