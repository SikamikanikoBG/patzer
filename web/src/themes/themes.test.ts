// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error A plain JS config, outside this project's types.
import tailwindConfig from '../../tailwind.config.js';
import { applyStoredTheme, applyTheme, DEFAULT_THEME, findTheme, THEMES } from './index';
import { mix, spriteSvg, themeCss } from './css';
import { ARROW_BRUSHES } from './arrows';
import { GLYPH_SVG } from '../lib/classification';
import { GLYPH_BITMAPS } from './pixel/moveGlyphs';
import type { ThemeColors } from './types';

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

afterEach(() => {
  applyTheme(DEFAULT_THEME.id);
  localStorage.clear();
});

describe.each(THEMES.map((t) => [t.id, t] as const))('theme %s', (id, theme) => {
  it('has an id the server accepts', () => {
    expect(id).toMatch(/^[a-z0-9-]{1,32}$/);
    expect(THEMES.filter((t) => t.id === id)).toHaveLength(1);
  });

  it('defines every variable tailwind.config.js reads', () => {
    const used = new Set(JSON.stringify(tailwindConfig.theme).match(/--[a-z0-9-]+/g));
    expect(used.size).toBeGreaterThan(40);
    const css = themeCss(theme);
    for (const name of used) expect(css, name).toContain(`${name}:`);
  });

  it('draws every move mark, if it draws any', () => {
    if (!theme.moveGlyphs) return;
    expect(Object.keys(theme.moveGlyphs).sort()).toEqual(Object.keys(GLYPH_SVG).sort());
  });

  it('defines every colour the arrows use', () => {
    const css = themeCss(theme);
    for (const brush of Object.values(ARROW_BRUSHES)) {
      const variable = /--[a-z-]+/.exec(brush.color)![0];
      expect(css).toContain(`${variable}:`);
    }
  });

  it('draws arrows that show on its own board', () => {
    if (!theme.ownsBoard) return;
    const { boardLight, boardDark } = theme.preview;
    for (const [name, colour] of Object.entries(theme.colors.dark.arrows)) {
      expect.soft(contrast(colour, boardLight), `${name} on light squares`).toBeGreaterThanOrEqual(1.4);
      expect.soft(contrast(colour, boardDark), `${name} on dark squares`).toBeGreaterThanOrEqual(1.4);
    }
  });

  it.each(['light', 'dark'] as const)('has readable text in %s', (scheme) => {
    const c: ThemeColors = theme.colors[scheme];
    expect(contrast(c.pageFg, c.pageBg)).toBeGreaterThanOrEqual(4.5);
  });

  it('names only assets that exist, and colours are hex', () => {
    const css = themeCss(theme);
    expect(css).not.toContain('undefined');
    expect(css).not.toContain('NaN');
  });

  it('only scopes its stylesheet to itself', () => {
    for (const rule of themeCss(theme).split('\n')) {
      expect(rule.startsWith(`:root[data-theme="${id}"]`)).toBe(true);
    }
  });

  it('draws every piece on both sides when it has its own pieces', () => {
    if (!theme.pieces) return;
    const css = themeCss(theme);
    for (const piece of ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king']) {
      for (const side of ['white', 'black']) {
        expect(css, `${piece} ${side}`).toContain(`piece.${piece}.${side}{`);
      }
    }
    if (theme.pieces.kind !== 'sprites') return;
    for (const { white, black } of [theme.pieces.palette.light, theme.pieces.palette.dark]) {
      expect(contrast(white.b!, black.b!), 'white and black bodies').toBeGreaterThanOrEqual(3);
    }
    for (const sprite of Object.values(theme.pieces.sprites)) {
      expect(sprite).toHaveLength(sprite[0]!.length);
      for (const row of sprite) expect(row).toHaveLength(sprite[0]!.length);
    }
  });
});

describe('Pixel move marks', () => {
  it.each(Object.entries(GLYPH_BITMAPS))('%s is a 12×12 bitmap', (_kind, rows) => {
    expect(rows).toHaveLength(12);
    for (const row of rows) expect(row).toMatch(/^[#.]{12}$/);
  });
});

describe('applyTheme', () => {
  it('marks <html>, writes the tokens and remembers the choice', () => {
    applyTheme('pixel');
    expect(document.documentElement.dataset.theme).toBe('pixel');
    expect(document.getElementById('patzer-theme')?.textContent).toContain('data-theme="pixel"');
    expect(localStorage.getItem('patzer.ui_theme')).toBe('pixel');
  });

  it('falls back to the default for a theme this build does not have', () => {
    applyTheme('removed-theme');
    expect(document.documentElement.dataset.theme).toBe(DEFAULT_THEME.id);
    expect(findTheme(null)).toBe(DEFAULT_THEME);
  });

  it('starts from the remembered theme', () => {
    localStorage.setItem('patzer.ui_theme', 'pixel');
    applyStoredTheme();
    expect(document.documentElement.dataset.theme).toBe('pixel');
  });
});

describe('helpers', () => {
  it('mix matches color-mix in srgb', () => {
    expect(mix('#000000', 50, '#ffffff')).toBe('#808080');
    expect(mix('#6ce8ed', 100, '#000000')).toBe('#6ce8ed');
  });

  it('spriteSvg merges runs and leaves unmapped pixels transparent', () => {
    expect(spriteSvg(['.oo', 'b.b'], { o: '#111111', b: '#222222' })).toContain(
      '<rect x="1" y="0" width="2" height="1" fill="#111111"/>',
    );
    expect(spriteSvg(['.'], {})).not.toContain('<rect');
  });
});
