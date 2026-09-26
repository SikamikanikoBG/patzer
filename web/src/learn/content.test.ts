// Every lesson, checked move by move. A lesson that teaches a wrong move is
// the worst bug this section can have, so nothing here trusts the content
// files: each position is loaded, each move is played, each "checkmate" is
// verified to be one, and each star task is solved again from scratch.
//
// What this can't judge — "is this the best move?" in a tactic — is checked
// with Stockfish when a lesson is written (the Lichess puzzles come with that
// check built in; see the lesson notes in CONTRIBUTING).

import { describe, expect, it } from 'vitest';
import { Chess, validateFen, type Square } from 'chess.js';
import basics from './content/basics.json';
import beginner from './content/beginner.json';
import intermediate from './content/intermediate.json';
import advanced from './content/advanced.json';
import en from '../locales/learn/en.json';
import { buildCurriculum, LEVEL_IDS } from './content';
import {
  board, demoMove, isRightMove, legalDests, legalMoves, moveStepDone, moveStepStart, play, piecesOf, sideToMove,
  solveStars, starsStart, uciOf, withTurn,
} from './engine';
import { isKnownIcon } from '../components/learn/LessonIcon';
import type { LevelDef, MoveStep, StepDef } from './types';

const levels = [basics, beginner, intermediate, advanced] as unknown as LevelDef[];
const cur = buildCurriculum(levels);
const texts = en as unknown as Record<string, Record<string, unknown>>;

const SQUARE = /^[a-h][1-8]$/;
const BRUSHES = new Set(['green', 'red', 'blue', 'yellow', 'paleBlue', 'paleGreen', 'paleRed', 'paleGrey']);

function strictFen(fen: string) {
  expect(validateFen(fen).ok, `${fen}: ${validateFen(fen).error ?? ''}`).toBe(true);
}

function text(lesson: string, key: string): unknown {
  return texts[lesson]?.[key];
}

const allSteps = cur.lessons.flatMap((r) => r.lesson.steps.map((step) => ({ lesson: r.lesson.id, step })));
const ofType = <T extends StepDef['type']>(type: T) =>
  allSteps.filter((s) => s.step.type === type) as { lesson: string; step: Extract<StepDef, { type: T }> }[];
const label = (s: { lesson: string; step: StepDef }) => `${s.lesson}.${s.step.id}`;

