// Living pieces (kid mode) — computes per-square emotional moods from a FEN.
//
// The idea is to turn the board into something a 7-10 year old can read at a
// glance, instead of having to evaluate every threat square by square.
// Each piece can be in one of these states (priority high → low):
//
//   - hero      : can capture something worth more, give check, or mate
//   - stressed  : under attack and either undefended or losing the exchange
//                 (kings are stressed when in check)
//   - guarding  : currently defending a friendly piece that is itself attacked
//   - sleeping  : minor piece / rook still on its starting square mid-game
//   - calm      : default — no overlay (avoids visual clutter)
//
// Only the viewer's own pieces get moods. The opponent's pieces are left
// alone — kid focus is "what are MY pieces feeling".

import { Chess, type Square, type Color } from 'chess.js';

export type Mood = 'hero' | 'stressed' | 'guarding' | 'sleeping' | 'calm';

export interface PieceMood {
  square: Square;
  piece: 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
  color: Color;
  mood: Mood;
}

const VALUE: Record<'p' | 'n' | 'b' | 'r' | 'q' | 'k', number> = {
  p: 1, n: 3, b: 3, r: 5, q: 9, k: 100,
};

const WHITE_HOME: Partial<Record<Square, 'p' | 'n' | 'b' | 'r' | 'q' | 'k'>> = {
  b1: 'n', g1: 'n', c1: 'b', f1: 'b', a1: 'r', h1: 'r',
};
const BLACK_HOME: Partial<Record<Square, 'p' | 'n' | 'b' | 'r' | 'q' | 'k'>> = {
  b8: 'n', g8: 'n', c8: 'b', f8: 'b', a8: 'r', h8: 'r',
};

function isOnHomeSquare(sq: Square, piece: 'p' | 'n' | 'b' | 'r' | 'q' | 'k', color: Color): boolean {
  const map = color === 'w' ? WHITE_HOME : BLACK_HOME;
  return map[sq] === piece;
}

// Compute the cheapest attacker value among the given attacker squares.
// Used to decide whether a piece is "losing the exchange" when attacked.
function cheapestValue(chess: Chess, squares: Square[]): number {
  let min = Infinity;
  for (const s of squares) {
    const p = chess.get(s);
    if (!p) continue;
    const v = VALUE[p.type];
    if (v < min) min = v;
  }
  return min;
}

/**
 * Returns moods for all pieces of `viewerColor` on the position. Pieces with
 * mood='calm' are still included so callers can render nothing for them
 * without having to remember which ones existed.
 */
