import { Fragment } from 'react';
import MoveRow from './MoveRow';
import type { PhaseSplit } from '../types';

interface Move { ply: number; san: string; classification?: string }

interface Props {
  moves: Move[];
  current: number;
  onSelect: (ply: number) => void;
  /** Optional phase split — when present, inserts OPENING / MIDDLEGAME /
   *  ENDGAME divider rows between move-pairs to match chess.com Game Review. */
  phaseSplit?: PhaseSplit | null;
  /** Optional pixel cap; defaults to 420. */
  maxHeight?: number;
}

// Two-column move-pair-per-row list. The badge sits to the right of each SAN,
// the current half-move is highlighted, and the row's left edge is tinted by
// the worst classification in the pair (matching chess.com Game Review).
export default function MoveList({ moves, current, onSelect, phaseSplit, maxHeight = 420 }: Props) {
  const rows: { num: number; white?: Move; black?: Move }[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    rows.push({ num: i / 2 + 1, white: moves[i], black: moves[i + 1] });
  }

  // Build a map from "move-pair number" to "phase label to insert BEFORE it".
  // The first phase label sits at the top (no insertion above row 1 needed —
  // chess.com renders OPENING as a banner above the list).
  const phaseAtPair: Map<number, 'opening' | 'middlegame' | 'endgame'> = new Map();
  if (phaseSplit?.middlegame?.from_ply) {
    phaseAtPair.set(Math.ceil(phaseSplit.middlegame.from_ply / 2), 'middlegame');
  }
  if (phaseSplit?.endgame?.from_ply) {
    phaseAtPair.set(Math.ceil(phaseSplit.endgame.from_ply / 2), 'endgame');
  }

  return (
    <div
      className="overflow-auto rounded-md border border-chesscom-200 bg-white dark:border-chesscom-700 dark:bg-chesscom-800/60"
      style={{ maxHeight }}
    >
      <div className="sticky top-0 z-10 grid grid-cols-[2.25rem_1fr_1fr] border-b border-chesscom-200 bg-chesscom-50 px-0 py-1 text-[11px] font-semibold uppercase tracking-wide text-chesscom-500 dark:border-chesscom-700 dark:bg-chesscom-900/60">
        <div />
        <div className="px-2">White</div>
        <div className="px-2">Black</div>
      </div>
      {phaseSplit?.opening && (
        <PhaseDivider label="Opening" />
      )}
      {rows.map((r) => {
        const phaseHere = phaseAtPair.get(r.num);
        return (
          <Fragment key={r.num}>
            {phaseHere && (
              <PhaseDivider label={phaseHere === 'middlegame' ? 'Middlegame' : 'Endgame'} />
            )}
            <MoveRow
              num={r.num}
              white={r.white}
              black={r.black}
              current={current}
              onSelect={onSelect}
            />
          </Fragment>
        );
      })}
    </div>
  );
}

function PhaseDivider({ label }: { label: string }) {
  return (
    <div className="border-b border-t border-chesscom-200 bg-chesscom-50/70 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-chesscom-500 dark:border-chesscom-700 dark:bg-chesscom-900/40">
      {label}
    </div>
  );
}
