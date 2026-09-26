// The rules of the Learn section's tasks, kept free of React so that
// content.test.ts can run every lesson through exactly the code the page uses.

import { Chess, type Move, type Square } from 'chess.js';
import type { MoveStep, PlayStep, Side, Sq, StarsStep } from './types';

// ---- Positions -------------------------------------------------------------

/** The early lessons use boards without kings ("a rook on an empty board"),
 *  which chess.js only accepts with validation off. Its move generator copes
 *  fine: with no king there is simply nothing that can be in check. */
export function board(fen: string): Chess {
  return new Chess(fen, { skipValidation: true });
}

export function sideToMove(fen: string): Side {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white';
}

/** The same position with `side` to move. Drops the en-passant square, which
 *  only ever belongs to the move right after a double step. */
export function withTurn(fen: string, side: Side): string {
  const parts = fen.split(' ');
  parts[1] = side === 'white' ? 'w' : 'b';
  parts[3] = '-';
  return parts.join(' ');
}

export function parseUci(uci: string): { from: Sq; to: Sq; promotion?: string } {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci.slice(4) : undefined };
}

/** Play a move given in UCI ("e2e4", "e7e8q"); null when it is illegal. */
export function play(fen: string, uci: string): { fen: string; move: Move } | null {
  const chess = board(fen);
  try {
    const move = chess.move(parseUci(uci));
    return { fen: chess.fen(), move };
  } catch {
    return null;
  }
}

/** One move of an explanation's demo. A demo may move the same side twice
 *  ("the rook goes here, then there"), so whoever owns the piece moves it —
 *  keeping the position as it is when it's their turn anyway, which keeps an
 *  en-passant square alive. */
export function demoMove(fen: string, uci: string): { fen: string; move: Move } | null {
  const owner = board(fen).get(uci.slice(0, 2) as Square);
  if (!owner) return null;
  const side: Side = owner.color === 'w' ? 'white' : 'black';
  return play(sideToMove(fen) === side ? fen : withTurn(fen, side), uci);
}

export function legalMoves(fen: string): Move[] {
  return board(fen).moves({ verbose: true });
}

/** Legal moves as the from → [to] map a board needs, optionally for one piece.
 *  Castling can also be dropped on the rook — many players try it that way. */
export function legalDests(fen: string, only?: Sq): Map<Sq, Sq[]> {
  const map = new Map<Sq, Sq[]>();
  const add = (from: Sq, to: Sq) => {
    const list = map.get(from) ?? [];
    if (!list.includes(to)) list.push(to);
    map.set(from, list);
  };
  for (const m of legalMoves(fen)) {
    if (only && m.from !== only) continue;
    add(m.from, m.to);
    if (m.flags.includes('k')) add(m.from, `h${m.from[1]}`);
    if (m.flags.includes('q')) add(m.from, `a${m.from[1]}`);
  }
  return map;
}

/** A king dropped on its own rook means castling: turn it into the king's
 *  real move (e1h1 → e1g1). Any other move is returned as it is. */
export function castleByRook(fen: string, uci: string): string {
  const chess = board(fen);
  const from = chess.get(uci.slice(0, 2) as Square);
  const to = chess.get(uci.slice(2, 4) as Square);
  if (from?.type !== 'k' || to?.type !== 'r' || to.color !== from.color) return uci;
  return uci.slice(0, 2) + (uci[2] === 'h' ? 'g' : 'c') + uci[3];
}

export function uciOf(m: Pick<Move, 'from' | 'to' | 'promotion'>): string {
  return m.from + m.to + (m.promotion ?? '');
}

export function isCheckmate(fen: string): boolean { return board(fen).isCheckmate(); }
export function isStalemate(fen: string): boolean { return board(fen).isStalemate(); }
export function inCheck(fen: string): boolean { return board(fen).inCheck(); }

/** Where the king of the side to move stands when it is in check. */
export function checkedKing(fen: string): Sq | null {
  const chess = board(fen);
  if (!chess.inCheck()) return null;
  const color = chess.turn();
  for (const row of chess.board()) {
    for (const p of row) if (p && p.type === 'k' && p.color === color) return p.square;
  }
  return null;
}

/** The pieces of one side, square → piece letter. */
export function piecesOf(fen: string, side: Side): Map<Sq, string> {
  const color = side === 'white' ? 'w' : 'b';
  const out = new Map<Sq, string>();
  for (const row of board(fen).board()) {
    for (const p of row) if (p && p.color === color) out.set(p.square, p.type);
  }
  return out;
}

