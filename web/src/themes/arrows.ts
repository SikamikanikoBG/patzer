import type { DrawBrushes } from 'chessground/draw';

// The board's arrow brushes, with the same names, widths and opacities as
// chessground's own, but coloured by the active theme. Variables rather than hex,
// so a board already on screen follows a theme change without remounting.
// chessground merges these over its defaults, so its other brushes stay.
export const ARROW_BRUSHES: DrawBrushes = {
  green: { key: 'g', color: 'var(--arrow-green)', opacity: 1, lineWidth: 10 },
  red: { key: 'r', color: 'var(--arrow-red)', opacity: 1, lineWidth: 10 },
  blue: { key: 'b', color: 'var(--arrow-blue)', opacity: 1, lineWidth: 10 },
  yellow: { key: 'y', color: 'var(--arrow-yellow)', opacity: 1, lineWidth: 10 },
  paleGreen: { key: 'pg', color: 'var(--arrow-green)', opacity: 0.4, lineWidth: 15 },
  paleRed: { key: 'pr', color: 'var(--arrow-red)', opacity: 0.4, lineWidth: 15 },
  paleBlue: { key: 'pb', color: 'var(--arrow-blue)', opacity: 0.4, lineWidth: 15 },
};
