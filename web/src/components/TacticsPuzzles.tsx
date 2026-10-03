// Train → Puzzles: tactic puzzles from the Lichess puzzle database (CC0) that
// ship with Patzer, picked close to your puzzle rating. Like on chess.com: the
// first try counts — a wrong move or a hint and the puzzle is lost for the
// rating, but you can still find the rest of the solution.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, Eye, Lightbulb, RotateCcw, Trophy, TrendingDown, TrendingUp, X, Zap } from 'lucide-react';
import ChessBoard from './ChessBoard';
import { api } from '../api';
import { useAuth } from '../state/auth';
import { soundForMove, inferMoveFlagsFromSan } from '../lib/sounds';
import { isRightMove, playerOf, positionAt, sanAt, type TacticsPuzzle } from '../lib/tactics';

interface Stats {
  rating: number;
  provisional: boolean;
  best: number;
  played: number;
  solved: number;
  recent: { solved: boolean; rating: number }[];
  total: number;
}
interface Attempt { rated: boolean; rating_before: number; rating_after: number }

const THEMES = ['mate', 'fork', 'pin', 'discovered', 'sacrifice', 'hanging', 'defence', 'endgame'] as const;
const STATS_KEY = ['tactics-stats'];

// 'play': your move; 'wrong': a wrong try, the board went back; 'solved': the
// line is done; 'shown': "show me" played the rest for you.
type Status = 'play' | 'wrong' | 'solved' | 'shown';

