// Tactic Trainer — solve puzzles extracted from your own analyzed games.
// The point: chess.com puzzles are generic. Patzer's are *yours* — every
// position is a real moment from your own play where you missed something.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Target, RotateCcw, ArrowRight, Lightbulb, Check, X, Trophy, BookOpen } from 'lucide-react';
import ChessBoard from '../components/ChessBoard';
import { api } from '../api';
import { useAuth } from '../state/auth';

interface Puzzle {
  game_id: number;
  ply: number;
  fen: string;
  side_to_move: 'white' | 'black';
  played_san: string;
  played_uci: string;
  best_san: string;
  best_uci: string;
  best_pv: string[];
  classification: string;
  centipawn_loss: number;
  eval_before_cp: number | null;
  end_time: string | null;
  white: string;
  black: string;
}

interface Stats { total: number; solved: number; failed: number; accuracy: number }

export default function Train() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['train-next'],
    queryFn: () => api.get<{ puzzle: Puzzle | null }>('/api/train/next'),
  });

  const { data: stats } = useQuery({
    queryKey: ['train-stats'],
    queryFn: () => api.get<Stats>('/api/train/stats'),
  });

  const [outcome, setOutcome] = useState<null | { solved: boolean; expected_san: string; expected_uci: string; explanation_pv: string[] }>(null);
  const [showHint, setShowHint] = useState(false);
  const [boardKey, setBoardKey] = useState(0); // force board reset on retry

  const puzzle = data?.puzzle ?? null;

  useEffect(() => { setOutcome(null); setShowHint(false); }, [puzzle?.game_id, puzzle?.ply]);

  const attempt = useMutation({
    mutationFn: (uci: string) => api.post<{ solved: boolean; expected_san: string; expected_uci: string; explanation_pv: string[] }>(
      '/api/train/attempt',
      { game_id: puzzle!.game_id, ply: puzzle!.ply, attempted_uci: uci },
    ),
    onSuccess: (r) => {
      setOutcome(r);
      qc.invalidateQueries({ queryKey: ['train-stats'] });
    },
  });

  function tryAgain() {
    setOutcome(null);
    setShowHint(false);
    setBoardKey((k) => k + 1);
  }

  function next() {
    setOutcome(null);
    setShowHint(false);
    void refetch();
  }

  const orientation = puzzle?.side_to_move ?? 'white';
  const turnColor = puzzle?.side_to_move ?? 'white';
  const arrows = useMemo(() => {
    if (!showHint || !puzzle) return [];
    return [{ orig: puzzle.best_uci.slice(0, 2), dest: puzzle.best_uci.slice(2, 4), brush: 'paleBlue' as const }];
  }, [showHint, puzzle]);

  if (isLoading) return <div className="card p-10 text-center text-sm text-chesscom-500">{t('common.loading')}</div>;

  if (!puzzle) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <header>
          <h1 className="page-h1 flex items-center gap-2"><Target className="h-6 w-6 text-board-dark" />{t('train.title', { defaultValue: 'Tactic Trainer' })}</h1>
          <p className="page-sub">{t('train.intro', { defaultValue: 'Personal puzzles drawn from your own analyzed games.' })}</p>
        </header>
        <div className="card flex flex-col items-center gap-3 p-10 text-center">
          <Trophy className="h-8 w-8 text-gold-500" />
          <div className="text-base font-semibold">{t('train.allClear', { defaultValue: "Nothing to train — you're caught up." })}</div>
          <p className="max-w-md text-sm text-chesscom-500">{t('train.allClearDesc', { defaultValue: 'Play more games and analyze them to unlock new puzzles. Every blunder you fix here is a pattern you stop repeating in real games.' })}</p>
          <div className="mt-2 flex gap-2">
            <Link to="/play" className="btn-primary text-sm">{t('home.playTitle')}</Link>
            <Link to="/review" className="btn-secondary text-sm">{t('review.title')}</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="page-h1 flex items-center gap-2"><Target className="h-6 w-6 text-board-dark" />{t('train.title', { defaultValue: 'Tactic Trainer' })}</h1>
          <p className="page-sub">{t('train.intro', { defaultValue: 'Personal puzzles drawn from your own analyzed games.' })}</p>
        </div>
        {stats && (
          <div className="flex items-center gap-3 text-xs text-chesscom-500">
            <Stat label={t('train.solved', { defaultValue: 'Solved' })} value={stats.solved} tone="text-board-dark" />
            <Stat label={t('train.failed', { defaultValue: 'Failed' })} value={stats.failed} tone="text-mistake" />
            <Stat label={t('train.accuracy', { defaultValue: 'Accuracy' })} value={`${stats.accuracy}%`} />
          </div>
        )}
      </header>

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className={`mx-auto w-full lg:flex-1 lg:max-w-[640px] board-theme-${user?.profile.board_theme ?? 'green'}`}>
          <div className="mb-2 flex items-center justify-between rounded-md bg-white px-3 py-2 text-xs shadow-soft dark:bg-chesscom-800">
            <span className="font-medium text-chesscom-700 dark:text-chesscom-200">
              {puzzle.side_to_move === 'white' ? t('train.whiteToMove', { defaultValue: 'White to move' }) : t('train.blackToMove', { defaultValue: 'Black to move' })}
            </span>
            <span className="font-mono text-xs tabular-nums text-chesscom-500">
              {t('train.fromYourGame', { defaultValue: 'From your game · {{w}} vs {{b}}', w: puzzle.white, b: puzzle.black })}
            </span>
          </div>
          <ChessBoard
            fen={puzzle.fen}
            orientation={orientation}
            turnColor={turnColor}
            movable={!outcome?.solved}
            onMove={(uci) => attempt.mutate(uci)}
            arrows={arrows as never}
            resetKey={boardKey}
          />
        </div>

        <aside className="lg:w-[340px] space-y-3">
          <div className="card p-4">
            <div className="text-[11px] uppercase tracking-wider text-chesscom-500">{t('train.taskTitle', { defaultValue: "Find the move you missed" })}</div>
            <div className="mt-1 text-sm text-chesscom-700 dark:text-chesscom-200">
              {t('train.taskBody', { defaultValue: 'In the actual game you played {{played}}. Find a stronger move.', played: puzzle.played_san })}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-chesscom-500">
              <span className={`badge ${tagTone(puzzle.classification)}`}>{puzzle.classification}</span>
              {puzzle.centipawn_loss > 0 && <span>−{(puzzle.centipawn_loss / 100).toFixed(1)} pawn equivalent</span>}
            </div>
          </div>

          {!outcome && (
            <button
              onClick={() => setShowHint((s) => !s)}
              className="btn-secondary w-full text-sm"
            >
              <Lightbulb className="h-4 w-4" /> {showHint ? t('train.hideHint', { defaultValue: 'Hide hint' }) : t('train.showHint', { defaultValue: 'Show hint arrow' })}
            </button>
          )}

          {outcome && (
            <div className={`card p-4 ${outcome.solved ? 'border-board-dark bg-board-dark/5' : 'border-mistake bg-mistake/5'}`}>
              <div className="flex items-center gap-2 text-sm font-semibold">
                {outcome.solved
                  ? <><Check className="h-4 w-4 text-board-dark" /> {t('train.correct', { defaultValue: 'Correct!' })}</>
                  : <><X className="h-4 w-4 text-mistake" /> {t('train.wrong', { defaultValue: 'Not quite — the engine prefers' })} <span className="font-mono">{outcome.expected_san}</span></>
                }
              </div>
              {outcome.explanation_pv.length > 0 && (
                <div className="mt-2 text-xs text-chesscom-500">
                  PV: <span className="font-mono">{outcome.explanation_pv.slice(0, 5).join(' ')}</span>
                </div>
              )}
              <div className="mt-3 flex gap-2">
                {!outcome.solved && (
                  <button onClick={tryAgain} className="btn-secondary flex-1 text-sm">
                    <RotateCcw className="h-4 w-4" /> {t('train.tryAgain', { defaultValue: 'Try again' })}
                  </button>
                )}
                <button onClick={next} className="btn-primary flex-1 text-sm">
                  {t('train.nextPuzzle', { defaultValue: 'Next puzzle' })} <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          <Link to={`/review/${puzzle.game_id}?ply=${puzzle.ply}`} className="card-hover flex items-center gap-2 p-3 text-xs">
            <BookOpen className="h-4 w-4 text-chesscom-400" />
            <span className="text-chesscom-600 dark:text-chesscom-200">{t('train.openInReview', { defaultValue: 'Open this position in the full review' })}</span>
          </Link>
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="flex flex-col items-end leading-tight">
      <span className="text-[10px] uppercase tracking-wide text-chesscom-400">{label}</span>
      <span className={`font-mono text-sm font-semibold tabular-nums ${tone ?? 'text-chesscom-700 dark:text-chesscom-200'}`}>{value}</span>
    </div>
  );
}

function tagTone(c: string): string {
  if (c === 'blunder') return 'bg-mistake/15 text-mistake';
  if (c === 'mistake') return 'bg-gold-500/15 text-gold-700 dark:text-gold-400';
  if (c === 'miss') return 'bg-mistake/10 text-mistake';
  return 'bg-chesscom-100 text-chesscom-600 dark:bg-chesscom-700/40 dark:text-chesscom-300';
}
