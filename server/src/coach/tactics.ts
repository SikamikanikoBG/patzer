import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";

// Deterministic tactics for the coach. Everything the coach says about *why*
// a move is good or bad comes from here or from the engine, never from the
// LLM: a small model asked "why is this a blunder?" invents a pin or an
// attack that isn't there, and even a 27B model, given only "the knight goes
// to f6" and "material is equal", called the move that allows Qxf7# "great
// development" (discussion #37). So the server works out what a move hangs,
// what it allows and what it threatens, and hands the LLM those findings.
//
// Everything is language-neutral: pieces are { type, square } and results
// are codes. coaching.ts turns them into sentences in the user's language.

export const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

export interface PieceRef { type: PieceSymbol; square: Square }

const other = (c: Color): Color => (c === "w" ? "b" : "w");

function pieces(chess: Chess, color: Color): PieceRef[] {
  const out: PieceRef[] = [];
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell && cell.color === color) out.push({ type: cell.type, square: cell.square });
    }
  }
  return out;
}

/** Pieces of `color` (never the king) the opponent can win right now: attacked
 *  and either undefended or attacked by something cheaper. */
export function hangingPieces(chess: Chess, color: Color): PieceRef[] {
  const out: PieceRef[] = [];
  for (const p of pieces(chess, color)) {
    if (p.type === "k") continue;
    const attackers = chess.attackers(p.square, other(color));
    if (attackers.length === 0) continue;
    const defenders = chess.attackers(p.square, color);
    const cheapest = Math.min(...attackers.map((sq) => VALUE[chess.get(sq)!.type]));
    if (defenders.length === 0 || cheapest < VALUE[p.type]) out.push(p);
  }
  return out.sort((a, b) => VALUE[b.type] - VALUE[a.type]);
}

/** A mating move for the side to move, in SAN, or null. chess.js already
 *  marks mate with "#" when it writes the SAN, so one move list is enough —
 *  playing each move out and asking isCheckmate() was ~35× slower, and the
 *  coach's memory runs this for every mistake in 30 games. */
export function mateInOne(chess: Chess): string | null {
  return chess.moves().find((san) => san.endsWith("#")) ?? null;
}

/** The same position with the other side to move — "what would they do if it
 *  were their turn?". Null when that position would be illegal (side to move
 *  could capture the king, i.e. the original side is in check). */
function passTurn(chess: Chess): Chess | null {
  if (chess.inCheck()) return null;
  const parts = chess.fen().split(" ");
  parts[1] = parts[1] === "w" ? "b" : "w";
  parts[3] = "-";
  try {
    return new Chess(parts.join(" "));
  } catch {
    return null;
  }
}

export interface MoveMotifs {
  san: string;
  piece: PieceRef;
  mate: boolean;
  check: boolean;
  castles: boolean;
  promotes: boolean;
  /** Minor piece leaving its home square. */
  develops: boolean;
  captured: PieceRef | null;
  /** What the capture actually nets, in pawns, after the cheapest recapture;
   *  null when the move is not a capture. 0 is an even trade, negative loses
   *  material. Deliberately conservative: if the opponent still covers the
   *  square at all, the moved piece is counted as paid for, so an even trade
   *  is never reported as winning material. */
  captureNet: number | null;
  /** Enemy pieces the moved piece attacks that are worth more than it or are
   *  undefended — two or more (or one plus check) is a fork. */
  fork: PieceRef[];
  /** Own pieces hanging after the move that were safe before it. */
  hangs: PieceRef[];
  /** Own pieces that were hanging and are safe after the move. */
  saves: PieceRef[];
  /** Enemy pieces newly hanging after the move. */
  threatens: PieceRef[];
  /** The opponent's mating reply this move allows, in SAN. */
  allowsMate: string | null;
  /** The opponent threatened mate in one and this move stops it. */
  stopsMate: boolean;
  /** After the move, it would be mate in one for us — a mate threat. */
  threatensMate: boolean;
}

