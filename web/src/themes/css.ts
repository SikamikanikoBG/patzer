import type { Theme, ThemeColors, ThemeShape } from './types';

function colorVars(c: ThemeColors): Record<string, string> {
  const vars: Record<string, string> = { '--page-bg': c.pageBg, '--page-fg': c.pageFg, '--panel': c.panel, '--hero': c.hero };
  for (const [step, value] of Object.entries(c.neutral)) vars[`--neutral-${step}`] = value;
  for (const [step, value] of Object.entries(c.brand)) vars[`--brand-${step}`] = value;
  for (const [step, value] of Object.entries(c.focus)) vars[`--focus-${step}`] = value;
  return vars;
}

function shapeVars(s: ThemeShape): Record<string, string> {
  const vars: Record<string, string> = {
    '--font-sans': s.fontSans,
    '--font-mono': s.fontMono,
    '--radius-scale': String(s.radiusScale),
    '--body-size': s.bodySize,
    '--body-leading': s.bodyLeading,
    '--shadow-soft': s.shadowSoft,
    '--shadow-lift': s.shadowLift,
    '--shadow-board': s.shadowBoard,
    '--shadow-glow': s.shadowGlow,
  };
  for (const [name, [size, leading]] of Object.entries(s.text)) {
    vars[`--text-${name}`] = size;
    vars[`--leading-${name}`] = leading;
  }
  return vars;
}

const block = (selector: string, vars: Record<string, string>) =>
  `${selector}{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';')}}`;

/** The stylesheet that makes a theme active: its tokens. */
export function themeCss(theme: Theme): string {
  const root = `:root[data-theme="${theme.id}"]`;
  const light = `${root}:not(.dark)`;
  const dark = `${root}.dark`;
  const rules = [
    block(root, shapeVars(theme.shape)),
    block(light, { ...colorVars(theme.colors.light), ...theme.vars?.light }),
    block(dark, { ...colorVars(theme.colors.dark), ...theme.vars?.dark }),
  ];
  return rules.join('\n');
}
