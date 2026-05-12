// Opening banner — strip above the move list showing ECO + opening name.
// Renders nothing when neither field is available (don't pollute the UI with
// "Unknown opening" cards).

import { BookOpen } from 'lucide-react';

interface Props {
  eco: string | null | undefined;
  name: string | null | undefined;
  prose?: string | null;
}

export default function OpeningBanner({ eco, name, prose }: Props) {
  if (!name && !eco) return null;
  return (
    <div className="card flex items-start gap-3 p-3 sm:p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-board-dark/15 text-board-dark">
        <BookOpen className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <div className="text-sm font-semibold">{name ?? '—'}</div>
          {eco && <div className="rounded-md bg-chesscom-100 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-chesscom-700 dark:bg-chesscom-700 dark:text-chesscom-200">{eco}</div>}
        </div>
        {prose && <div className="mt-1 text-xs text-chesscom-500 dark:text-chesscom-300">{prose}</div>}
      </div>
    </div>
  );
}