// ---- Stars -----------------------------------------------------------------
//
// One piece walks the board collecting stars; the other side never moves.
// The mover keeps the turn, and captures are only allowed onto a star, so a
// black pawn that is not a star is simply in the way.

export interface StarsState {
  fen: string;
  /** Where the moving piece stands now. */
  at: Sq;
  left: Sq[];
  moves: number;
}

export function starsStart(step: StarsStep): StarsState {
  const side = sideToMove(step.fen);
  const at = step.piece ?? [...piecesOf(step.fen, side).keys()][0]!;
  return { fen: step.fen, at, left: [...step.stars], moves: 0 };
}

function starMoves(state: StarsState): Move[] {
  const chess = board(state.fen);
  return chess.moves({ square: state.at as Square, verbose: true }).filter((m) =>
    // A pawn reaching the last rank would need a promotion — not part of
    // these tasks, and content.test.ts keeps stars off those squares.
    !m.promotion && (!m.captured || state.left.includes(m.to)));
}

export function starsDests(state: StarsState): Map<Sq, Sq[]> {
  const to = [...new Set(starMoves(state).map((m) => m.to as Sq))];
  return new Map(to.length ? [[state.at, to]] : []);
}

export function starsMove(state: StarsState, uci: string): StarsState | null {
  const { from, to } = parseUci(uci);
  if (from !== state.at) return null;
  const move = starMoves(state).find((m) => m.to === to);
  if (!move) return null;
  const chess = board(state.fen);
  chess.move({ from: move.from, to: move.to });
  return {
    fen: withTurn(chess.fen(), sideToMove(state.fen)),
    at: to,
    left: state.left.filter((s) => s !== to),
    moves: state.moves + 1,
  };
}

/** Every position one move away, from a single board: the search below
 *  visits thousands of nodes, and rebuilding the board and regenerating the
 *  moves for each child (as starsMove does) kept a phone busy for seconds.
 *  Plain moves and captures just lift the piece and set it down; anything
 *  special (castling, en passant, a double pawn step) goes through starsMove. */
function starsChildren(state: StarsState): { uci: string; next: StarsState }[] {
  const side = sideToMove(state.fen);
  const chess = board(state.fen);
  const out: { uci: string; next: StarsState }[] = [];
  const done = new Set<string>();
  for (const m of starMoves(state)) {
    if (done.has(m.to)) continue;
    done.add(m.to);
    const uci = state.at + m.to;
    let fen: string;
    if (m.flags === 'n' || m.flags === 'c') {
      const piece = chess.remove(m.from)!;
      const taken = chess.remove(m.to);
      chess.put(piece, m.to);
      fen = withTurn(chess.fen(), side);
      chess.remove(m.to);
      chess.put(piece, m.from);
      if (taken) chess.put(taken, m.to);
    } else {
      fen = starsMove(state, uci)!.fen;
    }
    out.push({ uci, next: { fen, at: m.to as Sq, left: state.left.filter((s) => s !== m.to), moves: state.moves + 1 } });
  }
  return out;
}

/** Breadth-first search for the fewest moves that collect every star left:
 *  how many, and the first move of such a path (the hint). null = impossible. */
export function shortestStars(state: StarsState): { moves: number; first: string | null } | null {
  if (!state.left.length) return { moves: 0, first: null };
  const key = (s: StarsState) => `${s.at}|${[...s.left].sort().join(',')}`;
  const seen = new Set([key(state)]);
  let frontier: { s: StarsState; first: string }[] = [];
  for (const { uci, next: n } of starsChildren(state)) {
    if (!n.left.length) return { moves: 1, first: uci };
    if (!seen.has(key(n))) { seen.add(key(n)); frontier.push({ s: n, first: uci }); }
  }
  for (let depth = 2; frontier.length && depth <= 40; depth++) {
    const next: typeof frontier = [];
    for (const { s, first } of frontier) {
      for (const { next: n } of starsChildren(s)) {
        if (!n.left.length) return { moves: depth, first };
        const k = key(n);
        if (!seen.has(k)) { seen.add(k); next.push({ s: n, first }); }
      }
    }
    frontier = next;
  }
  return null;
}

/** Fewest moves that collect every star, or null when it can't be done. */
export function solveStars(step: StarsStep): number | null {
  return shortestStars(starsStart(step))?.moves ?? null;
}

// ---- Find the move -----------------------------------------------------------

