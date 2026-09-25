// Plays one lesson of the Learn section: its steps one after another — an
// explanation, then tasks — and at the end the stars you earned. The rules of
// each task (what counts as right) live in learn/engine.ts; this file is the
// screen around them.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { Chess, type Move } from 'chess.js';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import {
  ArrowLeft, ArrowRight, BookMarked, BookOpen, Check, Lightbulb, RotateCcw, SkipForward, Star, Volume2, X, Eye, Trophy, List,
} from 'lucide-react';
import LessonBoard, { type Flash } from './LessonBoard';
import { LogoMark } from '../Logo';
import LessonIcon, { PieceIcon } from './LessonIcon';
import { api } from '../../api';
import { useAuth } from '../../state/auth';
import i18n from '../../i18n';
import { normalizeLanguage } from '../../lib/languages';
import { playSound, soundForMove } from '../../lib/sounds';
import { speak, cancel as cancelSpeech } from '../../lib/tts';
import { cn } from '../../lib/utils';
import type { LessonRef } from '../../learn/content';
import {
  isRightMove, judgeOwnMove, judgeReply, legalDests, lessonStars, levelOf, levelPiece, moveStepDone,
  moveStepStart, parseUci, play, shortestStars, sideToMove, starsDests, starsMove, starsStart, wrongReason,
  demoMove, board as loadBoard, type PlayResult, type StarsState,
} from '../../learn/engine';
import {
  isTask, type InfoStep, type MoveStep, type PlayStep, type QuizStep, type Sq, type SquareStep,
  type StarsStep, type StepDef,
} from '../../learn/types';

export const LEARN_QUERY_KEY = ['learn-progress'];

type Tone = 'neutral' | 'good' | 'bad' | 'hint';

// ---- Texts -------------------------------------------------------------------

/** Lesson texts: `<lesson>.<key>`, in kid mode `<lesson>.<key>_kid` when the
 *  lesson has one — the same lesson in simpler words, not a separate tree. */
function useLessonText(lessonId: string) {
  const { t } = useTranslation('learn');
  const { user } = useAuth();
  const kid = user?.profile.audience === 'kid';
  const has = useCallback((key: string) => i18n.exists(`${lessonId}.${key}`, { ns: 'learn' }), [lessonId]);
  const text = useCallback((key: string, opts?: Record<string, unknown>) => {
    const full = `${lessonId}.${key}`;
    return kid && i18n.exists(`${full}_kid`, { ns: 'learn' }) ? t(`${full}_kid`, opts) : t(full, opts);
  }, [t, kid, lessonId]);
  return { text, has };
}

// ---- Screen frame --------------------------------------------------------------

interface FrameInfo {
  /** Lesson header with the progress bar (and the explanation to look up). */
  header: React.ReactNode;
  /** The "Continue" button once the step is done. */
  next: React.ReactNode | null;
  speakText: (text: string) => void;
}
const FrameContext = createContext<FrameInfo>({ header: null, next: null, speakText: () => {} });

/** Board left, the coach's words and the buttons right; on a phone the words
 *  come first, then the board, then the buttons — you read before you move. */
function Frame({ board, text, tone = 'neutral', note, actions, extra, choices }: {
  board: React.ReactNode;
  text: string;
  tone?: Tone;
  note?: React.ReactNode;
  actions?: React.ReactNode;
  extra?: React.ReactNode;
  /** Answers to pick from: on a phone below the board they are about. */
  choices?: React.ReactNode;
}) {
  const { header, next, speakText } = useContext(FrameContext);
  const { user } = useAuth();
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,600px)_minmax(300px,380px)] lg:grid-rows-[auto_1fr] lg:justify-center lg:gap-x-5 lg:gap-y-3">
      <div className="order-2 mx-auto w-full max-w-[600px] lg:order-1 lg:row-span-2">
        <div className={`board-theme-${user?.profile.board_theme ?? 'green'}`}>{board}</div>
      </div>
      <div className="order-1 space-y-3 lg:order-2">
        {header}
        <CoachBubble text={text} tone={tone} note={note} onSpeak={() => speakText(text)} />
        {extra}
      </div>
      <div className="order-3 space-y-2 lg:col-start-2 lg:self-start">
        {choices}
        {next}
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

