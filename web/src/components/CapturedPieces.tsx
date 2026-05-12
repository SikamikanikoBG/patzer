import { Chess } from 'chess.js';

const PIECE_SYMBOL: Record<string, Record<'white' | 'black', string>> = {
  Q: { white: '♕', black: '♛' },
  R: { white: '♖', black: '♜' },
  B: { white: '♗', black: '♝' },
  N: { white: '♘', black: '♞' },
  P: { white: '♙', black: '♟' },
};
const VALUE: Record<string, number> = { Q: 9, R: 5, B: 3, N: 3, P: 1 };
const START: Record<string, number> = { Q: 1, R: 2, B: 2, N: 2, P: 8 };

// Returns captured pieces for each side and the material balance (white perspective).
function counts(fen: string) {
  let white: Record<string, number> = { Q: 0, R: 0, B: 0, N: 0, P: 0 };
  let black: Record<string, number> = { Q: 0, R: 0, B: 0, N: 0, P: 0 };
  try {
    const c = new Chess(fen);
    for (const row of c.board()) {
      for (const sq of row) {
        if (!sq || sq.type === 'k') continue;
        const k = sq.type.toUpperCase();
        if (sq.color === 'w') white[k] = (white[k] ?? 0) + 1;
        else black[k] = (black[k] ?? 0) + 1;
      }
    }
  } catch { /* ignore */ }
  return { white, black };
}

interface Props {
  fen: string;
  side: 'white' | 'black'; // captured pieces of this player (i.e. enemy pieces removed)
  size?: 'sm' | 'md';
}

export default function CapturedPieces({ fen, side, size = 'sm' }: Props) {
  const c = counts(fen);
  // The pieces this `side` has captured = the OPPOSITE side's missing pieces.
  // If we're displaying "side=white", they captured black pieces (so we render black symbols).
  const oppKey = side === 'white' ? 'black' : 'white';
  const opp = (side === 'white' ? c.black : c.white);

  const captured: { type: string; sym: string; value: number }[] = [];
  let mat = 0;
  for (const k of ['Q', 'R', 'B', 'N', 'P']) {
    const missing = (START[k] ?? 0) - (opp[k] ?? 0);
    for (let i = 0; i < missing; i++) {
      captured.push({ type: k, sym: PIECE_SYMBOL[k]![oppKey === 'black' ? 'black' : 'white'], value: VALUE[k] ?? 0 });
      mat += VALUE[k] ?? 0;
    }
  }
  // Material balance (white perspective): white captured value − black captured value
  // For display next to a single side, just show that side's haul value.

  const sizeCls = size === 'sm' ? 'text-xl' : 'text-3xl';
  if (captured.length === 0) return <div className="h-6" />;

  return (
    <div className="flex items-center gap-1 overflow-hidden">
      <div className={`flex flex-wrap gap-0 leading-none ${sizeCls}`}>
        {captured.map((p, i) => (
          <span key={i} className="-ml-1 first:ml-0">{p.sym}</span>
        ))}
      </div>
      {mat > 0 && (
        <span className="ml-1 rounded bg-accent-500/15 px-1.5 py-0.5 text-[11px] font-mono font-bold text-accent-700 dark:text-accent-300">
          +{mat}
        </span>
      )}
    </div>
  );
}
