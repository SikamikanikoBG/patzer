// Badges for the Learn section: a piece in the board's own piece set, or a
// small symbol, on the colour of the level (chess.com colours each level).

import { createElement } from 'react';
import {
  Castle, ChevronsUp, Crown, Footprints, GitFork, Grid3x3, Hourglass, Layers, Magnet, Pin, Scale, Shield,
  ShieldAlert, Sparkles, Swords, Target, TriangleAlert, Unlink, Zap, Flag, Eye, Link2, Anchor, Rocket, NotebookPen,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type { LevelId } from '../../learn/types';

const PIECE_NAMES: Record<string, string> = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };

/** One chess piece, drawn with the same images as the board. */
export function PieceIcon({ piece, color = 'white', className }: { piece: string; color?: 'white' | 'black'; className?: string }) {
  const name = PIECE_NAMES[piece.toLowerCase()] ?? 'pawn';
  return (
    <span className={cn('cg-wrap learn-piece inline-block shrink-0', className)} aria-hidden>
      {createElement('piece', { className: `${color} ${name}` })}
    </span>
  );
}

const SYMBOLS: Record<string, React.ComponentType<{ className?: string }>> = {
  board: Grid3x3, capture: Swords, check: ShieldAlert, escape: Shield, mate: Crown, castle: Castle,
  enpassant: Footprints, promote: ChevronsUp, draw: Scale, values: Scale, center: Target, develop: Rocket,
  trap: TriangleAlert, fork: GitFork, pin: Pin, skewer: Link2, hanging: Anchor, discovered: Eye, double: Zap,
  deflection: Unlink, attraction: Magnet, defender: Shield, intermezzo: Hourglass, trapped: Target,
  quiet: Sparkles, zugzwang: Hourglass, clearance: Layers, interference: Unlink, xray: Eye, flag: Flag,
  notation: NotebookPen,
};

/** A lesson/course icon is a piece letter or one of the symbols above. */
export function isKnownIcon(icon: string): boolean {
  return icon in SYMBOLS || /^[KQRBNP]$/.test(icon);
}

export const LEVEL_COLORS: Record<LevelId, { solid: string; soft: string; text: string }> = {
  basics: { solid: '#81b64c', soft: 'rgba(129,182,76,0.16)', text: '#5d8a3a' },
  beginner: { solid: '#5b8baf', soft: 'rgba(91,139,175,0.16)', text: '#46708f' },
  intermediate: { solid: '#e6a700', soft: 'rgba(230,167,0,0.16)', text: '#a8780a' },
  advanced: { solid: '#b3548c', soft: 'rgba(179,84,140,0.16)', text: '#8f3f6e' },
};

const SIZES = { sm: 'h-8 w-8', md: 'h-11 w-11', lg: 'h-14 w-14' };
const INNER = { sm: 'h-6 w-6', md: 'h-8 w-8', lg: 'h-11 w-11' };
const GLYPH = { sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-7 w-7' };

export default function LessonIcon({ icon, level, size = 'md', done = false, className }: {
  icon: string;
  level: LevelId;
  size?: keyof typeof SIZES;
  done?: boolean;
  className?: string;
}) {
  const color = LEVEL_COLORS[level];
  const Symbol = SYMBOLS[icon];
  return (
    <span
      className={cn('relative inline-flex shrink-0 items-center justify-center rounded-xl', SIZES[size], className)}
      style={{ backgroundColor: done ? color.solid : color.soft, color: done ? '#fff' : color.text }}
    >
      {Symbol
        ? <Symbol className={GLYPH[size]} />
        : <PieceIcon piece={icon} color={done ? 'white' : 'black'} className={INNER[size]} />}
    </span>
  );
}
