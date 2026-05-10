import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';
import { styleFor, GLYPH_SVG } from '../lib/classification';

interface Move { ply: number; san: string; classification?: string }

interface Props {
  num: number;
  white?: Move;
  black?: Move;
  current: number;
  onSelect: (ply: number) => void;
}

// Single move-pair row. Tints the row's left edge by the worst classification
// of the two half-moves so a glance down the list reveals where the game
// tilted (matches chess.com Game Review). No alternate-row striping —
// chess.com uses only 1px hairlines between move pairs.
export default function MoveRow({ num, white, black, current, onSelect }: Props) {
  const { t } = useTranslation();
  const wCur = white?.ply === current;
  const bCur = black?.ply === current;
  const ref = useRef<HTMLDivElement | null>(null);

  // Auto-scroll the current row into view when the user steps with arrow keys.
  useEffect(() => {
    if (wCur || bCur) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [wCur, bCur]);

  const tint = pickTint(white?.classification, black?.classification);

  return (
    <div
      ref={ref}
      className={cn(
        'grid grid-cols-[2.25rem_1fr_1fr] items-stretch border-b border-chesscom-100 dark:border-chesscom-800',
        tint,
      )}
    >
      <div className="flex items-center justify-end pr-2 text-[11px] tabular-nums text-chesscom-400">{num}.</div>
      <Half move={white} current={wCur} onSelect={onSelect} t={t} />
      <Half move={black} current={bCur} onSelect={onSelect} t={t} />
    </div>
  );
}

function Half({
  move, current, onSelect, t,
}: { move?: Move; current: boolean; onSelect: (p: number) => void; t: (k: string) => string }) {
  if (!move) return <div />;
  const style = styleFor(move.classification);
  return (
    <button
      onClick={() => onSelect(move.ply)}
      title={style ? t(`classification.${style.labelKey}`) : undefined}
      className={cn(
        'group flex items-center justify-between gap-2 px-2 py-1.5 text-left text-sm transition-colors',
        current
          ? 'bg-chesscom-900 text-white dark:bg-chesscom-100 dark:text-chesscom-900'
          : 'hover:bg-chesscom-100 dark:hover:bg-chesscom-800',
      )}
    >
      <span className="truncate font-medium tabular-nums">{move.san}</span>
      {style && (
        <span
          className={cn(
            'flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-white',
            style.bgClass,
            current && 'ring-1 ring-white/60',
          )}
        >
          <svg viewBox="0 0 24 24" width={11} height={11} aria-hidden="true">
            {GLYPH_SVG[style.glyph]}
          </svg>
        </span>
      )}
    </button>
  );
}

// Severity order: blunder/miss > mistake > inaccuracy > brilliant > great > none.
// Brilliants and greats earn their own positive-spotlight tints (teal / steel
// blue) — chess.com's highlight reel leads with them, not buries them.
function pickTint(a?: string, b?: string): string {
  const sev = (c?: string) =>
    c === 'blunder' ? 5 :
    c === 'miss' ? 5 :
    c === 'mistake' ? 4 :
    c === 'inaccuracy' ? 3 :
    c === 'brilliant' ? 2 :
    c === 'great' ? 1 : 0;
  const w = Math.max(sev(a), sev(b));
  if (w === 5) return 'shadow-[inset_3px_0_0_0_theme(colors.move.blunder)]';
  if (w === 4) return 'shadow-[inset_3px_0_0_0_theme(colors.move.mistake)]';
  if (w === 3) return 'shadow-[inset_3px_0_0_0_theme(colors.move.inaccuracy)]';
  if (w === 2) return 'shadow-[inset_3px_0_0_0_theme(colors.move.brilliant)]';
  if (w === 1) return 'shadow-[inset_3px_0_0_0_theme(colors.move.great)]';
  return '';
}