describe('curriculum', () => {
  it('has the four levels in order', () => {
    expect(levels.map((l) => l.id)).toEqual([...LEVEL_IDS]);
  });

  it('uses unique ids the server accepts', () => {
    const lessonIds = cur.lessons.map((r) => r.lesson.id);
    expect(new Set(lessonIds).size).toBe(lessonIds.length);
    const courseIds = [...cur.courseById.keys()];
    expect(new Set(courseIds).size).toBe(levels.flatMap((l) => l.courses).length);
    for (const id of lessonIds) {
      // Same rule as server/src/learnProgress.ts (LESSON_ID, 40 chars).
      expect(id, id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(id.length, id).toBeLessThanOrEqual(40);
      // Lesson texts share the top level of the text file with "courses".
      expect(id).not.toBe('courses');
    }
    for (const r of cur.lessons) {
      const ids = r.lesson.steps.map((s) => s.id);
      expect(new Set(ids).size, r.lesson.id).toBe(ids.length);
      expect(r.lesson.steps.length, r.lesson.id).toBeLessThanOrEqual(60);
      expect(r.lesson.steps.some((s) => s.type !== 'info'), `${r.lesson.id} has no task`).toBe(true);
      for (const id of ids) expect(id, `${r.lesson.id}.${id}`).toMatch(/^[a-z0-9]+$/);
    }
  });

  it('only uses icons the page can draw', () => {
    for (const level of levels) {
      for (const course of level.courses) {
        expect(isKnownIcon(course.icon), course.id).toBe(true);
        for (const lesson of course.lessons) expect(isKnownIcon(lesson.icon), lesson.id).toBe(true);
      }
    }
  });

  it('links only to opening-trainer lines that exist', () => {
    // TRAINER_LINES ids (server/src/chess/openingTrainer.ts).
    const lines = new Set(['italian', 'ruy-lopez', 'scotch', 'queens-gambit', 'london', 'alapin', 'english',
      'najdorf', 'french-advance', 'caro-kann', 'scandinavian', 'two-knights', 'berlin', 'kings-indian', 'slav', 'nimzo-indian']);
    for (const r of cur.lessons) if (r.lesson.trainer) expect(lines.has(r.lesson.trainer), r.lesson.id).toBe(true);
  });
});

describe('lesson texts (en)', () => {
  it('has a title and description for every course and lesson', () => {
    const courses = texts.courses as Record<string, { title?: string; desc?: string }>;
    for (const id of cur.courseById.keys()) {
      expect(courses[id]?.title, id).toBeTruthy();
      expect(courses[id]?.desc, id).toBeTruthy();
    }
    for (const r of cur.lessons) {
      expect(text(r.lesson.id, 'title'), r.lesson.id).toBeTruthy();
      expect(text(r.lesson.id, 'desc'), r.lesson.id).toBeTruthy();
    }
  });

  it('has the words for every step', () => {
    for (const s of allSteps) {
      const { lesson, step } = s;
      if (step.type === 'move' && step.src && !text(lesson, step.id)) {
        // Puzzles from the database share the lesson's task text.
        expect(text(lesson, 'task'), label(s)).toBeTruthy();
      } else {
        expect(text(lesson, step.id), label(s)).toBeTruthy();
      }
      if (step.type === 'quiz') {
        for (const opt of step.options) expect(text(lesson, `${step.id}_${opt}`), `${label(s)}_${opt}`).toBeTruthy();
        expect(text(lesson, `${step.id}_done`), `${label(s)}_done`).toBeTruthy();
      }
    }
  });

  it('has no leftover keys (a typo would silently never show)', () => {
    for (const [lesson, entries] of Object.entries(texts)) {
      if (lesson === 'courses') {
        for (const id of Object.keys(entries)) expect(cur.courseById.has(id), `courses.${id}`).toBe(true);
        continue;
      }
      const ref = cur.byId.get(lesson);
      expect(ref, `text for unknown lesson ${lesson}`).toBeDefined();
      const known = new Set(['title', 'desc', 'task']);
      for (const step of ref!.lesson.steps) {
        known.add(step.id);
        known.add(`${step.id}_done`);
        if (step.type === 'quiz') for (const opt of step.options) known.add(`${step.id}_${opt}`);
      }
      for (const key of Object.keys(entries)) {
        const base = key.endsWith('_kid') ? key.slice(0, -4) : key;
        expect(known.has(base), `${lesson}.${key}`).toBe(true);
        if (key !== base) expect(entries[base], `${lesson}.${key} without ${base}`).toBeTruthy();
      }
    }
  });

  it('only interpolates what the page provides', () => {
    for (const [lesson, entries] of Object.entries(texts)) {
      if (lesson === 'courses') continue;
      for (const [key, value] of Object.entries(entries)) {
        for (const m of String(value).match(/{{\s*(\w+)\s*}}/g) ?? []) expect(m, `${lesson}.${key}`).toBe('{{side}}');
      }
    }
  });
});

describe('boards', () => {
  it('parses every position', () => {
    for (const s of allSteps) {
      if (s.step.fen) expect(() => board(s.step.fen!), label(s)).not.toThrow();
    }
  });

  it('draws only real squares and brushes', () => {
    for (const s of allSteps) {
      for (const spec of [...(s.step.arrows ?? []), ...(s.step.marks ?? [])]) {
        const [sq, brush] = spec.split(':');
        expect(sq!.length === 2 || sq!.length === 4, `${label(s)} ${spec}`).toBe(true);
        expect(sq!.slice(0, 2), label(s)).toMatch(SQUARE);
        if (sq!.length === 4) expect(sq!.slice(2), label(s)).toMatch(SQUARE);
        if (brush) expect(BRUSHES.has(brush), `${label(s)} ${spec}`).toBe(true);
      }
    }
  });

  it('only demonstrates legal moves', () => {
    for (const s of ofType('info')) {
      let fen = s.step.fen!;
      for (const uci of s.step.demo ?? []) {
        const r = demoMove(fen, uci);
        expect(r, `${label(s)} ${uci}`).not.toBeNull();
        fen = r!.fen;
      }
    }
  });
});

describe('star tasks', () => {
  it('can be solved, and par is the true minimum', () => {
    for (const s of ofType('stars')) {
      const { step } = s;
      const side = sideToMove(step.fen);
      const own = piecesOf(step.fen, side);
      if (step.piece) expect(own.has(step.piece), label(s)).toBe(true);
      else expect(own.size, `${label(s)}: say which piece moves`).toBe(1);
      const start = starsStart(step);
      for (const star of step.stars) {
        expect(star, label(s)).toMatch(SQUARE);
        expect(own.has(star), `${label(s)} star on own piece ${star}`).toBe(false);
        if (own.get(start.at) === 'p') expect(['1', '8'].includes(star[1]!), `${label(s)} star needs a promotion`).toBe(false);
      }
      expect(solveStars(step), label(s)).toBe(step.par);
    }
    // A full search per task: a few seconds in a busy parallel run.
  }, 30_000);
});

describe('square tasks', () => {
  it('asks for real squares, and "where can it go" matches the rules', () => {
    for (const s of ofType('square')) {
      const { step } = s;
      expect(step.answer.length, label(s)).toBeGreaterThan(0);
      expect(new Set(step.answer).size, label(s)).toBe(step.answer.length);
      for (const sq of step.answer) expect(sq, label(s)).toMatch(SQUARE);
      if (step.movesOf) {
        const fen = step.fen!;
        const owner = board(fen).get(step.movesOf as Square);
        expect(owner, label(s)).toBeTruthy();
        const turnFen = withTurn(fen, owner!.color === 'w' ? 'white' : 'black');
        const dests = legalDests(turnFen, step.movesOf).get(step.movesOf) ?? [];
        expect([...step.answer].sort(), label(s)).toEqual([...dests].sort());
      }
    }
  });
});

describe('quizzes', () => {
  it('have their answer among the options', () => {
    for (const s of ofType('quiz')) {
      expect(new Set(s.step.options).size, label(s)).toBe(s.step.options.length);
      expect(s.step.options.includes(s.step.answer), label(s)).toBe(true);
      for (const opt of s.step.options) expect(opt, label(s)).toMatch(/^[a-z0-9]+$/);
    }
  });
});

/** Replays a move task the way the page does; returns the final position. */
function replay(step: MoveStep, name: string): string {
  let fen = moveStepStart(step).fen;
  step.line.forEach((uci, i) => {
    const r = play(fen, uci);
    expect(r, `${name}: move ${i + 1} (${uci}) is illegal`).not.toBeNull();
    if (i % 2 === 0) {
      expect(isRightMove(step, i, fen, uci), `${name}: move ${i + 1}`).toBe(true);
      const last = i === step.line.length - 1;
      // The page ends the task after a mate or after the last move — and
      // only then; a line that goes on after mate would never be reached.
      expect(moveStepDone(step, i, r!.fen), `${name}: move ${i + 1} ends the task ${last ? 'too late' : 'too early'}`).toBe(last);
    }
    fen = r!.fen;
  });
  return fen;
}

describe('move tasks', () => {
  it('are real positions whose lines are legal and end with your move', () => {
    for (const s of ofType('move')) {
      const { step } = s;
      strictFen(step.fen);
      if (step.pre) expect(play(step.fen, step.pre), `${label(s)} pre`).not.toBeNull();
      expect(step.line.length % 2, `${label(s)} must end with your move`).toBe(1);
      replay(step, label(s));
    }
  });

  it('really mate when they say so', () => {
    for (const s of ofType('move').filter((x) => x.step.goal === 'mate')) {
      const end = replay(s.step, label(s));
      expect(new Chess(end).isCheckmate(), label(s)).toBe(true);
    }
  });

  it('really check when they say so', () => {
    for (const s of ofType('move').filter((x) => x.step.goal === 'check')) {
      expect(s.step.line.length, label(s)).toBe(1);
      const r = play(moveStepStart(s.step).fen, s.step.line[0]!)!;
      expect(new Chess(r.fen).inCheck(), label(s)).toBe(true);
    }
  });

  it('accept only legal alternatives, and "exact" lists every legal move', () => {
    for (const s of ofType('move').filter((x) => x.step.accept || x.step.exact)) {
      const { step } = s;
      const start = moveStepStart(step).fen;
      if (step.accept) expect(step.line.length, `${label(s)}: alternatives only for one-move tasks`).toBe(1);
      const right = [step.line[0]!, ...(step.accept ?? [])];
      for (const uci of right) expect(isRightMove(step, 0, start, uci), `${label(s)} ${uci}`).toBe(true);
      if (step.exact) expect(legalMoves(start).map(uciOf).sort(), label(s)).toEqual([...right].sort());
    }
  });
});

describe('play-it-out tasks', () => {
  it('start from real positions', () => {
    for (const s of ofType('play')) {
      strictFen(s.step.fen);
      const chess = new Chess(s.step.fen);
      expect(chess.isGameOver(), label(s)).toBe(false);
      expect(s.step.limit, label(s)).toBeGreaterThan(0);
      if (s.step.goal === 'promote') {
        expect([...piecesOf(s.step.fen, sideToMove(s.step.fen)).values()].includes('p'), label(s)).toBe(true);
      }
    }
  });
});

// What the explanations claim about their own boards.
describe('the explanations tell the truth', () => {
  const find = (lesson: string, id: string) => {
    const step = cur.byId.get(lesson)?.lesson.steps.find((s) => s.id === id);
    expect(step, `${lesson}.${id}`).toBeDefined();
    return step!;
  };
  const chess = (fen: string) => new Chess(fen, { skipValidation: true });

  it('basics', () => {
    // The board lies with a light square bottom right.
    expect(new Chess().squareColor('h1')).toBe('light');
    // Bishops stay on their colour.
    expect(new Chess().squareColor('d4')).toBe('dark');
    expect(new Chess().squareColor('f1')).toBe('light');
    // Checkmate: the example, and "no mate — h7 is free".
    expect(chess(find('checkmate', 'intro').fen!).isCheckmate()).toBe(true);
    const q1 = chess(find('checkmate', 'q1').fen!);
    expect(q1.inCheck() && !q1.isCheckmate()).toBe(true);
    expect(q1.moves({ verbose: true }).map((m) => m.to)).toContain('h7');
    expect(chess(find('checkmate', 'q2').fen!).isCheckmate()).toBe(true);
    // Draws.
    expect(chess(find('draw', 'stalemate').fen!).isStalemate()).toBe(true);
    expect(chess(find('draw', 'q1').fen!).isStalemate()).toBe(true);
    expect(chess(find('draw', 'q2').fen!).isCheckmate()).toBe(true);
    expect(chess(find('draw', 'other').fen!).isInsufficientMaterial()).toBe(true);
    // "Many moves here would be stalemate" — Qc7 among them.
    const avoid = find('draw', 'avoid') as MoveStep;
    const qc7 = play(avoid.fen, 'c1c7')!;
    expect(chess(qc7.fen).isStalemate()).toBe(true);
    // Castling: not allowed because f1 is attacked, not for any other reason.
    const why = chess(find('castling', 'why').fen!);
    expect(why.moves({ verbose: true }).some((m) => m.flags.includes('k'))).toBe(false);
    expect(why.inCheck()).toBe(false);
    expect(why.isAttacked('f1', 'b')).toBe(true);
    expect(why.get('f1') || why.get('g1')).toBeFalsy();
    // En passant is en passant, and only right after the double step.
    for (const id of ['ep1', 'ep2']) {
      const step = find('en-passant', id) as MoveStep;
      const start = moveStepStart(step).fen;
      const move = chess(start).moves({ verbose: true }).find((m) => uciOf(m) === step.line[0]);
      expect(move?.flags, id).toContain('e');
    }
    expect(chess(find('en-passant', 'when').fen!).moves({ verbose: true }).some((m) => m.flags.includes('e'))).toBe(false);
    // "Capture the unprotected one": the bishop is defended by the e6 pawn.
    const safe = chess((find('capture', 'safe') as MoveStep).fen);
    expect(safe.isAttacked('d5', 'b')).toBe(true);
    expect(safe.isAttacked('g4', 'b')).toBe(false);
    // Promotion to a queen, as asked.
    expect((find('promotion', 'queen') as MoveStep).line[0]).toMatch(/q$/);
    // Reading moves: the demos spell the moves the text names, and Qxf7# is mate.
    const notation = find('notation', 'intro');
    expect(notation.type === 'info' && notation.demo).toEqual(['e2e4', 'e7e5', 'g1f3']);
    const nxe5 = chess(find('notation', 'q1').fen!);
    expect(nxe5.move('Nxe5').captured).toBe('p');
    const qxf7 = chess(find('notation', 'q2').fen!);
    expect(qxf7.isCheckmate()).toBe(true);
    expect(qxf7.isAttacked('f7', 'w')).toBe(true);
    expect(chess(find('notation', 'target').fen!).moves({ verbose: true }).some((m) => m.san === 'Nc3')).toBe(true);
    expect((find('notation', 'play') as MoveStep).line).toEqual(['g1f3']);
  });

  it('beginner', () => {
    const after = (fen: string, ...moves: string[]) => {
      let cur = fen;
      for (const m of moves) cur = demoMove(cur, m)!.fen;
      return chess(cur);
    };
    const destsOf = (fen: string, sq: string) => chess(fen).moves({ square: sq as Square, verbose: true }).map((m) => m.to);
    expect(after(find('mate-in-one', 'intro').fen!, 'h1h8').isCheckmate()).toBe(true);
    expect(after(find('back-rank', 'intro').fen!, 'e1e8').isCheckmate()).toBe(true);
    // "Now Re8 is only check — the king steps to h7."
    const luft = after(find('back-rank', 'luft').fen!, 'e1e8');
    expect(luft.inCheck() && !luft.isCheckmate()).toBe(true);
    expect(luft.moves({ verbose: true }).map((m) => m.to)).toContain('h7');
    // The ladder: every rook move is check, and it ends in mate.
    const ladder = find('ladder', 'intro') as { fen: string; demo: string[] };
    let cur = ladder.fen;
    ladder.demo.forEach((m, i) => {
      cur = demoMove(cur, m)!.fen;
      if (i % 2 === 0) expect(chess(cur).inCheck(), m).toBe(true);
    });
    expect(chess(cur).isCheckmate()).toBe(true);
    // Qf7 stalemates; Qe8 and Qf8 mate.
    const patt = find('queen-mate', 'patt').fen!;
    expect(after(patt, 'e7f7').isStalemate()).toBe(true);
    expect(after(patt, 'e7e8').isCheckmate()).toBe(true);
    expect(after(patt, 'e7f8').isCheckmate()).toBe(true);
    expect(after(find('rook-mate', 'intro').fen!, 'h1h8').isCheckmate()).toBe(true);
    // Tactics: the knight hangs; Nf6+ forks king and queen; Bb5 pins; Rd1+ skewers.
    expect(chess(find('hanging', 'intro').fen!).isAttacked('d5', 'b')).toBe(false);
    const fork = after(find('fork', 'intro').fen!, 'e4f6');
    expect(fork.inCheck()).toBe(true);
    expect(destsOf(withTurn(fork.fen(), 'white'), 'f6')).toContain('h5');
    const pinned = after(find('pin', 'intro').fen!, 'f1b5');
    expect(destsOf(pinned.fen(), 'c6')).toEqual([]);
    expect(destsOf(find('pin', 'use').fen!, 'g7')).toEqual([]);
    const skewer = after(find('skewer', 'intro').fen!, 'a1d1');
    expect(skewer.inCheck()).toBe(true);
    expect(skewer.moves({ verbose: true }).every((m) => m.piece === 'k' && m.to[0] !== 'd')).toBe(true);
    // Openings: 8 squares for a centralised knight, 2 in the corner; 4 on the rim.
    const why = find('center', 'why').fen!;
    expect(destsOf(why, 'd4')).toHaveLength(8);
    expect(destsOf(why, 'a1')).toHaveLength(2);
    expect(destsOf('8/8/8/8/8/7N/8/8 w - - 0 1', 'h3')).toHaveLength(4);
    expect(destsOf('8/8/8/8/8/5N2/8/8 w - - 0 1', 'f3')).toHaveLength(8);
    const traps = find('traps', 'intro') as { fen: string; demo: string[] };
    expect(after(traps.fen, ...traps.demo).isCheckmate()).toBe(true);
    // Only the king guards f7 at the start.
    expect(new Chess().attackers('f7', 'b')).toEqual(['e8']);
  });

  // The later explanations replay a real game (a checked Lichess puzzle) and
  // describe it move by move; pin down what the words say.
  it('intermediate and advanced', () => {
    const demo = (lesson: string, moves = Infinity) => {
      const step = find(lesson, 'intro') as { fen: string; demo: string[] };
      let cur = step.fen;
      for (const m of step.demo.slice(0, moves)) cur = demoMove(cur, m)!.fen;
      return chess(cur);
    };
    const onlyMoves = (c: Chess) => c.moves({ verbose: true }).map((m) => m.san);
    const kingSquare = (c: Chess) => c.board().flat().find((p) => p && p.type === 'k' && p.color === c.turn())!.square;
    const checkers = (c: Chess) => c.attackers(kingSquare(c), c.turn() === 'w' ? 'b' : 'w').length;

    // Discovered: Nc3+ — the queen on d3 checks, the knight hits the queen on d1.
    const disc = demo('discovered', 1);
    expect(disc.inCheck()).toBe(true);
    expect(disc.attackers('f1', 'b')).toEqual(['d3']);
    expect(disc.attackers('d1', 'b')).toContain('c3');
    // Double check: two checkers, only king moves, and only Kh1.
    const dbl = demo('double-check', 1);
    expect(checkers(dbl)).toBe(2);
    expect(onlyMoves(dbl)).toEqual(['Kh1']);
    // Deflection: the king is the bishop's only guard, and after Kd3 there is none.
    expect(demo('deflection', 0).attackers('f3', 'w')).toEqual(['e2']);
    expect(demo('deflection', 2).attackers('f3', 'w')).toEqual([]);
    expect(demo('attraction').isCheckmate()).toBe(true);
    // Removing the defender: only the knight guards f2.
    expect(demo('defender', 0).attackers('f2', 'w')).toEqual(['d1']);
    // In-between move: Bxe3 takes a rook, with check.
    const zw = demo('intermezzo', 0);
    expect(zw.get('e3')?.type).toBe('r');
    expect(demo('intermezzo', 1).inCheck()).toBe(true);
    // Trapped: after Bf3 every queen move ends on a square White attacks.
    const trap = demo('trapped', 1);
    const queenMoves = trap.moves({ verbose: true }).filter((m) => m.piece === 'q');
    expect(queenMoves.length).toBeGreaterThan(0);
    for (const m of queenMoves) {
      const after = chess(trap.fen());
      after.move(m.san);
      expect(after.isAttacked(m.to, 'w'), m.san).toBe(true);
    }
    // Mate in two: after Qg6+ the king has only h8.
    expect(onlyMoves(demo('mate-in-two', 1))).toEqual(['Kh8']);
    expect(demo('mate-in-two').isCheckmate()).toBe(true);
    // Smothered: double check, the king must go to h1, the rook must take.
    const sm = demo('smothered', 1);
    expect(checkers(sm)).toBe(2);
    expect(onlyMoves(sm)).toEqual(['Kh1']);
    expect(onlyMoves(demo('smothered', 3))).toEqual(['Rxg1']);
    expect(demo('smothered').isCheckmate()).toBe(true);
    // Anastasia: Ne7+ is check, and the knight covers g8 and g6.
    const an = demo('anastasia', 1);
    expect(an.inCheck()).toBe(true);
    expect(an.attackers('g8', 'w')).toContain('e7');
    expect(an.attackers('g6', 'w')).toContain('e7');
    expect(demo('anastasia').isCheckmate()).toBe(true);
    // Arabian: the knight on f6 guards the rook on h7 and g8.
    const ar = demo('arabian');
    expect(ar.isCheckmate()).toBe(true);
    expect(ar.attackers('h7', 'w')).toContain('f6');
    expect(ar.attackers('g8', 'w')).toContain('f6');
    // The square: after b5, …Ke6 steps in; from g6 no step reaches files b–e.
    const q1 = play((find('square', 'q1') as { fen: string }).fen, 'b4b5')!;
    expect(chess(q1.fen).moves({ verbose: true }).map((m) => m.to)).toContain('e6');
    const q2 = play((find('square', 'q2') as { fen: string }).fen, 'b4b5')!;
    expect(chess(q2.fen).moves({ verbose: true }).every((m) => m.to[0]! > 'e')).toBe(true);
    // Opposition: in the drawn position the pawn has no move.
    expect(chess(find('opposition', 'draw').fen!).moves({ square: 'e2', verbose: true })).toEqual([]);
    // Pawn endgames: the king takes on d5.
    expect(demo('pawn-endgames').get('d5')?.type).toBe('k');
    // Mate in three: every one of the attacker's moves is check.
    const m3 = find('mate-in-three', 'intro') as { fen: string; demo: string[] };
    let cur = m3.fen;
    m3.demo.forEach((m, i) => {
      cur = demoMove(cur, m)!.fen;
      if (i % 2 === 0) expect(chess(cur).inCheck(), m).toBe(true);
    });
    expect(chess(cur).isCheckmate()).toBe(true);
    // Quiet move: Be5 neither checks nor captures, and cuts the rook off e8.
    const quiet = find('quiet', 'intro') as { fen: string; demo: string[] };
    const be5 = demoMove(quiet.fen, quiet.demo[0]!)!;
    expect(be5.move.san).toBe('Be5');
    expect(chess(be5.fen).attackers('e8', 'b')).toEqual([]);
    // Zugzwang: after Kf4 Black has exactly one move, …g3, and hxg3 mates.
    expect(onlyMoves(demo('zugzwang', 1))).toEqual(['g3']);
    expect(demo('zugzwang').isCheckmate()).toBe(true);
    // Clearance: Bg8+ is a discovered check from the rook on h3.
    expect(demo('clearance', 1).attackers('h8', 'w')).toEqual(['h3']);
    expect(demo('clearance').isCheckmate()).toBe(true);
    // Interference: the bishop guards h8 until …f6 blocks it.
    expect(demo('interference', 0).isAttacked('h8', 'b')).toBe(true);
    expect(demo('interference', 2).isAttacked('h8', 'b')).toBe(false);
    expect(demo('xray').isCheckmate()).toBe(true);
    // Underpromotion: the knight checks and hits f3; a queen on e1 wouldn't.
    const up = demo('underpromotion', 1);
    expect(up.inCheck()).toBe(true);
    expect(up.attackers('f3', 'b')).toContain('e1');
    const asQueen = play(demo('underpromotion', 0).fen(), 'e2e1q')!;
    expect(chess(asQueen.fen).attackers('f3', 'b')).not.toContain('e1');
    // Lucena: the bridge ends with the rook blocking the check on b4.
    const bridge = find('lucena', 'bridge') as { fen: string; demo: string[] };
    let lu = bridge.fen;
    for (const m of bridge.demo) lu = demoMove(lu, m)!.fen;
    expect(chess(lu).get('b4')?.type).toBe('r');
    expect(chess(withTurn(lu, 'white')).get('b7')?.type).toBe('p');
  });
});
