import { useTranslation } from 'react-i18next';
import { CLASSIFICATIONS, type Classification, type AnalyzedMove } from '../types';
import { CLASS_STYLE, GLYPH_SVG } from '../lib/classification';

interface Props {
  moves: AnalyzedMove[];
  whiteName: string;
  blackName: string;
  onClickClassification?: (cls: Classification, side: 'white' | 'black') => void;
}

// Per-classification counts, two columns (W / B). Hides rows that are 0/0 by
// default so the panel stays compact for clean games (chess.com convention).
export default function ClassificationStats({ moves, whiteName, blackName, onClickClassification }: Props) {
  const { t } = useTranslation();

  const w = Object.fromEntries(CLASSIFICATIONS.map((c) => [c, 0])) as Record<Classification, number>;
  const b = Object.fromEntries(CLASSIFICATIONS.map((c) => [c, 0])) as Record<Classification, number>;
  for (const m of moves) {
    const tgt = m.ply % 2 === 1 ? w : b;
    tgt[m.classification] += 1;
  }

  const ordered = [...CLASSIFICATIONS].sort((a, c) => CLASS_STYLE[a].order - CLASS_STYLE[c].order);

  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-[1fr_3rem_3rem] items-center border-b border-ink-100 bg-ink-50/60 px-3 py-1.5 text-[11px] uppercase tracking-wide text-ink-500 dark:border-ink-700 dark:bg-ink-900/40">
        <span>{t('review.moves')}</span>
        <span className="text-center" title={whiteName}>W</span>
        <span className="text-center" title={blackName}>B</span>
      </div>
      {ordered.map((c) => {
        const wc = w[c], bc = b[c];
        if (wc === 0 && bc === 0) return null;
        const s = CLASS_STYLE[c];
        return (
          <div key={c} className="grid grid-cols-[1fr_3rem_3rem] items-center border-b border-ink-100 last:border-0 dark:border-ink-800">
            <div className="flex items-center gap-2 px-3 py-1.5">
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-white ${s.bgClass}`}>
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">{GLYPH_SVG[s.glyph]}</svg>
              </span>
              <span className="text-sm">{t(`classification.${s.labelKey}`)}</span>
            </div>
            <button
              disabled={wc === 0}
              onClick={() => onClickClassification?.(c, 'white')}
              className={`px-2 py-1.5 text-center font-mono tabular-nums ${wc > 0 ? 'cursor-pointer hover:bg-ink-50 dark:hover:bg-ink-800' : 'opacity-30'}`}
            >
              {wc}
            </button>
            <button
              disabled={bc === 0}
              onClick={() => onClickClassification?.(c, 'black')}
              className={`px-2 py-1.5 text-center font-mono tabular-nums ${bc > 0 ? 'cursor-pointer hover:bg-ink-50 dark:hover:bg-ink-800' : 'opacity-30'}`}
            >
              {bc}
            </button>
          </div>
        );
      })}
    </div>
  );
}