/** What a move does, for the side that plays it. Null for an illegal move. */
export function moveMotifs(fenBefore: string, san: string): MoveMotifs | null {
  let before: Chess;
  try {
    before = new Chess(fenBefore);
  } catch {
    return null;
  }
  const me = before.turn();
  const them = other(me);
  const hangingBefore = hangingPieces(before, me);
  const theirHangingBefore = hangingPieces(before, them);
  const passed = passTurn(before);
  const theyThreatenedMate = passed ? mateInOne(passed) !== null : false;

  const after = new Chess(fenBefore);
  let m;
  try {
    m = after.move(san, { strict: false });
  } catch {
    return null;
  }
  if (!m) return null;

  const piece: PieceRef = { type: m.promotion ?? m.piece, square: m.to };
  const home = me === "w" ? "1" : "8";
  const develops = (m.piece === "n" || m.piece === "b") && m.from[1] === home && m.to[1] !== home;

  // Fork: what the moved piece hits from its new square.
  const fork: PieceRef[] = [];
  if (!after.isCheckmate()) {
    for (const p of pieces(after, them)) {
      if (!after.attackers(p.square, me).includes(m.to)) continue;
      const defended = after.attackers(p.square, them).length > 0;
      if (p.type === "k" || VALUE[p.type] > VALUE[piece.type] || !defended) fork.push(p);
    }
  }

  const hangingAfter = hangingPieces(after, me);
  const key = (p: PieceRef) => `${p.type}${p.square}`;
  const wasHanging = new Set(hangingBefore.map(key));
  // A piece that moved counts as newly hanging on its new square unless it
  // was already hanging where it stood.
  const hangs = hangingAfter.filter((p) => !wasHanging.has(key(p)) && !(p.square === m.to && wasHanging.has(`${m.piece}${m.from}`)));
  const stillHanging = new Set(hangingAfter.map((p) => (p.square === m.to ? `${m.piece}${m.from}` : key(p))));
  const saves = hangingBefore.filter((p) => !stillHanging.has(key(p)));

  const theirWasHanging = new Set(theirHangingBefore.map(key));
  const threatens = hangingPieces(after, them).filter((p) => !theirWasHanging.has(key(p)));

  // Captures are not automatically material. Bxc6+ bxc6 and dxc5 Qxc5 are
  // trades, and reporting them as "wins material" put a win that isn't there
  // into the coach's facts, which the model then repeated word for word.
  let captureNet: number | null = null;
  if (m.captured) {
    const recapturers = after.attackers(m.to, them);
    captureNet = VALUE[m.captured] - (recapturers.length ? VALUE[piece.type] : 0);
  }

  const allowsMate = after.isCheckmate() ? null : mateInOne(after);
  const passedAfter = passTurn(after);
  const threatensMate = !after.isGameOver() && passedAfter ? mateInOne(passedAfter) !== null : false;

  return {
    san: m.san,
    piece,
    mate: after.isCheckmate(),
    check: after.inCheck(),
    castles: m.isKingsideCastle() || m.isQueensideCastle(),
    promotes: !!m.promotion,
    develops,
    captured: m.captured ? { type: m.captured, square: m.to } : null,
    captureNet,
    fork: fork.length >= 2 || (fork.length === 1 && after.inCheck() && fork[0]!.type !== "k") ? fork : [],
    hangs,
    saves,
    threatens,
    allowsMate,
    stopsMate: theyThreatenedMate && allowsMate === null,
    threatensMate,
  };
}

export interface PositionFeatures {
  /** Side to move. */
  turn: Color;
  phase: "opening" | "middlegame" | "endgame";
  /** Mate in one for the side to move. */
  mateAvailable: string | null;
  /** The opponent would mate in one if it were their move. */
  mateThreat: boolean;
  /** Our pieces the opponent can win. */
  ourHanging: PieceRef[];
  /** Their pieces we can win. */
  theirHanging: PieceRef[];
  /** Our knights and bishops still on their home squares. */
  undeveloped: PieceRef[];
  /** Whether our king has castled, can still castle, or neither. */
  castling: "done" | "available" | "lost";
  inCheck: boolean;
}

const MINOR_HOMES: Record<Color, Record<string, PieceSymbol>> = {
  w: { b1: "n", g1: "n", c1: "b", f1: "b" },
  b: { b8: "n", g8: "n", c8: "b", f8: "b" },
};

/** What the side to move should know before choosing a move. */
export function positionFeatures(fen: string): PositionFeatures | null {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return null;
  }
  const me = chess.turn();
  const them = other(me);

  let material = 0;
  for (const p of [...pieces(chess, me), ...pieces(chess, them)]) if (p.type !== "k" && p.type !== "p") material += VALUE[p.type];
  const fullmove = Number(fen.split(" ")[5] ?? "1");
  const phase = material <= 26 ? "endgame" : fullmove <= 10 ? "opening" : "middlegame";

  const undeveloped: PieceRef[] = [];
  for (const [sq, type] of Object.entries(MINOR_HOMES[me])) {
    const p = chess.get(sq as Square);
    if (p && p.color === me && p.type === type) undeveloped.push({ type, square: sq as Square });
  }

  const king = pieces(chess, me).find((p) => p.type === "k")!;
  const rights = chess.getCastlingRights(me);
  const castled = me === "w" ? ["g1", "c1", "b1", "h1"].includes(king.square) : ["g8", "c8", "b8", "h8"].includes(king.square);
  const castling = castled ? "done" : rights.k || rights.q ? "available" : "lost";

  const passed = passTurn(chess);
  return {
    turn: me,
    phase,
    mateAvailable: mateInOne(chess),
    mateThreat: passed ? mateInOne(passed) !== null : false,
    ourHanging: hangingPieces(chess, me),
    theirHanging: hangingPieces(chess, them),
    undeveloped: phase === "opening" ? undeveloped : [],
    castling,
    inCheck: chess.inCheck(),
  };
}
