// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error A plain JS config, outside this project's types.
import tailwindConfig from '../../tailwind.config.js';
import { applyStoredTheme, applyTheme, DEFAULT_THEME, findTheme, THEMES } from './index';
import { themeCss } from './css';
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

  it.each(['light', 'dark'] as const)('has readable text in %s', (scheme) => {
    const c: ThemeColors = theme.colors[scheme];
    expect(contrast(c.pageFg, c.pageBg)).toBeGreaterThanOrEqual(4.5);
  });

  it('names only assets that exist', () => {
    expect(themeCss(theme)).not.toContain('undefined');
  });

  it('only scopes its stylesheet to itself', () => {
    for (const rule of themeCss(theme).split('\n')) {
      expect(rule.startsWith(`:root[data-theme="${id}"]`)).toBe(true);
    }
  });

});

describe('applyTheme', () => {
  it('marks <html>, writes the tokens and remembers the choice', () => {
    applyTheme('classic');
    expect(document.documentElement.dataset.theme).toBe('classic');
    expect(document.getElementById('patzer-theme')?.textContent).toContain('data-theme="classic"');
    expect(localStorage.getItem('patzer.ui_theme')).toBe('classic');
  });

  it('falls back to the default for a theme this build does not have', () => {
    applyTheme('removed-theme');
    expect(document.documentElement.dataset.theme).toBe(DEFAULT_THEME.id);
    expect(findTheme(null)).toBe(DEFAULT_THEME);
  });

  it('starts from the remembered theme', () => {
    localStorage.setItem('patzer.ui_theme', 'classic');
    applyStoredTheme();
    expect(document.documentElement.dataset.theme).toBe('classic');
  });
});