function CoachBubble({ text, tone, note, onSpeak }: { text: string; tone: Tone; note?: React.ReactNode; onSpeak: () => void }) {
  const { t } = useTranslation();
  const ring = {
    neutral: 'border-chesscom-200 dark:border-chesscom-700',
    good: 'border-green-400 bg-green-50/60 dark:bg-green-500/10',
    bad: 'border-move-mistake bg-move-mistake/5',
    hint: 'border-gold-500/70 bg-gold-500/5',
  }[tone];
  return (
    <div className="flex items-start gap-3">
      <div className="mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-chesscom-900 shadow-soft ring-2 ring-gold-500/60">
        <LogoMark size={30} />
      </div>
      <motion.div
        key={text}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className={cn('relative min-w-0 flex-1 rounded-xl border bg-white p-3.5 shadow-soft dark:bg-chesscom-800', ring)}
      >
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 whitespace-pre-line text-[15px] leading-relaxed text-chesscom-800 dark:text-chesscom-100">
            <RichText text={text} />
          </p>
          <button
            onClick={onSpeak}
            className="-mr-1 -mt-1 shrink-0 rounded-md p-1.5 text-chesscom-400 hover:bg-chesscom-100 hover:text-chesscom-700 dark:hover:bg-chesscom-700 dark:hover:text-chesscom-200"
            title={t('learn.readAloud')}
            aria-label={t('learn.readAloud')}
          >
            <Volume2 className="h-4 w-4" />
          </button>
        </div>
        <AnimatePresence mode="wait">
          {note && (
            <motion.div
              key={typeof note === 'string' ? note : tone}
              initial={{ opacity: 0, x: tone === 'bad' ? 0 : -4 }}
              animate={tone === 'bad' ? { opacity: 1, x: [0, -6, 6, -4, 4, 0] } : { opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35 }}
              className="mt-2 border-t border-chesscom-100 pt-2 text-sm dark:border-chesscom-700"
            >
              {note}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

/** Lesson texts may use **bold** — nothing else, so no HTML is ever built. */
function RichText({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return <>{parts.map((p, i) => (i % 2 ? <strong key={i}>{p}</strong> : p))}</>;
}

function Note({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const Icon = tone === 'good' ? Check : tone === 'bad' ? X : tone === 'hint' ? Lightbulb : null;
  const color = tone === 'good' ? 'text-green-600 dark:text-green-400' : tone === 'bad' ? 'text-move-mistake' : tone === 'hint' ? 'text-gold-700 dark:text-gold-300' : 'text-chesscom-500';
  return (
    <div className={cn('flex items-start gap-1.5 font-medium', color)}>
      {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0" />}
      <span className="min-w-0">{children}</span>
    </div>
  );
}

// ---- Board helpers --------------------------------------------------------------

function brushed(spec: string): { a: string; brush: string } {
  const [a, brush] = spec.split(':');
  return { a: a!, brush: brush ?? 'green' };
}

function stepShapes(step: StepDef): DrawShape[] {
  const out: DrawShape[] = [];
  for (const spec of step.arrows ?? []) {
    const { a, brush } = brushed(spec);
    out.push({ orig: a.slice(0, 2) as Key, dest: a.slice(2, 4) as Key, brush });
  }
  for (const spec of step.marks ?? []) {
    const { a, brush } = brushed(spec);
    out.push({ orig: a as Key, brush });
  }
  return out;
}

const EMPTY_FEN = '8/8/8/8/8/8/8/8 w - - 0 1';

function moveSound(move: Pick<Move, 'san' | 'flags'>) {
  soundForMove({
    capture: move.flags.includes('c') || move.flags.includes('e'),
    castle: move.flags.includes('k') || move.flags.includes('q'),
    promotion: move.flags.includes('p'),
    check: move.san.includes('+') || move.san.includes('#'),
  });
}

let flashId = 0;
function useFlashes() {
  const [flashes, setFlashes] = useState<Flash[]>([]);
  const flash = useCallback((sq: Sq, kind: Flash['kind']) => {
    const f = { sq, kind, id: ++flashId };
    setFlashes((list) => [...list, f]);
    window.setTimeout(() => setFlashes((list) => list.filter((x) => x.id !== f.id)), 950);
  }, []);
  return { flashes, flash };
}

/** Timeouts that die with the step, so nothing plays into the next one. */
function useTimers() {
  const ids = useRef<number[]>([]);
  // Timers asked for after an await may come in after unmount — drop those.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      ids.current.forEach((id) => window.clearTimeout(id));
    };
  }, []);
  return useCallback((fn: () => void, ms: number) => {
    if (alive.current) ids.current.push(window.setTimeout(fn, ms));
  }, []);
}

// ---- The player -----------------------------------------------------------------

export interface PlayerProps {
  refInfo: LessonRef;
  /** Where to start: 0, or where an unfinished run stopped. */
  resume: { step: number; flawed: number };
  bestStars: number;
  totalStars: number;
  next: LessonRef | null;
  onOpenLesson: (id: string) => void;
  onExit: () => void;
}

export default function LessonPlayer({ refInfo, resume, bestStars, totalStars, next, onOpenLesson, onExit }: PlayerProps) {
  const { t } = useTranslation();
  const { t: tl } = useTranslation('learn');
  const { user } = useAuth();
  const qc = useQueryClient();
  const { lesson, course, level } = refInfo;
  const { text, has } = useLessonText(lesson.id);
  const steps = lesson.steps;
  const tasks = steps.filter(isTask).length;

  const [index, setIndex] = useState(Math.min(resume.step, steps.length - 1));
  const [flawed, setFlawed] = useState(resume.flawed);
  const [resumed, setResumed] = useState(resume.step > 0);
  // null while the current step still wants something from you.
  const [solved, setSolved] = useState<null | { clean: boolean }>(null);
  // With the best result and the star total from before this run: saving
  // updates both props, and the end screen shows what this run changed.
  const [finished, setFinished] = useState<null | { stars: 1 | 2 | 3; bestBefore: number; totalBefore: number }>(null);
  const [run, setRun] = useState(0);
  // The last explanation before a task, to look up again while solving it.
  const [recall, setRecall] = useState(false);
  // Stable, because an explanation reports itself done from an effect.
  const onSolved = useCallback((clean: boolean) => setSolved({ clean }), []);
  const onReopen = useCallback(() => setSolved(null), []);

  const step = steps[index]!;
  const lastInfo = step.type === 'info' ? null : [...steps.slice(0, index)].reverse().find((s) => s.type === 'info') ?? null;
  useEffect(() => setRecall(false), [index, run]);

  useEffect(() => { window.scrollTo({ top: 0 }); }, [index, finished]);
  useEffect(() => () => cancelSpeech(), []);

  const save = useCallback((body: object) => {
    api.post(`/api/learn/${lesson.id}`, body)
      .then(() => {
        void qc.invalidateQueries({ queryKey: LEARN_QUERY_KEY });
        void qc.invalidateQueries({ queryKey: ['achievements-home'] });
        void qc.invalidateQueries({ queryKey: ['achievements'] });
      })
      .catch(() => { /* progress is a nicety; never interrupt a lesson for it */ });
  }, [lesson.id, qc]);

  const speakText = useCallback((s: string) => {
    const ui = normalizeLanguage(i18n.language);
    // Speak in the language the text is actually in (a lesson without its
    // own translation reads English).
    const lang = i18n.hasResourceBundle(ui, 'learn') ? ui : 'en';
    speak(s.replace(/\*\*/g, ''), { lang, voice: user?.profile.tts_voice, rate: user?.profile.tts_rate, pitch: user?.profile.tts_pitch });
  }, [user]);

  function advance() {
    if (!solved) return;
    const nextFlawed = flawed + (isTask(step) && !solved.clean ? 1 : 0);
    setFlawed(nextFlawed);
    setSolved(null);
    setResumed(false);
    if (index + 1 < steps.length) {
      setIndex(index + 1);
      save({ step: index + 1, flawed: nextFlawed });
    } else {
      const stars = lessonStars(tasks, nextFlawed);
      setFinished({ stars, bestBefore: bestStars, totalBefore: totalStars });
      save({ stars });
      playSound('promotion');
    }
  }

  // Enter / → moves on, like the button.
  const advanceRef = useRef(advance);
  advanceRef.current = advance;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && ['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT', 'A'].includes(el.tagName)) return;
      if (e.key === 'Enter' || e.key === 'ArrowRight') advanceRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function restart() {
    setIndex(0);
    setFlawed(0);
    setSolved(null);
    setFinished(null);
    setResumed(false);
    setRun((r) => r + 1);
    save({ step: 0, flawed: 0 });
  }

  // Auto-read each new step aloud when the profile has text-to-speech on —
  // the same words the bubble shows (puzzles share the lesson's task text).
  useEffect(() => {
    if (finished || !user?.profile.tts_enabled) return;
    if (step.type === 'move' && !has(step.id)) {
      const side = t(sideToMove(moveStepStart(step).fen) === 'white' ? 'learn.white' : 'learn.black');
      speakText(text('task', { side }));
    } else {
      speakText(text(step.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, run, finished]);

  if (finished) {
    return (
      <LessonDone
        refInfo={refInfo}
        stars={finished.stars}
        bestBefore={finished.bestBefore}
        totalBefore={finished.totalBefore}
        next={next}
        onNext={() => next && onOpenLesson(next.lesson.id)}
        onAgain={restart}
        onExit={onExit}
      />
    );
  }

  const header = (
    <div className="card p-3">
      <div className="flex items-center gap-2">
        <button onClick={onExit} className="rounded-md p-1.5 text-chesscom-500 hover:bg-chesscom-100 hover:text-chesscom-800 dark:hover:bg-chesscom-700 dark:hover:text-chesscom-100" title={t('learn.backToCourse')} aria-label={t('learn.backToCourse')}>
          <ArrowLeft className="h-4 w-4" />
        </button>
        <LessonIcon icon={lesson.icon} level={level.id} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-semibold uppercase tracking-wider text-chesscom-500">
            {tl(`courses.${course.id}.title`)}
          </div>
          <div className="truncate text-sm font-semibold text-chesscom-900 dark:text-chesscom-100">{text('title')}</div>
        </div>
        <span className="shrink-0 font-mono text-xs tabular-nums text-chesscom-500">{index + 1}/{steps.length}</span>
      </div>
      <div className="mt-2.5 flex gap-1" aria-hidden>
        {steps.map((s, i) => (
          <div
            key={s.id}
            className={cn(
              'h-1.5 flex-1 rounded-full transition-colors duration-300',
              i < index ? 'bg-green-400' : i === index ? (solved ? 'bg-green-400' : 'bg-gold-500') : 'bg-chesscom-100 dark:bg-chesscom-700',
            )}
          />
        ))}
      </div>
      {resumed && (
        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-chesscom-500">
          <span>{t('learn.resumed', { n: index + 1 })}</span>
          <button onClick={restart} className="font-medium text-board-dark hover:underline">{t('learn.fromStart')}</button>
        </div>
      )}
      {lastInfo && (
        <div className="mt-2 text-xs">
          <button onClick={() => setRecall(!recall)} className="flex items-center gap-1 font-medium text-board-dark hover:underline" aria-expanded={recall}>
            <BookOpen className="h-3.5 w-3.5" /> {recall ? t('learn.hideExplanation') : t('learn.showExplanation')}
          </button>
          {recall && (
            <p className="mt-1.5 whitespace-pre-line rounded-md bg-chesscom-50 p-2.5 text-[13px] leading-relaxed text-chesscom-700 dark:bg-chesscom-900/50 dark:text-chesscom-200">
              <RichText text={text(lastInfo.id)} />
            </p>
          )}
        </div>
      )}
    </div>
  );

  const nextButton = solved && (
    <motion.button
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={advance}
      className="btn-primary w-full py-3 text-base"
      autoFocus
    >
      {index + 1 < steps.length ? t('learn.continue') : t('learn.finish')} <ArrowRight className="h-4 w-4" />
    </motion.button>
  );

  const common = { lessonId: lesson.id, onSolved, onReopen };

  return (
    <FrameContext.Provider value={{ header, next: nextButton || null, speakText }}>
      <div key={`${run}-${index}`}>
        {step.type === 'info' && <InfoView step={step} {...common} />}
        {step.type === 'stars' && <StarsView step={step} {...common} />}
        {step.type === 'square' && <SquareView step={step} {...common} />}
        {step.type === 'move' && <MoveView step={step} {...common} />}
        {step.type === 'play' && <PlayView step={step} {...common} />}
        {step.type === 'quiz' && <QuizView step={step} {...common} />}
      </div>
    </FrameContext.Provider>
  );
}

interface StepProps<S> {
  step: S;
  lessonId: string;
  /** The step is done; `clean` = without a mistake, a hint or the solution. */
  onSolved: (clean: boolean) => void;
  /** Back to "not done" (trying a stars task again for a better score). */
  onReopen: () => void;
}

// ---- Explanation ----------------------------------------------------------------

function InfoView({ step, lessonId, onSolved }: StepProps<InfoStep>) {
  const { text } = useLessonText(lessonId);
  useEffect(() => { onSolved(true); }, [onSolved]);
  const demo = useDemo(step.fen ?? EMPTY_FEN, step.demo);
  const orientation = step.orientation ?? 'white';
  return (
    <Frame
      text={text(step.id)}
      board={<LessonBoard fen={demo.fen} orientation={orientation} lastMove={demo.lastMove} shapes={demo.playing ? undefined : stepShapes(step)} />}
    />
  );
}

/** Replays the demo moves in a loop: move, move, …, pause, from the top. */
function useDemo(fen: string, moves?: string[]) {
  const [state, setState] = useState<{ fen: string; lastMove?: [Sq, Sq]; playing: boolean }>({ fen, playing: false });
  useEffect(() => {
    if (!moves?.length) { setState({ fen, playing: false }); return; }
    let cancelled = false;
    let timer = 0;
    let first = true;
    const loop = () => {
      let cur = fen;
      let i = 0;
      setState({ fen, playing: false });
      const tick = () => {
        if (cancelled) return;
        if (i >= moves.length) {
          first = false;
          timer = window.setTimeout(loop, 1800);
          return;
        }
        const r = demoMove(cur, moves[i]!);
        if (!r) return;
        cur = r.fen;
        if (first) moveSound(r.move);
        setState({ fen: cur, lastMove: [r.move.from, r.move.to], playing: true });
        i += 1;
        timer = window.setTimeout(tick, 1100);
      };
      timer = window.setTimeout(tick, 900);
    };
    loop();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [fen, moves]);
  return state;
}

// ---- Collect the stars ------------------------------------------------------------

function StarsView({ step, lessonId, onSolved, onReopen }: StepProps<StarsStep>) {
  const { t } = useTranslation();
  const { text } = useLessonText(lessonId);
  const [state, setState] = useState<StarsState>(() => starsStart(step));
  const [hint, setHint] = useState<string | null>(null);
  const [hinted, setHinted] = useState(false);
  const [done, setDone] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  const dests = useMemo(() => (done ? null : starsDests(state)), [state, done]);

  function onMove(uci: string) {
    const next = starsMove(state, uci);
    if (!next) { setResetKey((k) => k + 1); return; }
    const got = state.left.includes(uci.slice(2, 4));
    const took = !!loadBoard(state.fen).get(uci.slice(2, 4) as never);
    soundForMove({ capture: took });
    if (got) window.setTimeout(() => playSound('click'), 120);
    setState(next);
    setHint(null);
    if (!next.left.length) {
      setDone(true);
      window.setTimeout(() => playSound('game_start'), 250);
      // Over par is fine for the stars — the note invites another try.
      onSolved(!hinted);
    }
  }

  function showHint() {
    const h = shortestStars(state)?.first ?? null;
    setHint(h);
    setHinted(true);
  }

  function again() {
    setState(starsStart(step));
    setHint(null);
    setDone(false);
    setResetKey((k) => k + 1);
    onReopen();
  }

  const shapes = useMemo(() => {
    const base = state.moves === 0 && !done ? stepShapes(step) : [];
    return hint ? [...base, { orig: hint.slice(0, 2) as Key, dest: hint.slice(2, 4) as Key, brush: 'paleBlue' }] : base;
  }, [hint, state.moves, done, step]);

  const over = done && state.moves > step.par;
  const note = done
    ? <Note tone="good">{over ? t('learn.starsOver', { n: state.moves, par: step.par }) : t('learn.starsPerfect', { count: state.moves })}</Note>
    : <Note tone={hint ? 'hint' : 'neutral'}>{t('learn.starsCount', { n: state.moves, par: step.par, left: state.left.length })}</Note>;

  return (
    <Frame
      text={text(step.id)}
      tone={done ? 'good' : hint ? 'hint' : 'neutral'}
      note={note}
      board={
        <LessonBoard
          fen={state.fen}
          orientation={step.orientation ?? sideToMove(step.fen)}
          dests={dests}
          onMove={onMove}
          stars={state.left}
          shapes={shapes}
          resetKey={resetKey}
        />
      }
      actions={
        <>
          {!done && (
            <button onClick={showHint} className="btn-secondary flex-1 text-sm">
              <Lightbulb className="h-4 w-4" /> {t('learn.hint')}
            </button>
          )}
          {state.moves > 0 && (!done || over) && (
            <button onClick={again} className={cn(over ? 'btn-secondary' : 'btn-ghost', 'flex-1 text-sm')}>
              <RotateCcw className="h-4 w-4" /> {over ? t('learn.tryPar') : t('learn.restartTask')}
            </button>
          )}
        </>
      }
    />
  );
}

// ---- Tap the squares ------------------------------------------------------------------

function SquareView({ step, lessonId, onSolved }: StepProps<SquareStep>) {
  const { t } = useTranslation();
  const { text } = useLessonText(lessonId);
  const [found, setFound] = useState<Sq[]>([]);
  const [wrong, setWrong] = useState<Sq | null>(null);
  const [slipped, setSlipped] = useState(false);
  const { flashes, flash } = useFlashes();
  const done = found.length === step.answer.length;

  function onSquare(sq: Sq) {
    if (done || found.includes(sq)) return;
    if (step.answer.includes(sq)) {
      const now = [...found, sq];
      setFound(now);
      setWrong(null);
      flash(sq, 'good');
      if (now.length === step.answer.length) {
        playSound('game_start');
        onSolved(!slipped);
      } else {
        playSound('click');
      }
    } else {
      flash(sq, 'bad');
      setWrong(sq);
      setSlipped(true);
    }
  }

  function showHint() {
    const missing = step.answer.find((s) => !found.includes(s));
    if (missing) flash(missing, 'good');
    setSlipped(true);
  }

  const many = step.answer.length > 1;
  const note = done
    ? <Note tone="good">{t('learn.right')}</Note>
    : wrong
      ? <Note tone="bad">{t(step.movesOf ? 'learn.cannotGoThere' : 'learn.notThisSquare', { sq: wrong })}</Note>
      : many ? <Note tone="neutral">{t('learn.foundCount', { n: found.length, total: step.answer.length })}</Note> : undefined;

  return (
    <Frame
      text={text(step.id)}
      tone={done ? 'good' : wrong ? 'bad' : 'neutral'}
      note={note}
      board={
        <LessonBoard
          fen={step.fen ?? EMPTY_FEN}
          orientation={step.orientation ?? 'white'}
          onSquare={onSquare}
          found={found}
          flashes={flashes}
          shapes={stepShapes(step)}
        />
      }
      actions={!done && (
        <button onClick={showHint} className="btn-secondary flex-1 text-sm">
          <Lightbulb className="h-4 w-4" /> {t('learn.hint')}
        </button>
      )}
    />
  );
}

// ---- Find the move ------------------------------------------------------------------

function MoveView({ step, lessonId, onSolved }: StepProps<MoveStep>) {
  const { t } = useTranslation();
  const { text, has } = useLessonText(lessonId);
  const start = useMemo(() => moveStepStart(step), [step]);
  const player = sideToMove(start.fen);
  const later = useTimers();

  const [fen, setFen] = useState(step.pre ? step.fen : start.fen);
  const [lastMove, setLastMove] = useState<[Sq, Sq] | undefined>(undefined);
  const [ready, setReady] = useState(!step.pre);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'play' | 'bad' | 'good' | 'shown'>('play');
  // Why the last wrong move was wrong, when the position can tell.
  const [why, setWhy] = useState<ReturnType<typeof wrongReason>>(null);
  const [hintLevel, setHintLevel] = useState(0);
  // "Show the solution": the arrow shows each move, and you play it yourself.
  const [solving, setSolving] = useState(false);
  const [slipped, setSlipped] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  // First the opponent's move that set the task up, so you see it happen.
  useEffect(() => {
    if (!step.pre) return;
    later(() => {
      const r = play(step.fen, step.pre!)!;
      moveSound(r.move);
      setFen(r.fen);
      setLastMove([r.move.from, r.move.to]);
      setReady(true);
    }, 700);
  }, [step, later]);

  const finished = status === 'good' || status === 'shown';
  const dests = useMemo(() => (ready && !busy && !finished ? legalDests(fen) : null), [ready, busy, finished, fen]);

  function reply(afterFen: string, at: number) {
    setBusy(true);
    later(() => {
      const r = play(afterFen, step.line[at + 1]!)!;
      moveSound(r.move);
      setFen(r.fen);
      setLastMove([r.move.from, r.move.to]);
      setIndex(at + 2);
      setBusy(false);
    }, 550);
  }

  function onMove(uci: string) {
    if (!dests) { setResetKey((k) => k + 1); return; }
    // While the solution is shown, only its move counts.
    const right = solving ? uci === step.line[index] : isRightMove(step, index, fen, uci);
    if (!right) {
      setStatus('bad');
      setSlipped(true);
      playSound('click');
      const reason = solving ? null : wrongReason(step, fen, uci);
      setWhy(reason);
      const r = reason ? play(fen, uci) : null;
      if (r) {
        // Let the board show what went wrong (the stalemate, the king that
        // gets away), then take the move back.
        const before = fen;
        const beforeLast = lastMove;
        moveSound(r.move);
        setFen(r.fen);
        setLastMove([r.move.from, r.move.to]);
        setBusy(true);
        later(() => { setFen(before); setLastMove(beforeLast); setBusy(false); setResetKey((k) => k + 1); }, 1400);
      } else {
        setResetKey((k) => k + 1);
      }
      return;
    }
    const r = play(fen, uci)!;
    moveSound(r.move);
    setFen(r.fen);
    setLastMove([r.move.from, r.move.to]);
    setHintLevel(0);
    setWhy(null);
    if (moveStepDone(step, index, r.fen)) {
      setStatus(solving ? 'shown' : 'good');
      later(() => playSound('game_start'), 250);
      onSolved(!slipped && hintLevel === 0 && !solving);
    } else {
      setStatus('play');
      reply(r.fen, index);
    }
  }

  // "Show me": an arrow for every remaining move — you play them yourself,
  // so the solution goes through your own hands once.
  function showSolution() {
    setSlipped(true);
    setSolving(true);
    setStatus('play');
    setWhy(null);
  }

  const expected = step.line[index];
  const shapes = useMemo(() => {
    const base = !lastMove || index === 0 ? stepShapes(step) : [];
    if (!expected || finished || (hintLevel === 0 && !solving)) return base;
    if (hintLevel === 1 && !solving) return [...base, { orig: expected.slice(0, 2) as Key, brush: 'paleBlue' }];
    return [...base, { orig: expected.slice(0, 2) as Key, dest: expected.slice(2, 4) as Key, brush: 'paleBlue' }];
  }, [step, expected, finished, hintLevel, solving, lastMove, index]);

  // Lichess puzzles share one task text per lesson.
  const side = t(player === 'white' ? 'learn.white' : 'learn.black');
  const task = has(step.id) ? text(step.id, { side }) : text('task', { side });
  const doneText = has(`${step.id}_done`) ? text(`${step.id}_done`) : loadBoard(fen).isCheckmate() ? t('learn.mate') : t('learn.right');

  const wrongText = why === 'stalemate' ? t('learn.wrongStalemate')
    : why === 'onlyCheck' ? t('learn.wrongOnlyCheck')
      : why === 'noCheck' ? t('learn.wrongNoCheck')
        : solving ? t('learn.hintArrow') : t('learn.wrongMove');
  const note = status === 'good'
    ? <Note tone="good">{doneText}</Note>
    : status === 'shown'
      ? <Note tone="hint">{doneText} {t('learn.solutionShown')}</Note>
      : status === 'bad'
        ? <Note tone="bad">{wrongText}</Note>
        : solving
          ? <Note tone="hint">{busy ? t('learn.opponentMoves') : t('learn.hintArrow')}</Note>
          : hintLevel > 0
            ? <Note tone="hint">{hintLevel === 1 ? t('learn.hintPiece') : t('learn.hintArrow')}</Note>
            : busy && index > 0 ? <Note tone="neutral">{t('learn.opponentMoves')}</Note>
              : index > 0 ? <Note tone="good">{t('learn.goodKeepGoing')}</Note> : undefined;

  return (
    <Frame
      text={task}
      tone={status === 'good' ? 'good' : status === 'bad' ? 'bad' : status === 'shown' || solving || hintLevel > 0 ? 'hint' : 'neutral'}
      note={note}
      board={
        <LessonBoard
          fen={fen}
          orientation={step.orientation ?? player}
          dests={dests}
          onMove={onMove}
          lastMove={lastMove}
          shapes={shapes}
          resetKey={resetKey}
        />
      }
      extra={step.src && (
        <div className="px-1 text-[11px] text-chesscom-400">
          {t('learn.fromLichess')}{' '}
          <a href={`https://lichess.org/training/${step.src}`} target="_blank" rel="noopener noreferrer" className="underline hover:text-chesscom-600 dark:hover:text-chesscom-200">
            #{step.src}
          </a>
        </div>
      )}
      actions={!finished && !solving && (
        <>
          {hintLevel < 2 && (
            <button onClick={() => { setHintLevel(hintLevel + 1); setSlipped(true); }} disabled={!ready || busy} className="btn-secondary flex-1 text-sm">
              <Lightbulb className="h-4 w-4" /> {hintLevel === 0 ? t('learn.hint') : t('learn.moreHint')}
            </button>
          )}
          {(status === 'bad' || hintLevel > 0) && (
            <button onClick={showSolution} disabled={!ready || busy} className="btn-ghost flex-1 text-sm">
              <Eye className="h-4 w-4" /> {t('learn.showSolution')}
            </button>
          )}
        </>
      )}
    />
  );
}

// ---- Play it out --------------------------------------------------------------------

function PlayView({ step, lessonId, onSolved, onReopen }: StepProps<PlayStep>) {
  const { t } = useTranslation();
  const { text } = useLessonText(lessonId);
  const player = sideToMove(step.fen);
  const later = useTimers();
  const chessRef = useRef(new Chess(step.fen));
  const [fen, setFen] = useState(step.fen);
  const [lastMove, setLastMove] = useState<[Sq, Sq] | undefined>();
  const [own, setOwn] = useState(0);
  const [thinking, setThinking] = useState(false);
  const [engineDown, setEngineDown] = useState(false);
  const [result, setResult] = useState<PlayResult | 'skipped' | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [slipped, setSlipped] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  // Bumped by "Try again": an engine answer for the previous run is dropped.
  const runRef = useRef(0);

  const over = result !== null;
  const dests = useMemo(() => (!over && !thinking && !engineDown ? legalDests(fen) : null), [fen, over, thinking, engineDown]);

  async function bestMove(position: string, depth: number): Promise<string> {
    // The server analyses one position per user at a time; a request still
    // running (e.g. from leaving and reopening the lesson) is waited out.
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await api.post<{ lines: { uci: string }[] }>('/api/analyze/position', { fen: position, depth, lines: 1 });
        const uci = r.lines[0]?.uci;
        if (!uci) throw new Error('no_move');
        return uci;
      } catch (e) {
        if ((e as Error).message !== 'already_analyzing' || attempt >= 5) throw e;
        await new Promise((r) => window.setTimeout(r, 800));
      }
    }
  }

  function finish(res: PlayResult) {
    setResult(res);
    if (res === 'won') {
      later(() => playSound('game_start'), 250);
      onSolved(!slipped);
    } else {
      playSound('game_end');
    }
  }

  async function reply() {
    const run = runRef.current;
    setThinking(true);
    setEngineDown(false);
    const startedAt = Date.now();
    try {
      const uci = await bestMove(chessRef.current.fen(), 12);
      if (run !== runRef.current) return;
      // A moment to breathe, even when the engine is instant.
      const wait = Math.max(0, 450 - (Date.now() - startedAt));
      later(() => {
        if (run !== runRef.current) return;
        const chess = chessRef.current;
        let move: Move;
        try { move = chess.move(parseUci(uci)); } catch { setEngineDown(true); setThinking(false); return; }
        moveSound(move);
        setFen(chess.fen());
        setLastMove([move.from, move.to]);
        setThinking(false);
        const res = judgeReply(chess, move);
        if (res) finish(res);
      }, wait);
    } catch {
      if (run !== runRef.current) return;
      setEngineDown(true);
      setThinking(false);
    }
  }

  function onMove(uci: string) {
    if (!dests) { setResetKey((k) => k + 1); return; }
    const chess = chessRef.current;
    let move: Move;
    try { move = chess.move(parseUci(uci)); } catch { setResetKey((k) => k + 1); return; }
    moveSound(move);
    setFen(chess.fen());
    setLastMove([move.from, move.to]);
    setHint(null);
    const n = own + 1;
    setOwn(n);
    const res = judgeOwnMove(step, chess, move, n);
    if (res) finish(res);
    else void reply();
  }

  async function showHint() {
    const run = runRef.current;
    setSlipped(true);
    setThinking(true);
    try {
      const uci = await bestMove(fen, 14);
      if (run === runRef.current) setHint(uci);
    } catch {
      if (run === runRef.current) setEngineDown(true);
    } finally {
      if (run === runRef.current) setThinking(false);
    }
  }

  function again() {
    runRef.current += 1;
    setThinking(false);
    chessRef.current = new Chess(step.fen);
    setFen(step.fen);
    setLastMove(undefined);
    setOwn(0);
    setResult(null);
    setHint(null);
    setEngineDown(false);
    setSlipped(true);
    setResetKey((k) => k + 1);
    onReopen();
  }

  const shapes = useMemo(() => {
    const base = own === 0 ? stepShapes(step) : [];
    return hint ? [...base, { orig: hint.slice(0, 2) as Key, dest: hint.slice(2, 4) as Key, brush: 'paleBlue' }] : base;
  }, [hint, own, step]);

  const note = result === 'won'
    ? <Note tone="good">{step.goal === 'mate' ? t('learn.play.wonMate', { count: own }) : t('learn.play.wonPromote', { count: own })}</Note>
    : result === 'skipped'
      ? <Note tone="hint">{t('learn.play.skipped')}</Note>
      : result
      ? <Note tone="bad">{t(`learn.play.${result}`, { limit: step.limit })}</Note>
      : engineDown
        ? <Note tone="bad">{t('learn.play.engineDown')}</Note>
        : thinking
          ? <Note tone="neutral">{t('learn.opponentThinks')}</Note>
          : <Note tone={hint ? 'hint' : 'neutral'}>{t('learn.play.movesLeft', { n: own, limit: step.limit })}</Note>;

  return (
    <Frame
      text={text(step.id)}
      tone={result === 'won' ? 'good' : result === 'skipped' ? 'hint' : result || engineDown ? 'bad' : hint ? 'hint' : 'neutral'}
      note={note}
      board={
        <LessonBoard
          fen={fen}
          orientation={step.orientation ?? player}
          dests={dests}
          onMove={onMove}
          lastMove={lastMove}
          shapes={shapes}
          resetKey={resetKey}
        />
      }
      actions={
        <>
          {!over && !engineDown && (
            <button onClick={() => void showHint()} disabled={thinking} className="btn-secondary flex-1 text-sm">
              <Lightbulb className="h-4 w-4" /> {t('learn.hint')}
            </button>
          )}
          {engineDown && !over && (
            <>
              <button onClick={() => void reply()} className="btn-secondary flex-1 text-sm">
                <RotateCcw className="h-4 w-4" /> {t('learn.play.retryEngine')}
              </button>
              {/* Without an engine this exercise can't be finished — don't
                  let it block the lesson. Counts as not done cleanly. */}
              <button onClick={() => { setResult('skipped'); onSolved(false); }} className="btn-ghost flex-1 text-sm">
                <SkipForward className="h-4 w-4" /> {t('learn.play.skip')}
              </button>
            </>
          )}
          {(over || own > 0) && result !== 'won' && result !== 'skipped' && (
            <button onClick={again} disabled={thinking} className={cn(over ? 'btn-primary' : 'btn-ghost', 'flex-1 text-sm')}>
              <RotateCcw className="h-4 w-4" /> {t('learn.play.again')}
            </button>
          )}
        </>
      }
    />
  );
}

// ---- Question ----------------------------------------------------------------------

function QuizView({ step, lessonId, onSolved }: StepProps<QuizStep>) {
  const { t } = useTranslation();
  const { text } = useLessonText(lessonId);
  const [wrong, setWrong] = useState<string[]>([]);
  const [right, setRight] = useState(false);

  function pick(opt: string) {
    if (right || wrong.includes(opt)) return;
    if (opt === step.answer) {
      setRight(true);
      playSound('game_start');
      onSolved(wrong.length === 0);
    } else {
      setWrong([...wrong, opt]);
      playSound('click');
    }
  }

  const note = right
    ? <Note tone="good">{text(`${step.id}_done`)}</Note>
    : wrong.length ? <Note tone="bad">{t('learn.wrongAnswer')}</Note> : undefined;

  return (
    <Frame
      text={text(step.id)}
      tone={right ? 'good' : wrong.length ? 'bad' : 'neutral'}
      note={note}
      board={<LessonBoard fen={step.fen ?? EMPTY_FEN} orientation={step.orientation ?? 'white'} shapes={stepShapes(step)} />}
      choices={
        <div className="grid gap-2">
          {step.options.map((opt) => {
            const isWrong = wrong.includes(opt);
            const isRight = right && opt === step.answer;
            return (
              <motion.button
                key={opt}
                onClick={() => pick(opt)}
                animate={isWrong ? { x: [0, -5, 5, -3, 3, 0] } : undefined}
                transition={{ duration: 0.3 }}
                disabled={right || isWrong}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-3.5 py-3 text-left text-sm font-medium transition-colors',
                  isRight ? 'border-green-400 bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-300'
                    : isWrong ? 'border-move-mistake/60 bg-move-mistake/5 text-chesscom-400 line-through'
                      : 'border-chesscom-200 bg-white hover:border-gold-500 hover:bg-gold-50 dark:border-chesscom-700 dark:bg-chesscom-800 dark:hover:bg-chesscom-700',
                )}
              >
                {isRight ? <Check className="h-4 w-4 shrink-0" /> : isWrong ? <X className="h-4 w-4 shrink-0" /> : <span className="h-4 w-4 shrink-0 rounded-full border-2 border-chesscom-300" />}
                <RichText text={text(`${step.id}_${opt}`)} />
              </motion.button>
            );
          })}
        </div>
      }
    />
  );
}

// ---- The end of a lesson ------------------------------------------------------------

function LessonDone({ refInfo, stars, bestBefore, totalBefore, next, onNext, onAgain, onExit }: {
  refInfo: LessonRef;
  stars: 1 | 2 | 3;
  bestBefore: number;
  totalBefore: number;
  next: LessonRef | null;
  onNext: () => void;
  onAgain: () => void;
  onExit: () => void;
}) {
  const { t } = useTranslation();
  const { text } = useLessonText(refInfo.lesson.id);
  const { t: tl } = useTranslation('learn');
  const gained = Math.max(0, stars - bestBefore);
  const totalAfter = totalBefore + gained;
  const before = levelOf(totalBefore);
  const after = levelOf(totalAfter);
  const levelUp = after.level > before.level;
  const pct = ((totalAfter - after.floor) / (after.next - after.floor)) * 100;
  const trainer = refInfo.lesson.trainer;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className="mx-auto max-w-md"
    >
      <div className="card overflow-hidden text-center">
        <div className="relative bg-gradient-to-br from-chesscom-900 via-[#3b4c2f] to-board-dark px-6 pb-6 pt-7 text-white">
          <Confetti />
          <Trophy className="mx-auto h-9 w-9 text-gold-300" />
          <div className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-white/60">{t('learn.lessonDone')}</div>
          <h2 className="mt-1 text-xl font-bold">{text('title')}</h2>
          <div className="mt-4 flex justify-center gap-3">
            {[1, 2, 3].map((i) => (
              <motion.div
                key={i}
                initial={{ scale: 0, rotate: -40 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ delay: 0.25 + i * 0.22, type: 'spring', stiffness: 320, damping: 14 }}
              >
                <Star className={cn('h-11 w-11', i <= stars ? 'fill-gold-500 text-gold-300 drop-shadow-[0_0_10px_rgba(255,201,52,0.55)]' : 'text-white/25')} />
              </motion.div>
            ))}
          </div>
          <div className="mt-3 text-sm text-white/80">{t(`learn.starsResult.${stars}`)}</div>
          {stars < 3 && <div className="mt-1 text-xs text-white/60">{t('learn.starsRule')}</div>}
        </div>

        <div className="space-y-4 p-5">
          <div>
            <div className="flex items-center justify-between text-xs text-chesscom-500">
              <span className="flex items-center gap-1.5 font-semibold text-chesscom-800 dark:text-chesscom-100">
                <PieceIcon piece={levelPiece(after.level)} className="h-5 w-5" /> {t('learn.level', { n: after.level })}
              </span>
              <span className="font-mono tabular-nums">{totalAfter} / {after.next} ★</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-chesscom-100 dark:bg-chesscom-700">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ delay: 0.9, duration: 0.7, ease: 'easeOut' }}
                className="h-full rounded-full bg-gold-500"
              />
            </div>
            {gained > 0 && (
              <div className="mt-1.5 text-xs font-medium text-gold-700 dark:text-gold-300">{t('learn.starsGained', { count: gained })}</div>
            )}
            <AnimatePresence>
              {levelUp && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 1.5, type: 'spring', stiffness: 300, damping: 15 }}
                  className="mt-3 flex items-center justify-center gap-2 rounded-lg bg-gold-500/15 px-3 py-2 text-sm font-semibold text-gold-700 ring-1 ring-gold-500/40 dark:text-gold-300"
                >
                  <PieceIcon piece={levelPiece(after.level)} className="h-6 w-6" /> {t('learn.levelUp', { n: after.level })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="space-y-2">
            {next && (
              <button onClick={onNext} className="btn-primary w-full py-3 text-base" autoFocus>
                {t('learn.nextLesson')}: {tl(`${next.lesson.id}.title`)} <ArrowRight className="h-4 w-4" />
              </button>
            )}
            {trainer && (
              <Link to={`/openings?tab=trainer&line=${trainer}`} className="btn-secondary w-full text-sm">
                <BookMarked className="h-4 w-4" /> {t('learn.practiceInTrainer')}
              </Link>
            )}
            <div className="flex gap-2">
              <button onClick={onAgain} className="btn-ghost flex-1 text-sm"><RotateCcw className="h-4 w-4" /> {t('learn.again')}</button>
              <button onClick={onExit} className="btn-ghost flex-1 text-sm"><List className="h-4 w-4" /> {t('learn.toCourse')}</button>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/** A short burst of gold and green flecks behind the trophy. */
function Confetti() {
  const bits = useMemo(() => Array.from({ length: 18 }, (_, i) => ({
    x: (i * 53) % 100,
    delay: (i % 6) * 0.08,
    color: ['#ffc934', '#81b64c', '#ffffff', '#ffd766'][i % 4],
    rot: (i * 37) % 360,
  })), []);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {bits.map((b, i) => (
        <motion.span
          key={i}
          className="absolute top-0 h-2 w-1.5 rounded-sm"
          style={{ left: `${b.x}%`, backgroundColor: b.color }}
          initial={{ y: -10, opacity: 0, rotate: b.rot }}
          animate={{ y: 200, opacity: [0, 1, 1, 0], rotate: b.rot + 240 }}
          transition={{ delay: 0.2 + b.delay, duration: 1.6, ease: 'easeIn' }}
        />
      ))}
    </div>
  );
}

