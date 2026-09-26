import { describe, expect, it } from 'vitest';
import en from './en.json';
import de from './de.json';
import learnEn from './learn/en.json';
import learnDe from './learn/de.json';
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