/** The position the player sees first: after the opponent's `pre` move. */
export function moveStepStart(step: MoveStep): { fen: string; lastMove?: [Sq, Sq] } {
  if (!step.pre) return { fen: step.fen };
  const r = play(step.fen, step.pre)!;
  return { fen: r.fen, lastMove: [r.move.from, r.move.to] };
}

/** Is `uci`, played in `fen` at line index `index`, a right answer? */
export function isRightMove(step: MoveStep, index: number, fen: string, uci: string): boolean {
  const r = play(fen, uci);
  if (!r) return false;
  const goal = step.goal ?? 'line';
  if (goal === 'check') return r.move.san.includes('+') || r.move.san.includes('#');
  if (goal === 'mate' && board(r.fen).isCheckmate()) return true;
  if (uci === step.line[index]) return true;
  return index === 0 && !!step.accept?.includes(uci);
}

/** After a right move: is the task solved, or does the line go on? A mate
 *  always ends it — Lichess counts any mate as the solution, and so do we. */
export function moveStepDone(step: MoveStep, index: number, fenAfter: string): boolean {
  if ((step.goal ?? 'line') === 'check') return true;
  if (board(fenAfter).isCheckmate()) return true;
  return index + 1 >= step.line.length;
}

// ---- Play it out ------------------------------------------------------------

export type PlayResult = 'won' | 'stalemate' | 'draw' | 'lost' | 'limit';

/** Judge the position after the player's move. null = keep playing. */
export function judgeOwnMove(step: PlayStep, chess: Chess, move: Move, ownMoves: number): PlayResult | null {
  if (chess.isCheckmate()) return 'won';
  if (chess.isStalemate()) return 'stalemate';
  if (chess.isDraw()) return 'draw';
  if (step.goal === 'promote' && move.promotion) {
    // Promoted — but a queen that is taken at once was never really won.
    const taken = chess.moves({ verbose: true }).some((m) => m.to === move.to);
    if (!taken) return 'won';
  }
  if (ownMoves >= step.limit) return 'limit';
  return null;
}

/** Judge the position after the engine's reply. In these endgames every
 *  piece counts: losing one means the win is gone. */
export function judgeReply(chess: Chess, move: Move): PlayResult | null {
  // A piece you can take back at once was traded, not lost (a rook swap in
  // the Lucena still wins); only a piece gone for nothing ends the try.
  if (move.captured && !chess.moves({ verbose: true }).some((m) => m.to === move.to)) return 'lost';
  if (chess.isDraw()) return 'draw';
  return null;
}

/** Why a legal but wrong move in a "find the move" task is wrong, when the
 *  position can tell: it stalemates, it's only check where mate was asked,
 *  or it gives no check where check was asked. null = no special reason. */
export function wrongReason(step: MoveStep, fen: string, uci: string): 'stalemate' | 'onlyCheck' | 'noCheck' | null {
  const r = play(fen, uci);
  if (!r) return null;
  const after = board(r.fen);
  if (after.isStalemate()) return 'stalemate';
  const goal = step.goal ?? 'line';
  if (goal === 'mate' && after.inCheck()) return 'onlyCheck';
  if (goal === 'check' && !after.inCheck()) return 'noCheck';
  return null;
}

// ---- Rewards -----------------------------------------------------------------

/** 3 stars without a single slip (a mistake, a hint or the solution), 2 with
 *  a few, 1 for getting through. */
export function lessonStars(tasks: number, flawed: number): 1 | 2 | 3 {
  if (flawed <= 0) return 3;
  if (flawed <= Math.max(1, Math.floor(tasks / 3))) return 2;
  return 1;
}

/** Levels come from the stars you hold: level 2 at 5 stars, and each further
 *  level asks for two more stars than the one before (5, 7, 9, …). */
export function levelOf(stars: number): { level: number; floor: number; next: number } {
  let level = 1;
  let floor = 0;
  let step = 5;
  while (stars >= floor + step) {
    floor += step;
    level += 1;
    step += 2;
  }
  return { level, floor, next: floor + step };
}

/** The piece that stands for a level: pawn, knight, bishop, rook, queen, king. */
export function levelPiece(level: number): 'p' | 'n' | 'b' | 'r' | 'q' | 'k' {
  const pieces = ['p', 'p', 'n', 'n', 'b', 'b', 'r', 'r', 'q', 'q'] as const;
  return pieces[level - 1] ?? 'k';
}
