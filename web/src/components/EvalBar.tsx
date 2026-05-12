import { useMemo } from 'react';
import { motion } from 'framer-motion';

interface Props {
  cp: number | null;       // white-perspective centipawns; null = even
  mate?: number | null;    // mate-in-N from white's POV (positive = white mates)
  orientation?: 'white' | 'black';
  /** Optional explicit height. If omitted, fills parent height (use with align-self: stretch). */
  height?: number;
}

// Convert centipawns to white's bar share [0, 1] using the same sigmoid as
// cpToWinPct in the server-side classifier (Lichess formula).
function cpToShare(cp: number): number {
  if (cp >= 9000) return 1;
  if (cp <= -9000) return 0;
  const v = 2 / (1 + Math.exp(-0.00368208 * cp)) - 1;
  return Math.max(0.03, Math.min(0.97, 0.5 + 0.5 * v));
}

function fmtCp(cp: number | null): string {
  if (cp == null) return '0.0';
  if (cp >= 9000) return '#';
  if (cp <= -9000) return '-#';
  const sign = cp > 0 ? '+' : cp < 0 ? '−' : '';
  return `${sign}${(Math.abs(cp) / 100).toFixed(1)}`;
}

export default function EvalBar({ cp, mate, orientation = 'white', height }: Props) {
  const share = useMemo(() => {
    if (mate != null) return mate > 0 ? 1 : 0;
    return cpToShare(cp ?? 0);
  }, [cp, mate]);
  const whitePct = share * 100;
  const blackPct = 100 - whitePct;
  const whiteAdvantage = mate != null ? mate > 0 : (cp ?? 0) >= 0;
  const flip = orientation === 'black';
  const label = mate != null ? (mate > 0 ? `M${mate}` : `M${-mate}`) : fmtCp(cp);
  const isMate = mate != null;

  // 18px wide, matches chess.com. flexShrink:0 keeps the bar from being
  // squeezed when the sibling board uses w-full inside a flex row; alignSelf
  // belongs on the flex item itself (the outer relative div), not on the
  // inner styled div where it has no effect.
  const wrapStyle: React.CSSProperties = height != null
    ? { height, width: 18, flexShrink: 0 }
    : { width: 18, flexShrink: 0, alignSelf: 'stretch' };

  // Smooth tween instead of spring — chess.com's bar feels glide-y, not bouncy.
  const ease = [0.22, 1, 0.36, 1] as const;

  return (
    <div className="relative" style={wrapStyle}>
      <div
        className={`relative flex h-full w-full flex-col overflow-hidden rounded-l-md border border-chesscom-300 bg-chesscom-200 shadow-soft dark:border-chesscom-700 ${isMate ? 'shadow-glow' : ''}`}
      >
        <motion.div
          className={`flex items-start justify-center text-[10px] font-semibold tabular-nums text-white/90 ${
            isMate && !whiteAdvantage ? 'bg-bad' : 'bg-chesscom-900'
          }`}
          animate={{ height: `${flip ? whitePct : blackPct}%` }}
          transition={{ type: 'tween', duration: 0.28, ease }}
        />
        <motion.div
          className={`flex items-end justify-center text-[10px] font-semibold tabular-nums text-chesscom-900 ${
            isMate && whiteAdvantage ? 'bg-warn' : 'bg-white'
          }`}
          animate={{ height: `${flip ? blackPct : whitePct}%` }}
          transition={{ type: 'tween', duration: 0.28, ease }}
        />
        {/* 0-tick: thin board-green line at the midpoint so 0.0 is always visible. */}
        <div
          className="pointer-events-none absolute inset-x-0 h-px"
          style={{ top: '50%', backgroundColor: 'rgba(118,150,86,0.55)' }}
        />
      </div>
      {/* Floating score chip on the advantaged side, outside the bar. */}
      <div
        className={`pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-sm px-1 py-0.5 text-[11px] font-bold tabular-nums shadow-soft ${
          whiteAdvantage
            ? 'bg-white text-chesscom-900 ring-1 ring-chesscom-200'
            : 'bg-chesscom-900 text-white ring-1 ring-chesscom-700'
        }`}
        style={{
          [whiteAdvantage === !flip ? 'bottom' : 'top']: 4,
        } as React.CSSProperties}
      >
        {label}
      </div>
    </div>
  );
}
