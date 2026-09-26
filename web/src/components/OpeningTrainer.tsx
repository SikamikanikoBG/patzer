// Opening trainer — the practice mode of the Openings page (roadmap #6).
// Pick a line (a built-in main line, or one from your own repertoire tree);
// Patzer plays the other side and you find your moves. Every move you miss is
// stored on the server, per profile, and comes back in a daily review queue.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, Eye, GraduationCap, Lightbulb, Repeat, RotateCcw, Target, Trash2, Trophy, X } from 'lucide-react';
import ChessBoard from './ChessBoard';
import { api } from '../api';
import { useAuth } from '../state/auth';
import { soundForMove, inferMoveFlagsFromSan } from '../lib/sounds';
import {
  type DrillLine, type Side,
  formatMoves, isExpectedMove, isUserPly, localDay, moveSquares, positionAfter, sideOfPly, userMoveCount,
} from '../lib/openingTrainer';

export interface TrainerInfo {
  lines: (DrillLine & { id: string; eco: string })[];
  learned_after: number;
  due: number;
  learning: number;
  learned: number;
}

interface RepertoireSide { games: number; moves: string[]; name: string | null; stoppedBefore?: string }
interface ReviewItem { id: number; line_name: string; line_id: string | null; color: Side; moves: string[]; fen: string; misses: number; streak: number }
interface ReviewAnswer { correct: boolean; expected_san: string; expected_uci: string; streak: number; learned: boolean }
/** A first wrong try in the review: nothing given away, one more go. */
interface ReviewRetry { correct: false; retry: true }

export const TRAINER_QUERY_KEY = ['opening-trainer'];
export const fetchTrainer = () => api.get<TrainerInfo>(`/api/openings/trainer?today=${localDay()}`);

/** A built-in line's name in the user's language (repertoire lines keep the
 *  ECO name, like the tree does). */
function useLineName() {
  const { t } = useTranslation();
  return (id: string | null | undefined, name: string) =>
    id ? t(`openings.trainer.lineNames.${id}`, { defaultValue: name }) : name;
}

// A drill first asks whether you know the line; "watch" plays it with arrows
// and counts nothing, "test" is the real thing.
type Phase = 'ask' | 'watch' | 'test';

type Mode =
  | { kind: 'pick' }
  | { kind: 'drill'; line: DrillLine; run: number; phase: Phase }
  | { kind: 'review'; run: number };

