// The board of the Learn section. Separate from ChessBoard on purpose: lessons
// need things a game board must not have — boards without kings, a piece that
// keeps the move while it collects stars, tapping empty squares, and animated
// pieces (a game turns animation off because it reads as lag; in a lesson,
// seeing the piece travel is the point).

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Chessground } from 'chessground';
import type { Api as CgApi } from 'chessground/api';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import { Star } from 'lucide-react';
import { PromotionPicker, type PieceLetter } from '../ChessBoard';
import { board as loadBoard, castleByRook, inCheck, sideToMove } from '../../learn/engine';
import type { Side, Sq } from '../../learn/types';

export interface Flash { sq: Sq; kind: 'good' | 'bad'; id: number }

interface Props {
  fen: string;
  orientation: Side;
  /** Legal destinations; the board is only movable when this is given. */
  dests?: Map<Sq, Sq[]> | null;
  onMove?: (uci: string) => void;
  /** Tap on any square (square tasks). */
  onSquare?: (sq: Sq) => void;
  lastMove?: [Sq, Sq];
  shapes?: DrawShape[];
  stars?: Sq[];
  /** Squares already found in a square task. */
  found?: Sq[];
  flashes?: Flash[];
  /** Bump to snap the pieces back to `fen` (a wrong move bounces back). */
  resetKey?: number;
}

export default function LessonBoard({
  fen, orientation, dests, onMove, onSquare, lastMove, shapes, stars, found, flashes, resetKey,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<CgApi | null>(null);
  const [promotion, setPromotion] = useState<{ from: Sq; to: Sq; color: Side } | null>(null);

  // chessground keeps the callbacks it was mounted with; read the latest props.
  const latest = useRef({ fen, onMove, onSquare });
  latest.current = { fen, onMove, onSquare };

  function after(orig: Key, dest: Key) {
    const piece = loadBoard(latest.current.fen).get(orig as never);
    if (piece?.type === 'p' && (dest[1] === '8' || dest[1] === '1')) {
      setPromotion({ from: orig, to: dest, color: piece.color === 'w' ? 'white' : 'black' });
      return;
    }
    latest.current.onMove?.(castleByRook(latest.current.fen, orig + dest));
  }

  useEffect(() => {
    if (!ref.current) return;
    apiRef.current = Chessground(ref.current, {
      fen,
      orientation,
      coordinates: true,
      animation: { enabled: true, duration: 220 },
      highlight: { lastMove: true, check: true },
      premovable: { enabled: false },
      drawable: { enabled: false, visible: true },
      movable: { free: false, showDests: true, events: { after } },
      events: { select: (key) => latest.current.onSquare?.(key) },
    });
    // Same stale-bounds problem as ChessBoard: chessground caches where the
    // board is on screen, and on a phone the lesson text above the board
    // changes height with every step. Forget the cached position right before
    // chessground handles a press (capture phase runs first), so a tap always
    // lands on the square under the finger.
    const el = ref.current;
    const fresh = () => apiRef.current?.state.dom.bounds.clear();
    el.addEventListener('mousedown', fresh, true);
    el.addEventListener('touchstart', fresh, { capture: true, passive: true });
    const ro = new ResizeObserver(() => apiRef.current?.redrawAll());
    ro.observe(el);
    return () => {
      ro.disconnect();
      el.removeEventListener('mousedown', fresh, true);
      el.removeEventListener('touchstart', fresh, true);
      apiRef.current?.destroy();
      apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const turn = sideToMove(fen);
    api.set({
      fen,
      orientation,
      turnColor: turn,
      lastMove: lastMove as Key[] | undefined,
      check: inCheck(fen) ? turn : false,
      movable: {
        color: dests ? turn : undefined,
        dests: (dests ?? new Map()) as Map<Key, Key[]>,
      },
    });
    api.selectSquare(null);
    api.setAutoShapes(shapes ?? []);
  }, [fen, orientation, dests, lastMove, shapes, resetKey]);

  function pick(piece: PieceLetter) {
    if (!promotion) return;
    onMove?.(promotion.from + promotion.to + piece);
    setPromotion(null);
  }

  const occupied = useMemo(() => {
    const out = new Set<Sq>();
    for (const row of loadBoard(fen).board()) for (const p of row) if (p) out.add(p.square);
    return out;
  }, [fen]);

  return (
    <div className="relative select-none">
      <div ref={ref} style={{ width: '100%', aspectRatio: '1 / 1' }} />
      <Overlay orientation={orientation} stars={stars ?? []} occupied={occupied} found={found ?? []} flashes={flashes ?? []} />
      {promotion && (
        <PromotionPicker
          color={promotion.color}
          square={promotion.to}
          orientation={orientation}
          onPick={pick}
          onCancel={() => { setPromotion(null); apiRef.current?.set({ fen }); }}
        />
      )}
    </div>
  );
}

// Stars, found squares and the green/red blink of a tap sit on a layer above
// the pieces that ignores the pointer, like PieceEmotionsOverlay.
function Overlay({ orientation, stars, occupied, found, flashes }: {
  orientation: Side; stars: Sq[]; occupied: Set<Sq>; found: Sq[]; flashes: Flash[];
}) {
  const pos = (sq: Sq): React.CSSProperties => {
    const file = sq.charCodeAt(0) - 97;
    const rank = Number(sq[1]) - 1;
    const flip = orientation === 'black';
    return {
      left: `${(flip ? 7 - file : file) * 12.5}%`,
      top: `${(flip ? rank : 7 - rank) * 12.5}%`,
      width: '12.5%',
      height: '12.5%',
    };
  };
  return (
    <div className="pointer-events-none absolute inset-0 z-[3]">
      {found.map((sq) => (
        <div key={`found-${sq}`} className="absolute flex items-center justify-center" style={pos(sq)}>
          <motion.div
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="h-1/2 w-1/2 rounded-full bg-green-400/80 ring-4 ring-white/60"
          />
        </div>
      ))}
      <AnimatePresence>
        {stars.map((sq) => (
          <motion.div
            key={`star-${sq}`}
            className="absolute flex items-center justify-center"
            style={pos(sq)}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1, transition: { type: 'spring', stiffness: 400, damping: 18 } }}
            exit={{ scale: 1.8, opacity: 0, rotate: 45, transition: { duration: 0.35 } }}
          >
            {/* On a piece to capture, the star sits in the corner so the piece stays visible. */}
            <Star className={`fill-gold-500 text-gold-600 drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)] ${
              occupied.has(sq) ? 'absolute right-[3%] top-[3%] h-[40%] w-[40%]' : 'h-[55%] w-[55%]'}`} />
          </motion.div>
        ))}
      </AnimatePresence>
      <AnimatePresence>
        {flashes.map((f) => (
          <motion.div
            key={f.id}
            className={`absolute ${f.kind === 'good' ? 'bg-green-400/70' : 'bg-bad/60'}`}
            style={pos(f.sq)}
            initial={{ opacity: 0.9 }}
            animate={{ opacity: 0, transition: { duration: 0.9 } }}
            exit={{ opacity: 0 }}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
