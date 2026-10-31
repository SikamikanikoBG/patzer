import type { PiecePalette, PieceSprites, PieceType, Theme, ThemeColors, ThemeShape } from './types';

/** The sprite as SVG: one crisp rectangle per run of same-coloured pixels in a row. */
export function spriteSvg(sprite: readonly string[], palette: PiecePalette): string {
  const rects: string[] = [];
  sprite.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const pixel = row[x]!;
      let end = x + 1;
      while (row[end] === pixel) end++;
      const colour = palette[pixel];
      if (colour) rects.push(`<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${colour}"/>`);
      x = end;
    }
  });
  const width = sprite[0]?.length ?? 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${sprite.length}" shape-rendering="crispEdges">${rects.join('')}</svg>`;
}

const PIECE_NAMES: Record<PieceType, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

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

function pieceRules(selector: string, sprites: PieceSprites, palette: { white: PiecePalette; black: PiecePalette }): string[] {
  const rules: string[] = [];
  for (const type of Object.keys(PIECE_NAMES) as PieceType[]) {
    for (const side of ['white', 'black'] as const) {
      const uri = encodeURIComponent(spriteSvg(sprites[type], palette[side]));
      rules.push(`${selector} .cg-wrap piece.${PIECE_NAMES[type]}.${side}{background-image:url("data:image/svg+xml,${uri}")}`);
    }
  }
  return rules;
}

/** The stylesheet that makes a theme active: its tokens and its piece images. */
export function themeCss(theme: Theme): string {
  const root = `:root[data-theme="${theme.id}"]`;
  const light = `${root}:not(.dark)`;
  const dark = `${root}.dark`;
  const rules = [
    block(root, shapeVars(theme.shape)),
    block(light, { ...colorVars(theme.colors.light), ...theme.vars?.light }),
    block(dark, { ...colorVars(theme.colors.dark), ...theme.vars?.dark }),
  ];
  if (theme.pieces?.kind === 'sprites') {
    rules.push(...pieceRules(light, theme.pieces.sprites, theme.pieces.palette.light));
    rules.push(...pieceRules(dark, theme.pieces.sprites, theme.pieces.palette.dark));
  }
  return rules.join('\n');
}

/** CSS's `color-mix(in srgb, a pct%, b)` for hex colours. Themes use it to derive shades. */
export function mix(a: string, pct: number, b: string): string {
  const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const ca = channels(a);
  const cb = channels(b);
  return `#${ca.map((v, i) => Math.round((v * pct + cb[i]! * (100 - pct)) / 100).toString(16).padStart(2, '0')).join('')}`;
}
