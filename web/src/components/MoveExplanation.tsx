// "Why this move?" — the card at the top of Game Review's Moves tab. For the
// current move it says, in words, why the engine classified it the way it
// did (the win-chance numbers behind the label), what the engine wanted
// instead and how that line goes on, and then the coach explains it in plain
// language: what the move does, what it allows, and what the better move
// would have achieved.

import { useTranslation } from 'react-i18next';
import { CLASS_STYLE, GLYPH_SVG } from '../lib/classification';
import CoachPanel from './CoachPanel';
import type { AnalyzedMove } from '../types';

/** Lichess win-chance curve (same as the server's cpToWinPct), 0..100 for White. */
export function whiteWinPct(cp: number | null | undefined): number {
  const v = cp ?? 0;
  if (v >= 9000) return 100;
  if (v <= -9000) return 0;
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * v)) - 1);
}

/** Win chance before and after the move, for the side that played it. */
export function moverWinPct(move: Pick<AnalyzedMove, 'ply' | 'eval_before_cp' | 'eval_after_cp'>) {
  const white = move.ply % 2 === 1;
  const pov = (cp: number | null | undefined) => (white ? whiteWinPct(cp) : 100 - whiteWinPct(cp));
  const before = Math.round(pov(move.eval_before_cp));
  const after = Math.round(pov(move.eval_after_cp));
  return { before, after, drop: Math.max(0, before - after) };
}

interface Props {
  move: AnalyzedMove;
  /** The player's colour, so the card can say "your move" / "opponent's move". */
  userColor: 'white' | 'black' | null;
  coachConfigured: boolean;
  coachRequest: (() => { url: string; body: Record<string, unknown> }) | null;
}

export default function MoveExplanation({ move, userColor, coachConfigured, coachRequest }: Props) {
  const { t } = useTranslation();
  const s = CLASS_STYLE[move.classification];
  const side = move.ply % 2 === 1 ? 'white' : 'black';
  const who = userColor == null
    ? t(side === 'white' ? 'review.why.whiteMove' : 'review.why.blackMove')
    : t(side === userColor ? 'review.why.yourMove' : 'review.why.opponentMove');
  const wp = moverWinPct(move);
  const pawns = (move.centipawn_loss / 100).toFixed(1);
  const reason = t(`review.why.${move.classification}`, { before: wp.before, after: wp.after, drop: wp.drop, pawns });
  const showBest = !!move.best_move_san && move.best_move_san !== move.san;
  const line = move.best_pv?.slice(0, 6).join(' ');
  const num = `${Math.ceil(move.ply / 2)}${side === 'white' ? '.' : '…'}`;

  return (
    <div className="mb-3 rounded-lg border border-chesscom-200 bg-chesscom-50/60 p-3 dark:border-chesscom-700 dark:bg-chesscom-900/40">
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white ${s.bgClass}`}>
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">{GLYPH_SVG[s.glyph]}</svg>
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wide text-chesscom-500">{who}</div>
          <div className="truncate text-sm font-semibold">
            <span className="font-mono">{num}{move.san}</span>
            <span className={`ms-2 ${s.textClass}`}>{t(`classification.${s.labelKey}`)}</span>
          </div>
        </div>
        <div className="shrink-0 text-right font-mono text-xs tabular-nums text-chesscom-500" title={t('review.why.winChance')}>
          {wp.before}% → <span className={wp.drop >= 10 ? 'font-bold text-bad' : 'font-semibold text-chesscom-800 dark:text-chesscom-100'}>{wp.after}%</span>
        </div>
      </div>

      <p className="mt-2 text-sm text-chesscom-800 dark:text-chesscom-100">{reason}</p>

      {showBest && (
        <div className="mt-2 rounded-md bg-white px-2.5 py-1.5 text-xs dark:bg-chesscom-800">
          <span className="text-chesscom-500">{t('review.why.engineWanted')} </span>
          <span className="font-mono font-semibold text-move-best">{move.best_move_san}</span>
          {line && (
            <div className="mt-0.5 font-mono text-[11px] text-chesscom-500">{t('review.why.line')}: {line}</div>
          )}
        </div>
      )}

      <div className="mt-3 border-t border-chesscom-200 pt-2 dark:border-chesscom-700">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-chesscom-500">{t('review.why.coachSays')}</div>
        <CoachPanel
          systemConfigured={coachConfigured}
          request={coachRequest}
          autoPlay
          triggerKey={move.ply}
          debounceMs={700}
          compact
        />
      </div>
    </div>
  );
}
