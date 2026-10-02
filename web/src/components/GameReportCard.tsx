// Game Report card — post-game summary. v5 layout follows chess.com's order:
//   [donut row + Elo pill] → [classification breakdown table] → [phase tiles].
// Skill-band labels appear under each accuracy donut. The active player's
// column wears a gold left border instead of a full-background inversion
// (chess.com's subtle "highlighted player" treatment).

import { useState } from 'react';
import { ChevronDown, Trophy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import AccuracyDonut from './AccuracyDonut';
import { CLASS_STYLE, GLYPH_SVG } from '../lib/classification';
import type { AnalyzedMove, Classification, PhaseSplit } from '../types';

interface Props {
  whiteName: string;
  blackName: string;
  accuracyW: number;
  accuracyB: number;
  eloW: number | null;
  eloB: number | null;
  perfW: number | null;
  perfB: number | null;
  moves: AnalyzedMove[];
  phaseSplit?: PhaseSplit | null;
  userColor?: 'white' | 'black' | null;
  /** Ply shown on the board, highlighted in an opened move list. */
  currentPly?: number;
  /** Jump to a ply. When set, each classification row opens the list of its moves. */
  onSelectPly?: (ply: number) => void;
}

export default function GameReportCard({
  whiteName, blackName, accuracyW, accuracyB,
  eloW, eloB, perfW, perfB, moves, phaseSplit, userColor, currentPly, onSelectPly,
}: Props) {
  const { t } = useTranslation();
  const [openCls, setOpenCls] = useState<Classification | null>(null);
  const w = countByCls(moves, 'white');
  const b = countByCls(moves, 'black');

  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 sm:p-5">
        <PlayerColumn name={whiteName} accuracy={accuracyW} elo={eloW} perf={perfW} side="white" highlighted={userColor === 'white'} />
        <PlayerColumn name={blackName} accuracy={accuracyB} elo={eloB} perf={perfB} side="black" highlighted={userColor === 'black'} />
      </div>

      <div className="grid grid-cols-[1fr_3rem_3rem] items-center gap-2 border-t border-chesscom-200 bg-chesscom-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-chesscom-500 dark:border-chesscom-700 dark:bg-chesscom-900/50">
        <span>{t('review.moves', { defaultValue: 'Move' })}</span>
        <span className="text-center">W</span>
        <span className="text-center">B</span>
      </div>
      {([...Object.keys(CLASS_STYLE)] as Classification[])
        .sort((a, b) => CLASS_STYLE[a].order - CLASS_STYLE[b].order)
        .map((c) => {
          const wc = w[c] ?? 0;
          const bc = b[c] ?? 0;
          if (wc === 0 && bc === 0) return null;
          const s = CLASS_STYLE[c];
          const open = openCls === c;
          const cells = (
            <>
              <div className="flex items-center gap-2">
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white ${s.bgClass}`}>
                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">{GLYPH_SVG[s.glyph]}</svg>
                </span>
                <span>{t(`classification.${s.labelKey}`)}</span>
                {onSelectPly && <ChevronDown className={`h-3.5 w-3.5 text-chesscom-400 transition-transform ${open ? 'rotate-180' : ''}`} />}
              </div>
              <span className={`text-center font-mono tabular-nums ${wc > 0 ? '' : 'opacity-30'}`}>{wc}</span>
              <span className={`text-center font-mono tabular-nums ${bc > 0 ? '' : 'opacity-30'}`}>{bc}</span>
            </>
          );
          const rowCls = 'grid w-full grid-cols-[1fr_3rem_3rem] items-center gap-2 px-4 py-1.5 text-start text-sm';
          return (
            <div key={c} className="border-b border-chesscom-100 last:border-b-0 dark:border-chesscom-800">
              {onSelectPly ? (
                <button
                  type="button"
                  onClick={() => setOpenCls(open ? null : c)}
                  aria-expanded={open}
                  className={`${rowCls} transition-colors hover:bg-chesscom-50 dark:hover:bg-chesscom-800/60`}
                >
                  {cells}
                </button>
              ) : (
                <div className={rowCls}>{cells}</div>
              )}
              {open && onSelectPly && (
                <div className="space-y-1.5 px-4 pb-2.5 pt-0.5" dir="ltr">
                  {(['white', 'black'] as const).map((side) => {
                    const list = moves.filter((m) => m.classification === c && (m.ply % 2 === 1) === (side === 'white'));
                    if (list.length === 0) return null;
                    return (
                      <div key={side} className="flex items-start gap-2">
                        <span className="mt-1 w-4 shrink-0 text-[11px] font-semibold uppercase text-chesscom-500">{side === 'white' ? 'W' : 'B'}</span>
                        <div className="flex flex-wrap gap-1">
                          {list.map((m) => (
                            <button
                              key={m.ply}
                              type="button"
                              onClick={() => onSelectPly(m.ply)}
                              className={`rounded px-1.5 py-0.5 font-mono text-xs tabular-nums transition-colors ${
                                m.ply === currentPly
                                  ? 'bg-chesscom-900 text-white dark:bg-chesscom-100 dark:text-chesscom-900'
                                  : 'bg-chesscom-100 hover:bg-chesscom-200 dark:bg-chesscom-700 dark:hover:bg-chesscom-600'
                              }`}
                            >
                              {Math.ceil(m.ply / 2)}{side === 'white' ? '.' : '…'} {m.san}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

      {phaseSplit && (phaseSplit.opening || phaseSplit.middlegame || phaseSplit.endgame) && (
        <div className="border-t border-chesscom-200 bg-chesscom-50 px-4 py-3 text-xs dark:border-chesscom-700 dark:bg-chesscom-900/40">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-chesscom-500">{t('review.phases', { defaultValue: 'Phases' })}</div>
          <div className="grid grid-cols-3 gap-2">
            <PhaseTile label={t('review.opening', { defaultValue: 'Opening' })} phase={phaseSplit.opening} userColor={userColor} />
            <PhaseTile label={t('review.middlegame', { defaultValue: 'Middlegame' })} phase={phaseSplit.middlegame} userColor={userColor} />
            <PhaseTile label={t('review.endgame', { defaultValue: 'Endgame' })} phase={phaseSplit.endgame} userColor={userColor} />
          </div>
        </div>
      )}
    </div>
  );
}

function PlayerColumn({ name, accuracy, elo, perf, side, highlighted }: { name: string; accuracy: number; elo: number | null; perf: number | null; side: 'white' | 'black'; highlighted?: boolean }) {
  const { t } = useTranslation();
  const sideDot = side === 'white' ? 'bg-white border border-chesscom-300' : 'bg-chesscom-900';
  // Gold left border for highlighted player — chess.com's subtle indicator.
  return (
    <div className={`rounded-md border bg-white p-3 dark:bg-chesscom-800 ${highlighted ? 'border-s-4 border-gold-500 border-y-chesscom-200 border-e-chesscom-200 dark:border-y-chesscom-700 dark:border-e-chesscom-700' : 'border-chesscom-200 dark:border-chesscom-700'}`}>
      <div className="flex items-center gap-2">
        <span className={`h-3 w-3 rounded-full ${sideDot}`} />
        <span className="truncate text-xs font-semibold uppercase tracking-wide text-chesscom-500">{side === 'white' ? 'White' : 'Black'}</span>
      </div>
      <div className="mt-1 truncate text-sm font-semibold">{name}</div>
      {/* Wraps the ratings under the donut when the column is too narrow for
          both (two columns inside the desktop side panel). */}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <AccuracyDonut value={accuracy} size={96} showBand />
        <div className="flex min-w-[7.5rem] flex-1 flex-col gap-1 text-xs">
          {elo != null && (
            <div className="flex items-center gap-1 text-chesscom-500">
              <Trophy className="h-3 w-3" />
              <span>{t('review.estRating')}</span>
              <span className="ms-auto rounded-sm bg-chesscom-100 px-1.5 py-0.5 font-mono font-bold tabular-nums text-chesscom-900 dark:bg-chesscom-700 dark:text-white">{elo}</span>
            </div>
          )}
          {perf != null && perf !== elo && (
            <div className="flex items-center gap-1 text-chesscom-500">
              <span>{t('review.performance')}</span>
              <span className="ms-auto rounded-sm bg-chesscom-100 px-1.5 py-0.5 font-mono font-bold tabular-nums text-chesscom-900 dark:bg-chesscom-700 dark:text-white">{perf}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PhaseTile({ label, phase, userColor }: { label: string; phase: PhaseSplit['opening'] | PhaseSplit['middlegame'] | PhaseSplit['endgame']; userColor?: 'white' | 'black' | null }) {
  if (!phase) {
    return (
      <div className="rounded-md bg-chesscom-100/50 p-2 text-center dark:bg-chesscom-800/50">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-chesscom-500">{label}</div>
        <div className="mt-1 font-mono text-sm text-chesscom-400">—</div>
      </div>
    );
  }
  const accUser = userColor === 'black' ? phase.accuracy_black : phase.accuracy_white;
  const accOther = userColor === 'black' ? phase.accuracy_white : phase.accuracy_black;
  return (
    <div className="rounded-md bg-white p-2 text-center shadow-soft dark:bg-chesscom-800">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-chesscom-500">{label}</div>
      <div className="mt-1 font-mono text-lg font-bold tabular-nums">{accUser.toFixed(1)}<span className="text-xs text-chesscom-400">%</span></div>
      <div className="text-[11px] text-chesscom-400">vs {accOther.toFixed(1)}%</div>
    </div>
  );
}

function countByCls(moves: AnalyzedMove[], side: 'white' | 'black'): Record<Classification, number> {
  const out = Object.fromEntries(Object.keys(CLASS_STYLE).map((k) => [k, 0])) as Record<Classification, number>;
  for (const m of moves) {
    const isWhite = m.ply % 2 === 1;
    if ((side === 'white') !== isWhite) continue;
    out[m.classification] = (out[m.classification] ?? 0) + 1;
  }
  return out;
}
