import type { Classification } from '../types';
import { cn } from '../lib/utils';

const CLASS_BG: Record<Classification, string> = {
  brilliant: 'bg-move-brilliant text-white ring-2 ring-white/40',
  best: 'bg-move-best text-white ring-2 ring-white/40',
  excellent: 'bg-move-excellent text-white ring-2 ring-white/40',
  good: 'bg-move-good text-ink-900 ring-2 ring-white/40',
  book: 'bg-move-book text-white ring-2 ring-white/40',
  inaccuracy: 'bg-move-inaccuracy text-white ring-2 ring-white/40',
  mistake: 'bg-move-mistake text-white ring-2 ring-white/40',
  blunder: 'bg-move-blunder text-white ring-2 ring-white/40',
  miss: 'bg-move-miss text-white ring-2 ring-white/40',
};

const CLASS_GLYPH: Record<Classification, string> = {
  brilliant: '!!', best: '★', excellent: '✓', good: '·', book: '📖',
  inaccuracy: '?!', mistake: '?', blunder: '??', miss: '✗',
};

interface Props {
  classification: Classification;
  square: string;       // e.g. "e4"
  orientation?: 'white' | 'black';
  size?: 'sm' | 'md';
}

// Renders a small badge anchored to a board square. Must be placed inside a
// position:relative parent that's the same size as the chessboard.
export default function ClassificationBadge({ classification, square, orientation = 'white', size = 'md' }: Props) {
  if (square.length < 2) return null;
  const file = square.charCodeAt(0) - 97;            // a=0..h=7
  const rank = parseInt(square[1]!, 10) - 1;          // 1=0..8=7
  if (Number.isNaN(file) || Number.isNaN(rank)) return null;

  const flip = orientation === 'black';
  const colPct = (flip ? 7 - file : file) * 12.5;
  const rowPct = (flip ? rank : 7 - rank) * 12.5;

  const sizeCls = size === 'sm' ? 'h-5 w-5 text-[10px]' : 'h-7 w-7 text-xs';

  return (
    <div className="pointer-events-none absolute z-10"
      style={{ left: `calc(${colPct}% + 12.5% - ${size === 'sm' ? 10 : 14}px)`, top: `calc(${rowPct}% - ${size === 'sm' ? 6 : 10}px)` }}>
      <div className={cn('flex items-center justify-center rounded-full font-bold shadow-lg', sizeCls, CLASS_BG[classification])}
        title={classification}>
        {CLASS_GLYPH[classification]}
      </div>
    </div>
  );
}
