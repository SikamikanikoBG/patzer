import { useMemo, useState } from 'react';
import { styleFor } from '../lib/classification';

interface Eval { ply: number; cp: number | null }
interface Mistake { ply: number; classification: string }

interface Props {
  evals: Eval[];
  current?: number;
  onClick?: (ply: number) => void;
  /** Plies where blunders/mistakes/inaccuracies happened, drawn as colored dots. */
  markers?: Mistake[];
  /** Pixel height; defaults to 96 (chess.com Game Review). */
  height?: number;
}

// Same sigmoid the classifier uses server-side (Lichess formula). White's
// share of the bar in [0, 1].
function cpToWinShare(cp: number): number {
  if (cp >= 9000) return 1;
  if (cp <= -9000) return 0;
  const v = 2 / (1 + Math.exp(-0.00368208 * cp)) - 1;
  return Math.max(0.03, Math.min(0.97, 0.5 + 0.5 * v));
}

function fmtCp(cp: number | null): string {
  if (cp == null) return '0.0';
  if (cp >= 9000) {
    const moves = Math.max(1, Math.round((10000 - cp) / 10));
    return `M${moves}`;
  }
  if (cp <= -9000) {
    const moves = Math.max(1, Math.round((10000 - Math.abs(cp)) / 10));
    return `-M${moves}`;
  }
  const sign = cp > 0 ? '+' : cp < 0 ? '−' : '';
  return `${sign}${(Math.abs(cp) / 100).toFixed(2)}`;
}

// Hand-rolled SVG eval graph — chess.com-style horizontal area chart. White's
// win-share is filled from the top, black's from the bottom, midline at 0.0.
// Mistake/blunder/brilliancy markers are circles colored by class. Hovering
// shows a vertical hairline + chip with the ply's cp value.
export default function EvalGraph({ evals, current, onClick, markers = [], height = 96 }: Props) {
  const [hoverPly, setHoverPly] = useState<number | null>(null);
  const points = useMemo(() => {
    if (!evals.length) return [] as Array<{ x: number; y: number; share: number; cp: number; ply: number }>;
    const w = 100;
    const dx = evals.length > 1 ? w / (evals.length - 1) : w;
    return evals.map((e, i) => {
      const cp = e.cp ?? 0;
      const share = cpToWinShare(cp);
      return { x: i * dx, y: (1 - share) * 100, share, cp, ply: e.ply };
    });
  }, [evals]);

  if (!points.length) {
    return <div style={{ height }} className="grid w-full place-items-center text-xs text-chesscom-400">No evaluation yet</div>;
  }

  const linePath = points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const lastX = points[points.length - 1]!.x.toFixed(2);
  const firstX = points[0]!.x.toFixed(2);
  const blackArea = `${linePath} L${lastX},100 L${firstX},100 Z`;
  const whiteArea = `${linePath} L${lastX},0 L${firstX},0 Z`;

  function pickPly(clientX: number, rect: DOMRect): number {
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const idx = Math.round(ratio * (evals.length - 1));
    return evals[idx]?.ply ?? evals[0]!.ply;
  }

  const hoverPoint = hoverPly != null ? points[hoverPly - 1] : undefined;
  const hoverCp = hoverPoint?.cp ?? null;

  return (
    <div className="relative w-full" style={{ height }}>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="block h-full w-full cursor-crosshair"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setHoverPly(pickPly(e.clientX, rect));
        }}
        onMouseLeave={() => setHoverPly(null)}
        onClick={(e) => {
          if (!onClick) return;
          const rect = e.currentTarget.getBoundingClientRect();
          onClick(pickPly(e.clientX, rect));
        }}
      >
        {/* White's territory */}
        <path d={whiteArea} className="fill-white opacity-95 dark:fill-chesscom-200" />
        {/* Black's territory */}
        <path d={blackArea} className="fill-chesscom-900 opacity-95" />
        {/* Midline */}
        <line x1="0" y1="50" x2="100" y2="50" stroke="rgba(100,116,139,0.40)" strokeWidth="0.4" strokeDasharray="1.5 1.5" />
        {/* Eval line — chesscom-400 reads on both halves */}
        <path d={linePath} fill="none" stroke="#7d7670" strokeWidth="0.7" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {/* Mistake / blunder / brilliancy markers */}
        {markers.map((m) => {
          const idx = m.ply - 1;
          const p = points[idx];
          if (!p) return null;
          const s = styleFor(m.classification);
          if (!s) return null;
          const radius = m.classification === 'brilliant' ? 2.6 : 2.0;
          return (
            <circle
              key={m.ply}
              cx={p.x}
              cy={p.y}
              r={radius}
              fill={s.hex}
              stroke="#fff"
              strokeWidth="0.5"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        {/* Current-ply scrubber — chess.com gold, not emerald */}
        {current !== undefined && (() => {
          const p = points[current - 1] ?? points[0];
          if (!p) return null;
          return (
            <g>
              <line x1={p.x} y1={0} x2={p.x} y2={100} stroke="#ffc934" strokeWidth="0.5" strokeDasharray="1 1" vectorEffect="non-scaling-stroke" />
              <circle cx={p.x} cy={p.y} r="2.4" fill="#ffc934" stroke="#fff" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
            </g>
          );
        })()}
        {/* Hover hairline */}
        {hoverPoint && hoverPoint.ply !== current && (
          <line x1={hoverPoint.x} y1={0} x2={hoverPoint.x} y2={100} stroke="rgba(125,118,112,0.55)" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {/* Hover eval chip — top-right of cursor */}
      {hoverPoint && (
        <div
          className="pointer-events-none absolute top-1 rounded-sm bg-chesscom-900/90 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-white shadow-soft"
          style={{
            left: `calc(${hoverPoint.x}% + 4px)`,
            transform: hoverPoint.x > 80 ? 'translateX(-100%)' : undefined,
          }}
        >
          {fmtCp(hoverCp)}
        </div>
      )}
      {/* Current eval pill — top-right corner, always dark */}
      {current !== undefined && points[current - 1] && (
        <div className="pointer-events-none absolute right-2 top-2 rounded-sm bg-chesscom-900/85 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-white backdrop-blur-sm">
          {fmtCp(points[current - 1]!.cp)}
        </div>
      )}
    </div>
  );
}
