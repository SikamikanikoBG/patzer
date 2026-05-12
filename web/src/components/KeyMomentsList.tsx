// List of the 3–5 highest-impact plies for the Game Report.
// Each row is clickable — selecting jumps the board + move list to that ply.

import { CLASS_STYLE, GLYPH_SVG } from '../lib/classification';
import type { Classification } from '../types';

export interface KeyMomentItem {
  ply: number;
  side: 'white' | 'black';
  san: string;
  classification: Classification;
  cp_loss: number;
  win_pct_delta: number;
  best_san: string | null;
  // Optional AI-generated title/prose (when /api/games/:id/review has run)
  title?: string;
  prose?: string;
}

interface Props {
  items: KeyMomentItem[];
  current: number;
  onSelect: (ply: number) => void;
}

export default function KeyMomentsList({ items, current, onSelect }: Props) {
  if (items.length === 0) {
    return <div className="card p-4 text-sm text-chesscom-500">No key moments — a clean game.</div>;
  }
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-chesscom-100 bg-chesscom-50/60 px-4 py-2 text-[11px] uppercase tracking-wide text-chesscom-500 dark:border-chesscom-700 dark:bg-chesscom-900/40">
        Key Moments
      </div>
      <div className="divide-y divide-chesscom-100 dark:divide-chesscom-700">
        {items.map((m) => {
          const s = CLASS_STYLE[m.classification];
          const active = current === m.ply;
          return (
            <button
              key={m.ply}
              onClick={() => onSelect(m.ply)}
              className={`flex w-full items-start gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-chesscom-50 dark:hover:bg-chesscom-900/40 ${active ? 'bg-gold-50/70 dark:bg-gold-700/10 ring-1 ring-inset ring-gold-500/40' : ''}`}
            >
              <span className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white ${s.bgClass}`}>
                <svg viewBox="0 0 24 24" width={14} height={14} aria-hidden>{GLYPH_SVG[s.glyph]}</svg>
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-xs tabular-nums text-chesscom-500">#{Math.ceil(m.ply / 2)}{m.side === 'black' ? '…' : '.'}</span>
                  <span className="font-semibold">{m.san}</span>
                  {m.best_san && m.best_san !== m.san && (
                    <span className="text-xs text-chesscom-500">best: <span className="font-medium text-chesscom-700 dark:text-chesscom-200">{m.best_san}</span></span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-xs">
                  {m.title ? <span className="font-medium text-chesscom-800 dark:text-chesscom-100">{m.title}</span> : <span className={`font-medium ${s.textClass}`}>{m.classification}</span>}
                  <span className="ml-2 font-mono text-xs tabular-nums text-chesscom-500">−{m.cp_loss}cp · {m.win_pct_delta.toFixed(0)}wp</span>
                </div>
                {m.prose && (
                  <div className="mt-1 line-clamp-2 text-[12px] text-chesscom-600 dark:text-chesscom-300">{m.prose}</div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
