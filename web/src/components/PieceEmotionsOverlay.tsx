// Floating mood bubbles for "Living Pieces" (kid mode). Sits as an overlay
// above the chessground SVG and shows an emoji + soft animation for each of
// the viewer's pieces, depending on its tactical state.
//
// Why an overlay rather than touching the piece sprites: chessground renders
// its pieces as `<piece>` elements with background-image SVGs and recycles
// them across moves. Mutating that would fight the library and break drag &
// drop. A separate absolutely-positioned layer with `pointer-events: none`
// is invisible to clicks but readable to kids.

import { useMemo } from 'react';
import { computeMoods, type Mood, type PieceMood } from '../lib/pieceMoods';
import type { Color } from 'chess.js';

interface Props {
  fen: string;
  viewerColor: 'white' | 'black';
  /** Board orientation. Equal to viewerColor in normal play. */
  orientation: 'white' | 'black';
}

const MOOD_EMOJI: Record<Mood, string> = {
  hero: 'HERO',
  stressed: 'STRESSED',
  guarding: 'GUARDIAN',
  sleeping: 'SLEEPING',
  calm: '',
};

// Real emojis live in MOOD_GLYPH; MOOD_EMOJI above is the aria label.
const MOOD_GLYPH: Record<Mood, string> = {
  hero: '🦸',
  stressed: '😱',
  guarding: '🛡️',
  sleeping: '💤',
  calm: '',
};

const MOOD_ANIM_CLASS: Record<Mood, string> = {
  hero: 'mood-hero',
  stressed: 'mood-stressed',
  guarding: 'mood-guarding',
  sleeping: 'mood-sleeping',
  calm: '',
};

export default function PieceEmotionsOverlay({ fen, viewerColor, orientation }: Props) {
  const colorCode: Color = viewerColor === 'white' ? 'w' : 'b';
  const moods = useMemo(() => computeMoods(fen, colorCode), [fen, colorCode]);
  const flip = orientation === 'black';

  return (
    <div className="pointer-events-none absolute inset-0 z-20" aria-hidden="true">
      {moods.map((m) => m.mood === 'calm' ? null : (
        <MoodBubble key={m.square} mood={m} flip={flip} />
      ))}
    </div>
  );
}

function MoodBubble({ mood, flip }: { mood: PieceMood; flip: boolean }) {
  const file = mood.square.charCodeAt(0) - 97; // 'a' → 0
  const rank = parseInt(mood.square[1]!, 10) - 1; // '1' → 0
  const colPct = (flip ? 7 - file : file) * 12.5;
  const rowPct = (flip ? rank : 7 - rank) * 12.5;

  // The bubble lives at the TOP-LEFT corner of the square (overhanging it
  // slightly). Top-right is reserved for ClassificationBadge, which we don't
  // want to fight with after a classified move.
  return (
    <div
      className={`absolute select-none ${MOOD_ANIM_CLASS[mood.mood]}`}
      style={{
        left: `calc(${colPct}% - 4px)`,
        top: `calc(${rowPct}% - 4px)`,
        width: 18,
        height: 18,
      }}
      title={MOOD_EMOJI[mood.mood]}
    >
      <span className="mood-glyph">{MOOD_GLYPH[mood.mood]}</span>
    </div>
  );
}
