import { useEffect, useRef, useState } from 'react';
import { Chessground } from 'chessground';
import type { Api as CgApi } from 'chessground/api';
import type { Config } from 'chessground/config';
import type { Key, Color } from 'chessground/types';
import { Chess } from 'chess.js';

interface Props {
  fen: string;
  orientation?: 'white' | 'black';
  movable?: boolean;
  turnColor?: Color;
  onMove?: (uci: string) => void;
  lastMove?: [Key, Key];
  arrows?: { orig: Key; dest: Key; brush?: string }[];
  size?: number;
  /** Bump to force the board to re-sync to the current `fen` prop (e.g. after
   *  a rolled-back blunder warning, or after the server rejects a move). */
  resetKey?: number;
}

type PieceLetter = 'q' | 'r' | 'b' | 'n';

export default function ChessBoard({
  fen, orientation = 'white', movable = false, turnColor, onMove,
  lastMove, arrows, size, resetKey,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<CgApi | null>(null);
  const [promotion, setPromotion] = useState<{ from: string; to: string; color: 'white' | 'black' } | null>(null);

  // Mount chessground once
  useEffect(() => {
    if (!ref.current) return;
    const config: Config = {
      fen,
      orientation,
      turnColor,
      coordinates: true,
      animation: { enabled: true, duration: 200 },
      highlight: { lastMove: true, check: true },
      movable: movable
        ? {
            color: turnColor,
            free: false,
            dests: legalDests(fen),
            showDests: true,
            events: {
              after: (orig, dest) => {
                if (needsPromotion(fen, orig, dest)) {
                  // Show our picker instead of auto-promoting
                  setPromotion({ from: orig, to: dest, color: turnColor ?? 'white' });
                  // Don't call onMove yet — wait for piece pick
                  return;
                }
                onMove?.(orig + dest);
              },
            },
          }
        : { free: false },
      drawable: { enabled: true, defaultSnapToValidMove: true },
    };
    apiRef.current = Chessground(ref.current, config);
    return () => {
      apiRef.current?.destroy();
      apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync on prop changes (also when resetKey bumps — used to roll back illegal/cancelled moves)
  useEffect(() => {
    if (!apiRef.current) return;
    apiRef.current.set({
      fen,
      orientation,
      turnColor,
      lastMove,
      movable: movable
        ? { color: turnColor, free: false, dests: legalDests(fen), showDests: true }
        : { free: false },
    });
    if (arrows && arrows.length) {
      apiRef.current.setShapes(arrows.map((a) => ({ orig: a.orig, dest: a.dest, brush: a.brush ?? 'green' })));
    } else {
      apiRef.current.setShapes([]);
    }
  }, [fen, orientation, turnColor, lastMove, movable, arrows, resetKey]);

  function pickPromotion(piece: PieceLetter) {
    if (!promotion) return;
    onMove?.(promotion.from + promotion.to + piece);
    setPromotion(null);
  }
  function cancelPromotion() {
    if (!promotion) return;
    setPromotion(null);
    // Roll back the chessground visual to the current fen (the piece was moved client-side)
    apiRef.current?.set({ fen });
  }

  const style: React.CSSProperties = size != null
    ? { width: size, height: size }
    : { width: '100%', aspectRatio: '1 / 1' };

  return (
    <div className="relative">
      <div ref={ref} style={style} />
      {promotion && (
        <PromotionPicker
          color={promotion.color}
          square={promotion.to}
          orientation={orientation}
          onPick={pickPromotion}
          onCancel={cancelPromotion}
        />
      )}
    </div>
  );
}

function PromotionPicker({ color, square, orientation, onPick, onCancel }:
  { color: 'white' | 'black'; square: string; orientation: 'white' | 'black'; onPick: (p: PieceLetter) => void; onCancel: () => void }) {
  const file = square.charCodeAt(0) - 97;
  const rank = parseInt(square[1]!, 10) - 1;
  const flip = orientation === 'black';
  const colPct = (flip ? 7 - file : file) * 12.5;
  const rowPct = (flip ? rank : 7 - rank) * 12.5;
  // Position picker just below the destination square if at top of board, else above
  const placeAbove = (flip ? rank > 4 : rank < 4);
  const pieces: PieceLetter[] = ['q', 'r', 'b', 'n'];
  const symbols: Record<PieceLetter, Record<'white' | 'black', string>> = {
    q: { white: '♕', black: '♛' },
    r: { white: '♖', black: '♜' },
    b: { white: '♗', black: '♝' },
    n: { white: '♘', black: '♞' },
  };

  return (
    <>
      <div className="absolute inset-0 z-30 cursor-pointer" onClick={onCancel} />
      <div
        className="absolute z-40 flex gap-1 rounded-xl border border-ink-300 bg-white p-1 shadow-lift dark:border-ink-700 dark:bg-ink-800"
        style={{
          left: `calc(${colPct}% - 8px)`,
          [placeAbove ? 'bottom' : 'top']: `calc(${100 - rowPct - 12.5}% + 6px)`,
        }}
      >
        {pieces.map((p) => (
          <button key={p} onClick={(e) => { e.stopPropagation(); onPick(p); }}
            className="flex h-12 w-12 items-center justify-center rounded-lg text-3xl transition-colors hover:bg-accent-100 dark:hover:bg-accent-700/30"
            title={p.toUpperCase()}>
            {symbols[p][color]}
          </button>
        ))}
      </div>
    </>
  );
}

function legalDests(fen: string): Map<Key, Key[]> {
  const chess = new Chess(fen);
  const map = new Map<Key, Key[]>();
  for (const m of chess.moves({ verbose: true })) {
    const arr = map.get(m.from as Key) ?? [];
    arr.push(m.to as Key);
    map.set(m.from as Key, arr);
  }
  return map;
}

function needsPromotion(fen: string, from: string, to: string): boolean {
  const chess = new Chess(fen);
  const piece = chess.get(from as never);
  if (!piece || piece.type !== 'p') return false;
  return (piece.color === 'w' && to[1] === '8') || (piece.color === 'b' && to[1] === '1');
}
