import type { ReactNode } from 'react';
import type { GlyphKind } from '../../lib/classification';

// The move marks as fat, rounded shapes, each with a darker copy underneath, like
// the lip on the theme's buttons.
function jelly(shape: ReactNode): ReactNode {
  return (
    <g>
      <g transform="translate(0 1.4)" opacity="0.3" style={{ color: '#000' }}>{shape}</g>
      {shape}
    </g>
  );
}

const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 4.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const solid = { fill: 'currentColor', stroke: 'currentColor', strokeWidth: 2.2, strokeLinejoin: 'round' } as const;

const text = (value: string, size: number) => (
  <text x="12" y="18" textAnchor="middle" fontSize={size} fontWeight="900" fill="currentColor" style={{ fontFamily: 'var(--font-sans)' }}>{value}</text>
);

export const JELLY_MOVE_GLYPHS: Record<GlyphKind, ReactNode> = {
  check: jelly(<path d="M5.5 12.5 L10 17 L18.5 7" {...line} />),
  doubleCheck: jelly(<g {...line} strokeWidth={3.6}><path d="M3 13 L7 17 L13 9" /><path d="M11 16 L12.5 17 L21 7" /></g>),
  star: jelly(<path d="M12 4 L14.4 9.7 L20.5 10.2 L15.8 14.2 L17.3 20 L12 16.9 L6.7 20 L8.2 14.2 L3.5 10.2 L9.6 9.7 Z" {...solid} />),
  dot: jelly(<circle cx="12" cy="11.5" r="4.6" fill="currentColor" />),
  book: jelly(<path d="M5 6 H10 Q12 6 12 8 V18 Q12 16 10 16 H5 Z M19 6 H14 Q12 6 12 8 V18 Q12 16 14 16 H19 Z" {...solid} />),
  questionMark: jelly(text('?', 20)),
  doubleQuestion: jelly(text('??', 18)),
  inaccuracy: jelly(text('?!', 16)),
  cross: jelly(<g {...line}><path d="M6.5 6.5 L17.5 17.5" /><path d="M17.5 6.5 L6.5 17.5" /></g>),
  lightning: jelly(<path d="M13 3.5 L5.5 13.5 H11 L9.5 20.5 L18.5 9.5 H12.5 Z" {...solid} />),
  lock: jelly(<g><path d="M8.5 11 V8.5 a3.5 3.5 0 1 1 7 0 V11" {...line} strokeWidth={2.8} /><rect x="6" y="10.5" width="12" height="9.5" rx="2.5" fill="currentColor" /></g>),
};