export function computeMoods(fen: string, viewerColor: Color): PieceMood[] {
  const chess = new Chess();
  try { chess.load(fen); } catch { return []; }

  const result: PieceMood[] = [];
  const board = chess.board();
  const fullmove = Number(fen.split(' ')[5] ?? '1') || 1;
  const turn = chess.turn();
  const inCheck = chess.inCheck();
  const opp: Color = viewerColor === 'w' ? 'b' : 'w';

  // Hero detection needs to enumerate moves from the viewer's pieces. chess.js
  // only lists moves for the side to move, so if it's not the viewer's turn we
  // swap turns into a cloned position. The clone keeps the original board
  // unchanged for the rest of the inspection.
  let moveProbe = chess;
  if (turn !== viewerColor) {
    const parts = fen.split(' ');
    parts[1] = viewerColor;
    // Reset en-passant + halfmove on the hypothetical move so chess.js accepts it.
    parts[3] = '-';
    parts[4] = '0';
    const probe = new Chess();
    try { probe.load(parts.join(' ')); moveProbe = probe; }
    catch { moveProbe = chess; /* fall back; hero will under-report which is fine */ }
  }

  // Pre-compute heroic squares: from each viewer-piece square, do any of its
  // legal moves capture a higher-value piece, give check, or give mate?
  const heroSquares = new Set<Square>();
  for (const row of board) {
    for (const sq of row) {
      if (!sq) continue;
      if (sq.color !== viewerColor) continue;
      const fromSquare = sq.square;
      const fromValue = VALUE[sq.type];
      let moves: { from: Square; to: Square; captured?: 'p' | 'n' | 'b' | 'r' | 'q'; san: string }[];
      try {
        moves = moveProbe.moves({ verbose: true, square: fromSquare }) as never;
      } catch { moves = []; }
      for (const m of moves) {
        // Captures of higher value: easy win — hero.
        if (m.captured && VALUE[m.captured] > fromValue) { heroSquares.add(fromSquare); break; }
        // Check or mate: also hero (kid sees the danger to opponent).
        if (m.san.endsWith('+') || m.san.endsWith('#')) { heroSquares.add(fromSquare); break; }
      }
    }
  }

  for (const row of board) {
    for (const sq of row) {
      if (!sq) continue;
      if (sq.color !== viewerColor) continue;

      const square = sq.square;
      const piece = sq.type;
      let mood: Mood = 'calm';

      // KING — stressed = in check (only when it's the king's side to move).
      // We deliberately keep king mood simple so kids learn "king flashes ==
      // run away or block".
      if (piece === 'k') {
        if (inCheck && turn === viewerColor) mood = 'stressed';
        else if (heroSquares.has(square)) mood = 'hero';
        result.push({ square, piece, color: viewerColor, mood });
        continue;
      }

      const oppAttackers = chess.attackers(square, opp);
      const myDefenders = chess.attackers(square, viewerColor).filter((s) => s !== square);

      // 1. HERO — strongest signal, wins over stressed (an attacking piece that
      // can also capture something bigger is a hero first, stress second).
      if (heroSquares.has(square)) {
        mood = 'hero';
        result.push({ square, piece, color: viewerColor, mood });
        continue;
      }

      // 2. STRESSED — attacked AND (undefended OR cheaper attacker = losing
      // exchange). Pawns count too: a pawn under attack by another pawn with
      // no defender is stressed.
      if (oppAttackers.length > 0) {
        const cheapestAtk = cheapestValue(chess, oppAttackers);
        const undefended = myDefenders.length === 0;
        const losingExchange = cheapestAtk < VALUE[piece];
        if (undefended || losingExchange) {
          mood = 'stressed';
          result.push({ square, piece, color: viewerColor, mood });
          continue;
        }
      }

      // 3. GUARDING — defends ≥1 friendly piece that's itself currently
      // attacked. Pure "defends pieces that aren't actually in danger" doesn't
      // qualify — otherwise every back-rank rook in the opening would be a
      // guard.
      let isGuarding = false;
      for (const row2 of board) {
        for (const friend of row2) {
          if (!friend || friend.color !== viewerColor) continue;
          if (friend.square === square) continue;
          // Is `friend` attacked AND does `square` appear in its defenders?
          const friendAttackers = chess.attackers(friend.square, opp);
          if (friendAttackers.length === 0) continue;
          const friendDefenders = chess.attackers(friend.square, viewerColor);
          if (friendDefenders.includes(square)) { isGuarding = true; break; }
        }
        if (isGuarding) break;
      }
      if (isGuarding) {
        mood = 'guarding';
        result.push({ square, piece, color: viewerColor, mood });
        continue;
      }

      // 4. SLEEPING — minor / rook still on its starting square mid-game (the
      // fullmove gate keeps the opening from being plastered with Zzz). Pawns
      // and kings deliberately excluded: pawns all start asleep (noisy) and
      // the king is always "alert".
      if (
        (piece === 'n' || piece === 'b' || piece === 'r')
        && isOnHomeSquare(square, piece, viewerColor)
        && fullmove >= 3
        && oppAttackers.length === 0
      ) {
        mood = 'sleeping';
      }

      result.push({ square, piece, color: viewerColor, mood });
    }
  }

  return result;
}