export default function OpeningTrainer({ repertoirePrefix, onClearRepertoire, startLine, onStartLineUsed }: {
  /** Moves up to the tree node the user chose to practice, or null. */
  repertoirePrefix: string[] | null;
  onClearRepertoire: () => void;
  /** A built-in line to open right away (a link from the Learn section). */
  startLine?: string | null;
  onStartLineUsed?: () => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>({ kind: 'pick' });
  const { data: info, isLoading, isError } = useQuery({ queryKey: TRAINER_QUERY_KEY, queryFn: fetchTrainer });

  useEffect(() => {
    if (!startLine || !info) return;
    const line = info.lines.find((l) => l.id === startLine);
    if (line) setMode({ kind: 'drill', line, run: Date.now(), phase: 'ask' });
    onStartLineUsed?.();
  }, [startLine, info, onStartLineUsed]);

  // "Practice this line" in the tree always lands on the picker.
  useEffect(() => { if (repertoirePrefix) setMode({ kind: 'pick' }); }, [repertoirePrefix]);
  // Every switch starts at the top — a line picked far down the list would
  // otherwise open with the board half off the screen.
  useEffect(() => { window.scrollTo({ top: 0 }); }, [mode]);

  const startReview = () => setMode({ kind: 'review', run: Date.now() });

  if (mode.kind === 'drill') {
    return (
      <Drill
        key={mode.run}
        line={mode.line}
        phase={mode.phase}
        due={info?.due ?? 0}
        onRestart={(phase) => setMode({ ...mode, phase: phase ?? mode.phase, run: mode.run + 1 })}
        onExit={() => setMode({ kind: 'pick' })}
        onReview={startReview}
      />
    );
  }
  if (mode.kind === 'review') {
    return <Review key={mode.run} learnedAfter={info?.learned_after ?? 3} onExit={() => setMode({ kind: 'pick' })} />;
  }

  if (isLoading) return <div className="card p-10 text-center text-sm text-chesscom-500">{t('common.loading')}</div>;
  if (isError || !info) return <div className="card p-10 text-center text-sm text-move-mistake">{t('openings.trainer.loadError')}</div>;

  return (
    <Picker
      info={info}
      repertoirePrefix={repertoirePrefix}
      onClearRepertoire={onClearRepertoire}
      onStart={(line) => setMode({ kind: 'drill', line, run: Date.now(), phase: 'ask' })}
      onReview={startReview}
    />
  );
}

// ---- Choosing a line -----------------------------------------------------

function Picker({ info, repertoirePrefix, onClearRepertoire, onStart, onReview }: {
  info: TrainerInfo;
  repertoirePrefix: string[] | null;
  onClearRepertoire: () => void;
  onStart: (line: DrillLine) => void;
  onReview: () => void;
}) {
  const { t } = useTranslation();
  const white = info.lines.filter((l) => l.color === 'white');
  const black = info.lines.filter((l) => l.color === 'black');

  return (
    <div className="space-y-5">
      <p className="text-sm text-chesscom-600 dark:text-chesscom-300">{t('openings.trainer.intro')}</p>

      <div className="grid gap-4 lg:grid-cols-2">
        <ReviewCard info={info} onReview={onReview} />
        {repertoirePrefix
          ? <RepertoireCard prefix={repertoirePrefix} onClose={onClearRepertoire} onStart={onStart} />
          : (
            <div className="card flex items-start gap-3 p-4 text-sm text-chesscom-600 dark:text-chesscom-300">
              <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-gold-600" />
              <span>{t('openings.trainer.repertoireHint')}</span>
            </div>
          )}
      </div>

      <LineGroup title={t('openings.trainer.linesWhite')} lines={white} onStart={onStart} />
      <LineGroup title={t('openings.trainer.linesBlack')} lines={black} onStart={onStart} />
    </div>
  );
}

function ReviewCard({ info, onReview }: { info: TrainerInfo; onReview: () => void }) {
  const { t } = useTranslation();
  return (
    <section className="card p-4">
      <div className="flex items-center gap-2">
        <Repeat className="h-4 w-4 text-board-dark" />
        <h2 className="text-sm font-semibold">{t('openings.trainer.reviewTitle')}</h2>
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <div className="font-mono text-3xl font-bold tabular-nums text-chesscom-900 dark:text-chesscom-100">{info.due}</div>
          <div className="text-xs text-chesscom-500">{t('openings.trainer.dueToday')}</div>
        </div>
        <button onClick={onReview} disabled={info.due === 0} className="btn-primary whitespace-nowrap text-sm">
          {t('openings.trainer.reviewStart')} <ArrowRight className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 text-xs text-chesscom-500">
        {info.learning + info.learned > 0
          ? t('openings.trainer.reviewCounts', { learning: info.learning, learned: info.learned })
          : t('openings.trainer.reviewEmpty', { n: info.learned_after })}
        {info.due === 0 && info.learning > 0 && <> {t('openings.trainer.nothingDue')}</>}
      </div>
    </section>
  );
}

function RepertoireCard({ prefix, onClose, onStart }: {
  prefix: string[];
  onClose: () => void;
  onStart: (line: DrillLine) => void;
}) {
  const { t } = useTranslation();
  const key = prefix.join(' ');
  const { data, isLoading, isError } = useQuery({
    queryKey: ['opening-trainer-repertoire', key],
    queryFn: () => api.get<Record<Side, RepertoireSide>>(`/api/openings/trainer/repertoire?moves=${encodeURIComponent(key)}`),
  });
  const [chosen, setChosen] = useState<Side | null>(null);
  useEffect(() => setChosen(null), [key]);

  // Preselect the color you actually reach this position with.
  const color: Side = chosen ?? (data && data.black.games > data.white.games ? 'black' : 'white');
  const side = data?.[color];
  const own = side ? userMoveCount(side.moves, color) : 0;

  return (
    <section className="card border-gold-500/60 p-4">
      <div className="flex items-center gap-2">
        <GraduationCap className="h-4 w-4 text-gold-600" />
        <h2 className="text-sm font-semibold">{t('openings.trainer.fromRepertoire')}</h2>
        <button onClick={onClose} className="ml-auto rounded p-1 text-chesscom-400 hover:text-chesscom-700 dark:hover:text-chesscom-200" aria-label={t('openings.trainer.close')}>
          <X className="h-4 w-4" />
        </button>
      </div>

      {isLoading && <div className="mt-3 text-sm text-chesscom-500">{t('common.loading')}</div>}
      {isError && <div className="mt-3 text-sm text-move-mistake">{t('openings.trainer.loadError')}</div>}
      {data && side && (
        <>
          <div className="mt-2 text-sm font-medium text-chesscom-900 dark:text-chesscom-100">
            {side.name ?? t('openings.trainer.myLine')}
          </div>
          <div className="mt-1 font-mono text-xs leading-relaxed text-chesscom-600 dark:text-chesscom-300">
            {formatMoves(side.moves) || t('openings.startPosition')}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-chesscom-500">{t('openings.trainer.iPlay')}</span>
            {(['white', 'black'] as const).map((c) => (
              <button
                key={c}
                onClick={() => setChosen(c)}
                className={`rounded-md border px-2.5 py-1 transition-colors ${
                  c === color
                    ? 'border-gold-500 bg-gold-500/15 text-chesscom-900 dark:text-chesscom-100'
                    : 'border-chesscom-200 text-chesscom-600 hover:bg-chesscom-100 dark:border-chesscom-700 dark:text-chesscom-300 dark:hover:bg-chesscom-700/40'
                }`}
              >
                {c === 'white' ? t('openings.trainer.white') : t('openings.trainer.black')}
                {' · '}
                {t('openings.trainer.games', { count: data[c].games })}
              </button>
            ))}
          </div>

          {side.games === 0 && own > 0 && (
            <div className="mt-2 text-xs text-chesscom-500">{t('openings.trainer.notReached')}</div>
          )}
          {side.stoppedBefore && (
            <div className="mt-2 text-xs text-gold-700 dark:text-gold-300">{t('openings.trainer.stoppedBefore', { san: side.stoppedBefore })}</div>
          )}
          {side.games > 0 && own > 0 && (
            <div className="mt-2 text-xs text-chesscom-500">{t('openings.trainer.yourHabits')}</div>
          )}
          {own === 0 && <div className="mt-2 text-xs text-move-mistake">{t('openings.trainer.tooShort')}</div>}

          <button
            disabled={own === 0}
            onClick={() => onStart({ name: side.name ?? t('openings.trainer.myLine'), color, moves: side.moves })}
            className="btn-primary mt-3 w-full text-sm"
          >
            {t('openings.trainer.start')} <ArrowRight className="h-4 w-4" />
          </button>
        </>
      )}
    </section>
  );
}

function LineGroup({ title, lines, onStart }: {
  title: string;
  lines: TrainerInfo['lines'];
  onStart: (line: DrillLine) => void;
}) {
  const { t } = useTranslation();
  const lineName = useLineName();
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-chesscom-500">{title}</h2>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {lines.map((line) => (
          <button key={line.id} onClick={() => onStart(line)} className="card-hover p-3 text-left">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 rounded bg-chesscom-100 px-1.5 py-0.5 font-mono text-[11px] text-chesscom-600 dark:bg-chesscom-900/60 dark:text-chesscom-300">
                {line.eco}
              </span>
              <span className="line-clamp-2 text-sm font-semibold text-chesscom-900 dark:text-chesscom-100">{lineName(line.id, line.name)}</span>
            </div>
            <div className="mt-1.5 truncate font-mono text-xs text-chesscom-500">
              {formatMoves(line.moves.slice(0, 6))} …
            </div>
            <div className="mt-1 text-[11px] text-chesscom-400">
              {t('openings.trainer.movesToFind', { count: userMoveCount(line.moves, line.color) })}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

// ---- Practising a line ---------------------------------------------------

function Drill({ line, phase: startPhase, due, onRestart, onExit, onReview }: {
  line: DrillLine;
  phase: Phase;
  due: number;
  /** Start the line again — in `phase` when given, else in the same one. */
  onRestart: (phase?: Phase) => void;
  onExit: () => void;
  onReview: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const lineName = useLineName();
  const [phase, setPhase] = useState<Phase>(startPhase);
  const watching = phase === 'watch';
  const [ply, setPly] = useState(0);
  // Moves that went into the review queue, and moves not found at the first try.
  const [missed, setMissed] = useState<Set<number>>(() => new Set());
  const [slipped, setSlipped] = useState<Set<number>>(() => new Set());
  const [wrongAt, setWrongAt] = useState<number | null>(null);
  const [hint, setHint] = useState(false);
  const [boardKey, setBoardKey] = useState(0);

  const total = line.moves.length;
  const done = ply >= total;
  const userTurn = phase !== 'ask' && !done && isUserPly(ply, line.color);
  const { fen, lastMove } = useMemo(() => positionAfter(line.moves, ply), [line.moves, ply]);
  const ownTotal = userMoveCount(line.moves, line.color);
  const ownDone = userMoveCount(line.moves.slice(0, ply), line.color);
  const wrong = wrongAt === ply;

  // Patzer plays the other side after a short pause, so you see each move arrive.
  useEffect(() => {
    if (phase === 'ask' || done || userTurn) return;
    const id = window.setTimeout(() => {
      soundForMove(inferMoveFlagsFromSan(line.moves[ply]!));
      setPly(ply + 1);
    }, ply === 0 ? 700 : 450);
    return () => window.clearTimeout(id);
  }, [phase, ply, done, userTurn, line.moves]);

  const arrows = useMemo(() => {
    if (!(hint || watching) || !userTurn) return [];
    const sq = moveSquares(fen, line.moves[ply]!);
    return sq ? [{ orig: sq[0], dest: sq[1], brush: watching ? 'green' : 'paleBlue' }] : [];
  }, [hint, watching, userTurn, fen, line.moves, ply]);

  function miss(at: number) {
    if (missed.has(at)) return;
    setMissed(new Set(missed).add(at));
    // Into the review queue. The drill carries on even if this fails.
    api.post('/api/openings/trainer/miss', { moves: line.moves.slice(0, at + 1), color: line.color, line_name: line.name, today: localDay() })
      .then(() => qc.invalidateQueries({ queryKey: TRAINER_QUERY_KEY }))
      .catch(() => { /* not worth interrupting the drill for */ });
  }

  function onMove(uci: string) {
    if (!userTurn) { setBoardKey((k) => k + 1); return; }
    const expected = line.moves[ply]!;
    if (isExpectedMove(fen, uci, expected)) {
      soundForMove(inferMoveFlagsFromSan(expected));
      setWrongAt(null);
      setHint(false);
      setPly(ply + 1);
      return;
    }
    setBoardKey((k) => k + 1);
    if (watching) return;
    setSlipped(new Set(slipped).add(ply));
    // One wrong try may be a slip of the finger or a good move of another
    // line; the second one means you don't know it — into the review, and
    // the arrow shows the way on.
    if (wrong) { miss(ply); setHint(true); }
    setWrongAt(ply);
  }

  function showMove() {
    setHint(true);
    setSlipped(new Set(slipped).add(ply));
    miss(ply);
  }

  const firstTry = ownTotal - slipped.size;
  const name = lineName(line.id, line.name);

  let status: React.ReactNode;
  if (phase === 'ask') {
    status = (
      <div className="card space-y-3 p-4">
        <div className="text-sm font-semibold text-chesscom-900 dark:text-chesscom-100">{t('openings.trainer.askTitle')}</div>
        <button onClick={() => setPhase('watch')} className="btn-secondary w-full justify-start text-left text-sm">
          <Eye className="h-4 w-4 shrink-0" />
          <span><span className="font-semibold">{t('openings.trainer.watchFirst')}</span><br /><span className="text-xs font-normal text-chesscom-500">{t('openings.trainer.watchFirstDesc')}</span></span>
        </button>
        <button onClick={() => setPhase('test')} className="btn-secondary w-full justify-start text-left text-sm">
          <Target className="h-4 w-4 shrink-0" />
          <span><span className="font-semibold">{t('openings.trainer.practiseNow')}</span><br /><span className="text-xs font-normal text-chesscom-500">{t('openings.trainer.practiseNowDesc')}</span></span>
        </button>
      </div>
    );
  } else if (done && watching) {
    status = (
      <div className="card border-board-dark bg-board-dark/5 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Eye className="h-4 w-4 text-board-dark" /> {t('openings.trainer.watchedTitle')}
        </div>
        <div className="mt-1 text-sm text-chesscom-700 dark:text-chesscom-200">{t('openings.trainer.watchedText')}</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => onRestart('test')} className="btn-primary flex-1 whitespace-nowrap text-sm">
            <Target className="h-4 w-4" /> {t('openings.trainer.practiseNow')}
          </button>
          <button onClick={() => onRestart('watch')} className="btn-secondary flex-1 whitespace-nowrap text-sm">
            <RotateCcw className="h-4 w-4" /> {t('openings.trainer.watchAgain')}
          </button>
        </div>
      </div>
    );
  } else if (done) {
    status = (
      <div className="card border-board-dark bg-board-dark/5 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Trophy className="h-4 w-4 text-gold-500" /> {t('openings.trainer.doneTitle')}
        </div>
        <div className="mt-1 text-sm text-chesscom-700 dark:text-chesscom-200">
          {t('openings.trainer.doneScore', { first: firstTry, total: ownTotal })}
        </div>
        {missed.size > 0 && <div className="mt-1 text-xs text-chesscom-500">{t('openings.trainer.doneMissed')}</div>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => onRestart()} className="btn-secondary flex-1 text-sm">
            <RotateCcw className="h-4 w-4" /> {t('openings.trainer.again')}
          </button>
          {due > 0 && (
            <button onClick={onReview} className="btn-primary flex-1 whitespace-nowrap text-sm">
              <Repeat className="h-4 w-4" /> {t('openings.trainer.reviewStartN', { n: due })}
            </button>
          )}
        </div>
      </div>
    );
  } else if (userTurn) {
    const text = watching
      ? t('openings.trainer.watchArrow')
      : wrong && hint ? t('openings.trainer.wrongAgain')
        : wrong ? t('openings.trainer.wrong')
          : hint ? t('openings.trainer.playArrow')
            : t('openings.trainer.yourMove');
    status = (
      <div className={`card p-4 ${wrong ? 'border-move-mistake bg-move-mistake/5' : ''}`}>
        <div className="flex items-start gap-2 text-sm text-chesscom-700 dark:text-chesscom-200">
          {wrong
            ? <X className="mt-0.5 h-4 w-4 shrink-0 text-move-mistake" />
            : (hint || watching) && <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-gold-600" />}
          <span>{text}</span>
        </div>
        {!hint && !watching && (
          <button onClick={showMove} className="btn-secondary mt-3 w-full text-sm">
            <Lightbulb className="h-4 w-4" /> {t('openings.trainer.showMove')}
          </button>
        )}
      </div>
    );
  } else {
    status = <div className="card p-4 text-sm text-chesscom-500">{t('openings.trainer.opponentMove')}</div>;
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className={`mx-auto w-full lg:max-w-[600px] lg:flex-1 board-theme-${user?.profile.board_theme ?? 'green'}`}>
        <ChessBoard
          fen={fen}
          orientation={line.color}
          turnColor={sideOfPly(ply)}
          movable={userTurn}
          onMove={onMove}
          lastMove={lastMove as never}
          arrows={arrows as never}
          resetKey={boardKey}
        />
      </div>

      <aside className="space-y-3 lg:w-[340px]">
        <LineHeader name={name} eco={line.eco ?? null} color={line.color}>
          {phase !== 'ask' && (
            <>
              <div className="mt-3 flex items-center justify-between text-xs text-chesscom-500">
                <span>{watching ? t('openings.trainer.watching') : t('openings.trainer.progress', { done: ownDone, total: ownTotal })}</span>
                {missed.size > 0 && <span className="text-move-mistake">{t('openings.trainer.missedCount', { count: missed.size })}</span>}
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-chesscom-100 dark:bg-chesscom-700">
                <div className="h-full rounded-full bg-board-dark transition-all" style={{ width: `${ownTotal ? (ownDone / ownTotal) * 100 : 0}%` }} />
              </div>
            </>
          )}
        </LineHeader>

        {status}

        {phase !== 'ask' && <MovesSoFar moves={line.moves.slice(0, ply)} />}

        <div className="flex gap-2">
          {phase !== 'ask' && !done && (
            <button onClick={() => onRestart()} className="btn-ghost flex-1 text-sm">
              <RotateCcw className="h-4 w-4" /> {t('openings.trainer.restart')}
            </button>
          )}
          <button onClick={onExit} className="btn-ghost flex-1 text-sm">{t('openings.trainer.otherLine')}</button>
        </div>
      </aside>
    </div>
  );
}

// ---- The daily review ----------------------------------------------------

function Review({ learnedAfter, onExit }: { learnedAfter: number; onExit: () => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const lineName = useLineName();
  // One snapshot of today's queue per session — answering reschedules items,
  // and a refetch mid-way would reshuffle the list under your feet.
  const { data, isLoading, isError } = useQuery({
    queryKey: ['opening-trainer-review'],
    queryFn: () => api.get<{ items: ReviewItem[] }>(`/api/openings/trainer/review?today=${localDay()}`),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const items = data?.items ?? [];
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState<ReviewAnswer | null>(null);
  // Whether "show me the move" gave the answer away (rather than a wrong guess).
  const [revealed, setRevealed] = useState(false);
  // After a miss you play the move of the line once yourself, so it sticks.
  const [replayed, setReplayed] = useState(false);
  // A first wrong try, like in the drill: said so, but one more go before
  // the move is given away.
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [right, setRight] = useState(0);
  const [boardKey, setBoardKey] = useState(0);

  const item = items[index] ?? null;
  const missed = !!answer && !answer.correct;
  // Once the move of the line has been played (right away, or after a miss)
  // the board shows it; until then, the position with an arrow after a miss.
  const shown = useMemo(() => {
    if (!item) return null;
    if (answer && (answer.correct || replayed)) {
      return positionAfter([...item.moves, answer.expected_san], item.moves.length + 1);
    }
    return positionAfter(item.moves, item.moves.length);
  }, [item, answer, replayed]);
  const arrows = useMemo(() => {
    if (!missed || replayed) return [];
    const uci = answer!.expected_uci;
    return [{ orig: uci.slice(0, 2), dest: uci.slice(2, 4), brush: 'green' }];
  }, [missed, replayed, answer]);

  async function submit(body: { uci: string; first?: boolean } | { reveal: true }) {
    if (!item) return;
    setBusy(true);
    try {
      const r = await api.post<ReviewAnswer | ReviewRetry>(`/api/openings/trainer/review/${item.id}`, { ...body, today: localDay() });
      if ('retry' in r) {
        setTried(true);
        setBoardKey((k) => k + 1);
        return;
      }
      setAnswer(r);
      setRevealed('reveal' in body);
      if (r.correct) {
        setRight((n) => n + 1);
        soundForMove(inferMoveFlagsFromSan(r.expected_san));
      } else {
        setBoardKey((k) => k + 1);
      }
      void qc.invalidateQueries({ queryKey: TRAINER_QUERY_KEY });
    } catch {
      setBoardKey((k) => k + 1);
    } finally {
      setBusy(false);
    }
  }

  function onMove(uci: string) {
    if (!item || busy) { setBoardKey((k) => k + 1); return; }
    if (!answer) { void submit({ uci, first: !tried }); return; }
    if (missed && !replayed && isExpectedMove(item.fen, uci, answer.expected_san)) {
      setReplayed(true);
      soundForMove(inferMoveFlagsFromSan(answer.expected_san));
      return;
    }
    // Anything else snaps back — and brings the arrow back with it.
    setBoardKey((k) => k + 1);
  }

  function next() {
    setAnswer(null);
    setRevealed(false);
    setReplayed(false);
    setTried(false);
    setIndex((i) => i + 1);
  }

  // Once the move of the line is on the board, the next one follows by itself
  // after a moment to take it in ("Next" skips the wait).
  const settled = !!answer && (answer.correct || replayed);
  useEffect(() => {
    if (!settled) return;
    const id = window.setTimeout(next, answer?.learned ? 2200 : 1400);
    return () => window.clearTimeout(id);
  }, [settled, answer]);

  // "I don't play this any more": out of the queue for good. Not offered once
  // the answer is settled — the auto-advance would move on a second time.
  async function remove() {
    if (!item) return;
    setBusy(true);
    try {
      await api.del(`/api/openings/trainer/review/${item.id}`);
      void qc.invalidateQueries({ queryKey: TRAINER_QUERY_KEY });
      next();
    } catch { /* stays in the queue; nothing else to do */ } finally {
      setBusy(false);
    }
  }

  if (isLoading) return <div className="card p-10 text-center text-sm text-chesscom-500">{t('common.loading')}</div>;
  if (isError) return <div className="card p-10 text-center text-sm text-move-mistake">{t('openings.trainer.loadError')}</div>;

  if (!item || !shown) {
    return (
      <div className="card mx-auto flex max-w-lg flex-col items-center gap-2 p-10 text-center">
        <Trophy className="h-8 w-8 text-gold-500" />
        <div className="text-base font-semibold">{t('openings.trainer.reviewDone')}</div>
        {items.length > 0 && (
          <div className="text-sm text-chesscom-500">{t('openings.trainer.reviewScore', { right, total: items.length })}</div>
        )}
        <button onClick={onExit} className="btn-primary mt-2 text-sm">{t('openings.trainer.back')}</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className={`mx-auto w-full lg:max-w-[600px] lg:flex-1 board-theme-${user?.profile.board_theme ?? 'green'}`}>
        <ChessBoard
          fen={shown.fen}
          orientation={item.color}
          turnColor={item.color}
          movable={!busy && (!answer || (missed && !replayed))}
          onMove={onMove}
          lastMove={shown.lastMove as never}
          arrows={arrows as never}
          resetKey={boardKey}
        />
      </div>

      <aside className="space-y-3 lg:w-[340px]">
        <LineHeader name={item.line_name ? lineName(item.line_id, item.line_name) : t('openings.trainer.myLine')} eco={null} color={item.color}>
          <div className="mt-3 text-xs text-chesscom-500">
            {t('openings.trainer.reviewProgress', { i: index + 1, n: items.length })}
          </div>
        </LineHeader>

        {!answer ? (
          <div className={`card p-4 ${tried ? 'border-move-mistake bg-move-mistake/5' : ''}`}>
            {tried ? (
              <div className="flex items-start gap-2 text-sm text-chesscom-700 dark:text-chesscom-200">
                <X className="mt-0.5 h-4 w-4 shrink-0 text-move-mistake" /> <span>{t('openings.trainer.wrong')}</span>
              </div>
            ) : (
              <>
                <div className="text-sm text-chesscom-700 dark:text-chesscom-200">{t('openings.trainer.reviewTask')}</div>
                <div className="mt-1 text-xs text-chesscom-500">{t('openings.trainer.reviewTaskHint')}</div>
              </>
            )}
            <button onClick={() => void submit({ reveal: true })} disabled={busy} className="btn-secondary mt-3 w-full text-sm">
              <Lightbulb className="h-4 w-4" /> {t('openings.trainer.showMove')}
            </button>
          </div>
        ) : answer.correct ? (
          <div className="card border-board-dark bg-board-dark/5 p-4">
            <div className="flex items-start gap-2 text-sm font-semibold">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-board-dark" /> {t('openings.trainer.correct')}
            </div>
            <div className="mt-1 text-xs text-chesscom-500">
              {answer.learned
                ? t('openings.trainer.learned')
                : t('openings.trainer.backTomorrow', { streak: answer.streak, n: learnedAfter })}
            </div>
            <button onClick={next} className="btn-primary mt-3 w-full text-sm">
              {t('openings.trainer.next')} <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        ) : replayed ? (
          <div className="card border-board-dark bg-board-dark/5 p-4">
            <div className="flex items-start gap-2 text-sm font-semibold">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-board-dark" /> {t('openings.trainer.reviewReplayed', { san: answer.expected_san })}
            </div>
            <div className="mt-1 text-xs text-chesscom-500">{t('openings.trainer.startsOver')}</div>
            <button onClick={next} className="btn-primary mt-3 w-full text-sm">
              {t('openings.trainer.next')} <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className={`card p-4 ${revealed ? 'border-gold-500/60 bg-gold-500/5' : 'border-move-mistake bg-move-mistake/5'}`}>
            <div className="flex items-start gap-2 text-sm font-semibold">
              {revealed
                ? <><Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-gold-600" /> {t('openings.trainer.reviewRevealed', { san: answer.expected_san })}</>
                : <><X className="mt-0.5 h-4 w-4 shrink-0 text-move-mistake" /> {t('openings.trainer.reviewWrong', { san: answer.expected_san })}</>}
            </div>
            <div className="mt-1 text-sm text-chesscom-700 dark:text-chesscom-200">{t('openings.trainer.reviewPlayIt')}</div>
            <button onClick={next} className="btn-secondary mt-3 w-full text-sm">
              {t('openings.trainer.next')} <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        )}

        <MovesSoFar moves={item.moves} />

        <div className="flex gap-2">
          <button onClick={onExit} className="btn-ghost flex-1 text-sm">{t('openings.trainer.back')}</button>
          <button onClick={() => void remove()} disabled={busy || settled} className="btn-ghost flex-1 text-sm" title={t('openings.trainer.removeHint')}>
            <Trash2 className="h-4 w-4" /> {t('openings.trainer.remove')}
          </button>
        </div>
      </aside>
    </div>
  );
}

// ---- Shared bits ---------------------------------------------------------

function LineHeader({ name, eco, color, children }: { name: string; eco: string | null; color: Side; children?: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2">
        {eco && (
          <span className="rounded bg-chesscom-100 px-1.5 py-0.5 font-mono text-[11px] text-chesscom-600 dark:bg-chesscom-900/60 dark:text-chesscom-300">
            {eco}
          </span>
        )}
        <div className="truncate text-sm font-semibold text-chesscom-900 dark:text-chesscom-100">{name}</div>
      </div>
      <div className="mt-1 text-xs text-chesscom-500">
        {color === 'white' ? t('openings.trainer.youPlayWhite') : t('openings.trainer.youPlayBlack')}
      </div>
      {children}
    </div>
  );
}

function MovesSoFar({ moves }: { moves: string[] }) {
  const { t } = useTranslation();
  return (
    <div className="card p-4">
      <div className="text-[11px] uppercase tracking-wider text-chesscom-500">{t('openings.trainer.movesSoFar')}</div>
      <div className="mt-1 font-mono text-sm leading-relaxed text-chesscom-700 dark:text-chesscom-200">
        {formatMoves(moves) || '—'}
      </div>
    </div>
  );
}
