import { cn } from '../lib/utils';
import { styleFor, GLYPH_SVG } from '../lib/classification';

interface Props {
  classification: string;
  square: string;       // e.g. "e4"
  orientation?: 'white' | 'black';
  size?: 'sm' | 'md';
}

// Floating pictogram badge anchored to the corner of a board square. Position
// is computed in percentage units of the parent so the badge scales with the
// board at any size (chess.com's badge stays 24% of a square wide). Place
// inside a position:relative parent that's exactly the size of the chessboard.
export default function ClassificationBadge({ classification, square, orientation = 'white', size = 'md' }: Props) {
  const style = styleFor(classification);
  if (!style) return null;
  if (square.length < 2) return null;

  const file = square.charCodeAt(0) - 97;        // a=0..h=7
  const rank = parseInt(square[1]!, 10) - 1;     // 1=0..8=7
  if (Number.isNaN(file) || Number.isNaN(rank)) return null;

  const flip = orientation === 'black';
  const colPct = (flip ? 7 - file : file) * 12.5;  // 0..87.5
  const rowPct = (flip ? rank : 7 - rank) * 12.5;  // 0..87.5

  // Badge sits at the top-right corner of the destination square, anchored
  // by its CENTER (so it overhangs the corner by half its width). Badge
  // diameter is 24% of one square = 3% of the whole board (per spec §4.4).
  const badgePctOfBoard = size === 'sm' ? 2.4 : 3.0; // square is 12.5% wide
  const left = `calc(${colPct}% + 12.5% - ${badgePctOfBoard / 2}%)`;
  const top = `calc(${rowPct}% - ${badgePctOfBoard / 2}%)`;

  return (
    <div
      className="pointer-events-none absolute z-10 animate-badge-pop"
      style={{
        left,
        top,
        width: `${badgePctOfBoard}%`,
        // Use aspect-ratio for the height — keeps the badge perfectly round
        // regardless of board pixel size.
        aspectRatio: '1 / 1',
      }}
    >
      <div
        className={cn(
          'flex h-full w-full items-center justify-center rounded-full text-white shadow-lift ring-2 ring-white/90 dark:ring-chesscom-900/90',
          style.bgClass,
        )}
        title={classification}
      >
        <svg viewBox="0 0 24 24" width="70%" height="70%" aria-hidden="true">
          {GLYPH_SVG[style.glyph]}
        </svg>
      </div>
    </div>
  );
}
