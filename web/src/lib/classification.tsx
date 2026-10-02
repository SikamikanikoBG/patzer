// Single source of truth for per-classification UI styling. EvalGraph,
// MoveList, ClassificationBadge, and ClassificationStats all consume this so
// the colour, glyph, and label stay in sync across the review screen.

import type { ReactNode } from 'react';
import type { Classification } from '../types';

export interface ClassificationStyle {
  bgClass: string;     // Tailwind bg color for solid badge
  textClass: string;   // Tailwind text color when bg is muted
  hex: string;         // Hex value (must match Tailwind value above)
  glyph: GlyphKind;    // SVG pictogram (24x24, currentColor)
  labelKey: Classification | 'checkmate';
  order: number;       // Display order in stat panels (chess.com order)
}

export type GlyphKind =
  | 'check' | 'doubleCheck' | 'star' | 'dot' | 'book'
  | 'questionMark' | 'doubleQuestion' | 'inaccuracy' | 'cross'
  | 'lightning' | 'lock' | 'mate';

export const CLASS_STYLE: Record<Classification, ClassificationStyle> = {
  brilliant:  { bgClass: 'bg-move-brilliant',  textClass: 'text-move-brilliant',  hex: '#1baca6', glyph: 'lightning',      labelKey: 'brilliant',  order: 0 },
  great:      { bgClass: 'bg-move-great',      textClass: 'text-move-great',      hex: '#5b8baf', glyph: 'doubleCheck',    labelKey: 'great',      order: 1 },
  best:       { bgClass: 'bg-move-best',       textClass: 'text-move-best',       hex: '#81b64c', glyph: 'check',          labelKey: 'best',       order: 2 },
  excellent:  { bgClass: 'bg-move-excellent',  textClass: 'text-move-excellent',  hex: '#95b776', glyph: 'check',          labelKey: 'excellent',  order: 3 },
  good:       { bgClass: 'bg-move-good',       textClass: 'text-move-good',       hex: '#95a370', glyph: 'dot',            labelKey: 'good',       order: 4 },
  book:       { bgClass: 'bg-move-book',       textClass: 'text-move-book',       hex: '#a88865', glyph: 'book',           labelKey: 'book',       order: 5 },
  inaccuracy: { bgClass: 'bg-move-inaccuracy', textClass: 'text-move-inaccuracy', hex: '#f7c045', glyph: 'inaccuracy',     labelKey: 'inaccuracy', order: 6 },
  mistake:    { bgClass: 'bg-move-mistake',    textClass: 'text-move-mistake',    hex: '#ffa459', glyph: 'questionMark',   labelKey: 'mistake',    order: 7 },
  blunder:    { bgClass: 'bg-move-blunder',    textClass: 'text-move-blunder',    hex: '#fa412d', glyph: 'doubleQuestion', labelKey: 'blunder',    order: 8 },
  miss:       { bgClass: 'bg-move-miss',       textClass: 'text-move-miss',       hex: '#ee6b55', glyph: 'cross',          labelKey: 'miss',       order: 9 },
  forced:     { bgClass: 'bg-move-forced',     textClass: 'text-move-forced',     hex: '#6b6964', glyph: 'lock',           labelKey: 'forced',     order: 10 },
};

export const GLYPH_SVG: Record<GlyphKind, ReactNode> = {
  check:          <path d="M5 12.5 L10 17 L19 7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />,
  doubleCheck:    <g fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 13 L7 17 L13 9"/><path d="M11 13 L15 17 L21 7"/></g>,
  star:           <path d="M12 3 L14.6 9.5 L21.5 10 L16.2 14.4 L17.8 21 L12 17.4 L6.2 21 L7.8 14.4 L2.5 10 L9.4 9.5 Z" fill="currentColor"/>,
  dot:            <circle cx="12" cy="12" r="3.5" fill="currentColor" />,
  book:           <path d="M5 5 H10 Q12 5 12 7 V19 Q12 17 10 17 H5 Z M19 5 H14 Q12 5 12 7 V19 Q12 17 14 17 H19 Z" fill="currentColor" />,
  questionMark:   <text x="12" y="18" textAnchor="middle" fontSize="18" fontWeight="900" fill="currentColor" fontFamily="Inter,system-ui,sans-serif">?</text>,
  doubleQuestion: <text x="12" y="18" textAnchor="middle" fontSize="16" fontWeight="900" fill="currentColor" fontFamily="Inter,system-ui,sans-serif">??</text>,
  inaccuracy:     <text x="12" y="18" textAnchor="middle" fontSize="14" fontWeight="900" fill="currentColor" fontFamily="Inter,system-ui,sans-serif">?!</text>,
  cross:          <g fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M6 6 L18 18"/><path d="M18 6 L6 18"/></g>,
  lightning:      <path d="M13 2 L4 14 H11 L9 22 L20 9 H12 Z" fill="currentColor" />,
  mate:           <text x="12" y="18.5" textAnchor="middle" fontSize="18" fontWeight="900" fill="currentColor" fontFamily="Inter,system-ui,sans-serif">#</text>,
  lock:           <path d="M8 11 V8 a4 4 0 1 1 8 0 V11 H17 a1 1 0 0 1 1 1 v8 a1 1 0 0 1-1 1 H7 a1 1 0 0 1-1-1 v-8 a1 1 0 0 1 1-1 Z M10 11 H14 V8 a2 2 0 1 0-4 0 Z" fill="currentColor"/>,
};

export function styleFor(c: string | undefined | null): ClassificationStyle | null {
  if (!c) return null;
  return (CLASS_STYLE as Record<string, ClassificationStyle>)[c] ?? null;
}

// The move that delivers mate shows "#" instead of its classification glyph.
// It is display-only: the move keeps its classification in the counts.
export const MATE_STYLE: ClassificationStyle = {
  bgClass: 'bg-[#7c5cbf]', textClass: 'text-[#7c5cbf]', hex: '#7c5cbf', glyph: 'mate', labelKey: 'checkmate', order: -1,
};

export function displayStyleFor(c: string | undefined | null, san: string | undefined | null): ClassificationStyle | null {
  if (san?.endsWith('#')) return MATE_STYLE;
  return styleFor(c);
}
