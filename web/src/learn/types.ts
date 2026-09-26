// The shape of the Learn section's content (web/src/learn/content/*.json).
//
// Everything that decides whether a move is right — positions, solutions,
// stars — lives in these language-free files, and every text lives in
// web/src/locales/learn/<lang>.json under `<lessonId>.<stepId>`. A translation
// can therefore never change what a lesson teaches, and content.test.ts checks
// every position and every solution in one place.

/** A square name, "e4". */
export type Sq = string;
export type Side = 'white' | 'black';

export type LevelId = 'basics' | 'beginner' | 'intermediate' | 'advanced';

export interface LevelDef {
  id: LevelId;
  courses: CourseDef[];
}

export interface CourseDef {
  id: string;
  /** A chess piece letter (K Q R B N P) drawn as the course's badge. */
  icon: string;
  lessons: LessonDef[];
}

export interface LessonDef {
  id: string;
  icon: string;
  steps: StepDef[];
  /** An opening-trainer line (TRAINER_LINES id) offered at the end. */
  trainer?: string;
}

interface StepBase {
  /** Text key inside the lesson: `<lessonId>.<id>` (and `…_kid`, `…_done`). */
  id: string;
  fen?: string;
  orientation?: Side;
  /** "e2e4" draws an arrow, "e2e4:red" in another brush. */
  arrows?: string[];
  /** "e4" circles a square, "e4:red" in another brush. */
  marks?: string[];
}

/** Explanation. The board (if any) may replay `demo` moves in a loop. */
export interface InfoStep extends StepBase {
  type: 'info';
  demo?: string[];
}

/** Move one piece around the board until every star is collected. Nothing
 *  moves back; captures are only allowed onto a star. `par` is the fewest
 *  moves that collect them all (content.test.ts recomputes it). */
export interface StarsStep extends StepBase {
  type: 'stars';
  fen: string;
  stars: Sq[];
  par: number;
  /** The piece that moves, when the side to move has more than one. */
  piece?: Sq;
}

/** Tap the right squares — all of them when there are several. */
export interface SquareStep extends StepBase {
  type: 'square';
  answer: Sq[];
  /** "Where can this piece go?" — content.test.ts checks that `answer` is
   *  exactly the legal moves of the piece on this square. */
  movesOf?: Sq;
}

/** Find the move(s). `line` alternates your moves and the replies, starting
 *  and ending with yours. With goal "mate" any mating move is right; with
 *  goal "check" any check is right (`line` then only feeds the hint). */
export interface MoveStep extends StepBase {
  type: 'move';
  fen: string;
  /** The opponent's move that is played first, so you see what just happened. */
  pre?: string;
  line: string[];
  goal?: 'line' | 'mate' | 'check';
  /** More first moves that are just as right as line[0]. */
  accept?: string[];
  /** Every legal move is in line[0] + accept (content.test.ts checks it) —
   *  for "only one of these ways out of check works" tasks. */
  exact?: boolean;
  /** The task names the move ("castle long", "capture en passant"): it has to
   *  be a sound move, not the strongest one (scripts/verify-lessons.mjs). */
  rule?: boolean;
  /** Lichess puzzle id this position comes from (CC0). */
  src?: string;
}

/** Play it out against Patzer's engine until the goal is reached. */
export interface PlayStep extends StepBase {
  type: 'play';
  fen: string;
  goal: 'mate' | 'promote';
  /** How many of your moves you get. */
  limit: number;
}

/** A multiple-choice question; option texts are `<lessonId>.<id>_<option>`. */
export interface QuizStep extends StepBase {
  type: 'quiz';
  options: string[];
  answer: string;
}

export type StepDef = InfoStep | StarsStep | SquareStep | MoveStep | PlayStep | QuizStep;
export type TaskStep = Exclude<StepDef, InfoStep>;

export function isTask(step: StepDef): step is TaskStep {
  return step.type !== 'info';
}