export default function TacticsPuzzles() {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<string | null>(null);
  const [run, setRun] = useState(0);
  const { data: stats } = useQuery({ queryKey: STATS_KEY, queryFn: () => api.get<Stats>('/api/tactics/stats') });
  const { data, isLoading, isError } = useQuery({
    queryKey: ['tactics-next', theme, run],
    queryFn: () => api.get<{ puzzle: TacticsPuzzle | null }>(`/api/tactics/next${theme ? `?theme=${theme}` : ''}`),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <ThemeChip active={theme === null} onClick={() => { setTheme(null); setRun((r) => r + 1); }} label={t('train.puzzles.themes.all')} />
        {THEMES.map((th) => (
          <ThemeChip key={th} active={theme === th} onClick={() => { setTheme(th); setRun((r) => r + 1); }} label={t(`train.puzzles.themes.${th}`)} />
        ))}
      </div>

      {isLoading && <div className="card p-10 text-center text-sm text-chesscom-500">{t('common.loading')}</div>}
      {isError && <div className="card p-10 text-center text-sm text-move-mistake">{t('train.puzzles.loadError')}</div>}
      {data && !data.puzzle && (
        <div className="card flex flex-col items-center gap-2 p-10 text-center">
          <Trophy className="h-8 w-8 text-gold-500" />
          <div className="text-base font-semibold">{t('train.puzzles.allDone')}</div>
          {theme && <button onClick={() => setTheme(null)} className="btn-secondary mt-2 text-sm">{t('train.puzzles.themes.all')}</button>}
        </div>
      )}
      {data?.puzzle && (
        <Puzzle key={`${data.puzzle.id}-${run}`} puzzle={data.puzzle} stats={stats ?? null} onNext={() => setRun((r) => r + 1)} />
      )}
    </div>
  );
}

function ThemeChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
        active
          ? 'border-board-dark bg-board-dark/10 font-semibold text-chesscom-900 dark:text-chesscom-100'
          : 'border-chesscom-200 text-chesscom-600 hover:bg-chesscom-100 dark:border-chesscom-700 dark:text-chesscom-300 dark:hover:bg-chesscom-700/40'
      }`}
    >
      {label}
    </button>
  );
}

function Puzzle({ puzzle, stats, onNext }: { puzzle: TacticsPuzzle; stats: Stats | null; onNext: () => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const player = playerOf(puzzle);
  // How many moves of the line are on the board. 0: the opponent's first
  // move is still to come.
  const [n, setN] = useState(0);
  const [status, setStatus] = useState<Status>('play');
  // The first try: lost with the first wrong move or hint (sent once).
  const [clean, setClean] = useState(true);
  const [hint, setHint] = useState<'none' | 'piece' | 'move'>('none');
  const [result, setResult] = useState<Attempt | null>(null);
  const [boardKey, setBoardKey] = useState(0);

  const pos = useMemo(() => positionAt(puzzle, n), [puzzle, n]);
  const done = n >= puzzle.moves.length;
  const yourTurn = !done && n % 2 === 1 && (status === 'play' || status === 'wrong');

  function send(solved: boolean) {
    api.post<Attempt>('/api/tactics/attempt', { id: puzzle.id, solved })
      .then((r) => { setResult(r); void qc.invalidateQueries({ queryKey: STATS_KEY }); })
      .catch(() => { /* the puzzle goes on; the rating just didn't change */ });
  }
  function lose() {
    if (!clean) return;
    setClean(false);
    send(false);
  }

  // The opponent's moves (the first one, and each reply) after a short pause.
  useEffect(() => {
    if (done || n % 2 === 1 || status === 'solved') return;
    const id = window.setTimeout(() => {
      soundForMove(inferMoveFlagsFromSan(sanAt(puzzle, n)));
      setN(n + 1);
    }, n === 0 ? 700 : 450);
    return () => window.clearTimeout(id);
  }, [n, done, status, puzzle]);

  // "Show me": play the rest of the line, one move at a time.
  useEffect(() => {
    if (status !== 'shown' || done || n % 2 === 0) return;
    const id = window.setTimeout(() => {
      soundForMove(inferMoveFlagsFromSan(sanAt(puzzle, n)));
      setN(n + 1);
    }, 700);
    return () => window.clearTimeout(id);
  }, [status, n, done, puzzle]);

  function onMove(uci: string) {
    if (!yourTurn) { setBoardKey((k) => k + 1); return; }
    if (isRightMove(puzzle, n, uci)) {
      soundForMove(inferMoveFlagsFromSan(sanAt(puzzle, n)));
      setHint('none');
      setStatus('play');
      if (n + 1 >= puzzle.moves.length) {
        setN(puzzle.moves.length);
        setStatus('solved');
        if (clean) send(true);
      } else {
        setN(n + 1);
      }
      return;
    }
    setBoardKey((k) => k + 1);
    setStatus('wrong');
    lose();
  }

  function showHint() {
    lose();
    setHint(hint === 'none' ? 'piece' : 'move');
  }

  function showSolution() {
    lose();
    setHint('none');
    setStatus('shown');
  }

  const arrows = useMemo(() => {
    if (!yourTurn || hint === 'none') return [];
    const uci = puzzle.moves[n]!;
    return hint === 'piece'
      ? [{ orig: uci.slice(0, 2), brush: 'paleBlue' }]
      : [{ orig: uci.slice(0, 2), dest: uci.slice(2, 4), brush: 'paleBlue' }];
  }, [yourTurn, hint, puzzle, n]);

  const finished = status === 'solved' || (status === 'shown' && done);
  const delta = result?.rated ? result.rating_after - result.rating_before : null;

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className={`mx-auto w-full lg:max-w-[640px] lg:flex-1 board-theme-${user?.profile.board_theme ?? 'green'}`}>
        <ChessBoard
          fen={pos.fen}
          orientation={player}
          turnColor={pos.turn}
          movable={yourTurn}
          onMove={onMove}
          lastMove={pos.lastMove as never}
          arrows={arrows as never}
          resetKey={boardKey}
        />
      </div>

      <aside className="space-y-3 lg:w-[340px]">
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-wider text-chesscom-500">{t('train.puzzles.yourRating')}</div>
            {stats && <div className="text-[11px] text-chesscom-400">{t('train.puzzles.solvedOf', { solved: stats.solved, played: stats.played })}</div>}
          </div>
          <div className="mt-1 flex items-end gap-2">
            <span className="font-mono text-3xl font-bold tabular-nums text-chesscom-900 dark:text-chesscom-100">
              {result?.rated ? result.rating_after : stats?.rating ?? '—'}{stats?.provisional && '?'}
            </span>
            {delta !== null && (
              <span className={`mb-1 flex items-center gap-0.5 font-mono text-sm font-semibold ${delta >= 0 ? 'text-board-dark' : 'text-move-mistake'}`}>
                {delta >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                {delta >= 0 ? `+${delta}` : delta}
              </span>
            )}
          </div>
          {stats?.provisional && <div className="mt-1 text-[11px] text-chesscom-400">{t('train.puzzles.provisional')}</div>}
        </div>

        <div className={`card p-4 ${status === 'wrong' ? 'border-move-mistake bg-move-mistake/5' : finished && status === 'solved' ? 'border-board-dark bg-board-dark/5' : ''}`}>
          {!finished && status !== 'wrong' && (
            <div className="text-sm font-semibold text-chesscom-900 dark:text-chesscom-100">
              {n === 0 ? t('train.puzzles.watch') : player === 'white' ? t('train.puzzles.findWhite') : t('train.puzzles.findBlack')}
            </div>
          )}
          {status === 'wrong' && (
            <div className="flex items-start gap-2 text-sm text-chesscom-700 dark:text-chesscom-200">
              <X className="mt-0.5 h-4 w-4 shrink-0 text-move-mistake" /> <span>{t('train.puzzles.wrong')}</span>
            </div>
          )}
          {finished && status === 'solved' && (
            <div className="flex items-start gap-2 text-sm font-semibold">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-board-dark" /> {clean ? t('train.puzzles.solved') : t('train.puzzles.solvedLate')}
            </div>
          )}
          {status === 'shown' && (
            <div className="flex items-start gap-2 text-sm text-chesscom-700 dark:text-chesscom-200">
              <Eye className="mt-0.5 h-4 w-4 shrink-0 text-gold-600" /> {done ? t('train.puzzles.shownDone') : t('train.puzzles.showing')}
            </div>
          )}
          {!clean && !finished && status !== 'shown' && <div className="mt-1 text-xs text-chesscom-500">{t('train.puzzles.notRated')}</div>}

          {!finished && status !== 'shown' && n > 0 && (
            <div className="mt-3 flex gap-2">
              <button onClick={showHint} disabled={hint === 'move'} className="btn-secondary flex-1 text-sm">
                <Lightbulb className="h-4 w-4" /> {hint === 'none' ? t('train.puzzles.hint') : t('train.puzzles.hintMove')}
              </button>
              <button onClick={showSolution} className="btn-secondary flex-1 text-sm">
                <Eye className="h-4 w-4" /> {t('train.puzzles.solution')}
              </button>
            </div>
          )}
          {(finished || status === 'shown') && (
            <div className="mt-3 flex gap-2">
              {status === 'shown' && done && (
                <button onClick={() => { setN(1); setStatus('play'); setBoardKey((k) => k + 1); }} className="btn-secondary flex-1 text-sm">
                  <RotateCcw className="h-4 w-4" /> {t('train.puzzles.tryIt')}
                </button>
              )}
              <button onClick={onNext} disabled={!done} className="btn-primary flex-1 text-sm">
                {t('train.puzzles.next')} <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>

        <div className="card flex items-center justify-between p-3 text-xs text-chesscom-500">
          <span className="flex items-center gap-1.5"><Zap className="h-3.5 w-3.5 text-gold-600" /> {t('train.puzzles.puzzleRating', { rating: puzzle.rating })}</span>
          {finished && (
            <a href={`https://lichess.org/training/${puzzle.id}`} target="_blank" rel="noreferrer noopener" className="underline-offset-2 hover:underline">
              {t('train.puzzles.onLichess')}
            </a>
          )}
        </div>
        {!finished && status !== 'shown' && <div className="px-1 text-[11px] leading-relaxed text-chesscom-400">{t('train.puzzles.rules')}</div>}
      </aside>
    </div>
  );
}
