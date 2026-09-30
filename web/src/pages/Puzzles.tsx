// Puzzles from the Lichess puzzle database, filtered by theme and difficulty.
// Train is the other puzzle page: positions from your own games.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Key } from 'chessground/types';
import { Puzzle as PuzzleIcon, ArrowRight, Eye, Check, X, Cloud, HardDrive, Download, Trash2, ExternalLink, RotateCcw } from 'lucide-react';
import ChessBoard from '../components/ChessBoard';
import { api } from '../api';
import { useAuth } from '../state/auth';
import { cn } from '../lib/utils';
import { judgeMove, puzzleStart, solutionLine, solverColor, type LichessPuzzle, type PuzzlePosition } from '../lib/puzzle';

type Source = 'online' | 'local';

interface LocalStatus {
  state: 'missing' | 'downloading' | 'ready' | 'error';
  count: number;
  imported_at: string | null;
  size_bytes: number;
  downloaded_bytes: number;
  total_bytes: number | null;
  imported_rows: number;
  error: string | null;
}

interface Status {
  local: LocalStatus;
  themes: { key: string; themes: string[] }[];
  difficulties: string[];
  rating: number;
  played: number;
  solved: number;
}

type Phase = 'play' | 'wrong' | 'solved' | 'revealed';

const PREFS_KEY = 'patzer.puzzlePrefs';
interface Prefs { source: Source; theme: string; difficulty: string }

function readPrefs(): Prefs {
  const fallback: Prefs = { source: 'online', theme: 'mix', difficulty: 'normal' };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...fallback, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch { /* storage blocked or bad JSON */ }
  return fallback;
}

const mb = (n: number) => `${Math.round(n / 1_000_000)} MB`;

export default function Puzzles() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.role === 'admin';

  const [prefs, setPrefsState] = useState<Prefs>(readPrefs);
  function setPrefs(patch: Partial<Prefs>) {
    setPrefsState((p) => {
      const next = { ...p, ...patch };
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* storage blocked */ }
      return next;
    });
  }

  const status = useQuery({
    queryKey: ['puzzles-status'],
    queryFn: () => api.get<Status>('/api/puzzles/status'),
    // Poll only while a download is running, for its progress bar.
    refetchInterval: (q) => (q.state.data?.local.state === 'downloading' ? 2000 : false),
  });
  const local = status.data?.local;
  const localReady = local?.state === 'ready';
  const source: Source = prefs.source;
  // "On this server" before the download finishes shows the download panel,
  // not a puzzle.
  const canServe = source === 'online' || localReady;

  // `round` makes "next puzzle" a new query even with the same filters.
  const [round, setRound] = useState(0);
  const next = useQuery({
    queryKey: ['puzzle-next', source, prefs.theme, prefs.difficulty, round],
    queryFn: () => api.get<{ puzzle: LichessPuzzle | null }>(
      `/api/puzzles/next?${new URLSearchParams({ source, theme: prefs.theme, difficulty: prefs.difficulty }).toString()}`,
    ),
    enabled: !!status.data && canServe,
    staleTime: Infinity,
    retry: false,
  });
  const puzzle = next.data?.puzzle ?? null;

  const [pos, setPos] = useState<PuzzlePosition | null>(null);
  const [phase, setPhase] = useState<Phase>('play');
  const [boardKey, setBoardKey] = useState(0);
  const [result, setResult] = useState<{ delta: number; counted: boolean } | null>(null);
  const reported = useRef(false);
  const timers = useRef<number[]>([]);

  function clearTimers() {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  }

  useEffect(() => {
    clearTimers();
    reported.current = false;
    setResult(null);
    setPhase('play');
    if (!puzzle) { setPos(null); return; }
    try {
      // Show the position before the opponent's move for a moment, so the
      // solver sees the move they are answering.
      setPos({ fen: puzzle.fen, next: 0, lastMove: null });
      timers.current.push(window.setTimeout(() => setPos(puzzleStart(puzzle)), 500));
    } catch {
      setPos(null);
    }
    return clearTimers;
  }, [puzzle]);

  const attempt = useMutation({
    mutationFn: (solved: boolean) => api.post<{ rating: number; delta: number; counted: boolean }>('/api/puzzles/attempt', {
      puzzle_id: puzzle!.id, puzzle_rating: puzzle!.rating, themes: puzzle!.themes, solved,
    }),
    onSuccess: (r) => {
      setResult({ delta: r.delta, counted: r.counted });
      qc.invalidateQueries({ queryKey: ['puzzles-status'] });
    },
  });

  // Only the first outcome counts: a mistake, a peek at the solution, or a clean solve.
  function report(solved: boolean) {
    if (reported.current || !puzzle) return;
    reported.current = true;
    attempt.mutate(solved);
  }

  function onMove(uci: string) {
    if (!puzzle || !pos || phase === 'solved' || phase === 'revealed') return;
    const v = judgeMove(puzzle, pos, uci);
    if (v.kind === 'wrong') {
      setPhase('wrong');
      report(false);
      setBoardKey((k) => k + 1); // put the piece back
      return;
    }
    if (v.kind === 'solved') {
      setPos(v.position);
      setPhase('solved');
      report(true);
      return;
    }
    setPhase('play');
    setPos(v.afterMove);
    timers.current.push(window.setTimeout(() => setPos(v.position), 400));
  }

  function reveal() {
    if (!puzzle || !pos) return;
    report(false);
    setPhase('revealed');
    const line = solutionLine(puzzle, pos);
    line.forEach((p, i) => timers.current.push(window.setTimeout(() => setPos(p), 600 * (i + 1))));
  }

  function nextPuzzle() {
    setRound((r) => r + 1);
  }

  const download = useMutation({
    mutationFn: () => api.post<{ local: LocalStatus }>('/api/puzzles/local/download'),
    onSettled: () => qc.invalidateQueries({ queryKey: ['puzzles-status'] }),
  });
  const removeLocal = useMutation({
    mutationFn: () => api.del<{ local: LocalStatus }>('/api/puzzles/local'),
    onSettled: () => qc.invalidateQueries({ queryKey: ['puzzles-status'] }),
  });

  const color = puzzle ? solverColor(puzzle) : 'white';
  const turn = pos ? (pos.fen.split(' ')[1] === 'w' ? 'white' : 'black') : color;
  const movable = !!pos && pos.next > 0 && turn === color && (phase === 'play' || phase === 'wrong');
  const done = phase === 'solved' || phase === 'revealed';

  const nextError = next.error ? (next.error as Error).message : null;

  const themeOptions = useMemo(() => status.data?.themes ?? [], [status.data]);

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="page-h1 flex items-center gap-2"><PuzzleIcon className="h-6 w-6 text-board-dark" />{t('puzzles.title')}</h1>
          <p className="page-sub">{t('puzzles.intro')}</p>
        </div>
        {status.data && (
          <div className="flex items-center gap-4 text-xs text-chesscom-500">
            <Stat label={t('puzzles.rating')} value={status.data.rating} tone="text-board-dark" />
            <Stat label={t('puzzles.solved')} value={`${status.data.solved} / ${status.data.played}`} />
          </div>
        )}
      </header>

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className={`mx-auto w-full lg:flex-1 lg:max-w-[640px] board-theme-${user?.profile.board_theme ?? 'green'}`}>
          <div className="mb-2 flex items-center justify-between rounded-md bg-white px-3 py-2 text-xs shadow-soft dark:bg-chesscom-800">
            <span className="font-medium text-chesscom-700 dark:text-chesscom-200">
              {puzzle ? t(color === 'white' ? 'puzzles.findWhite' : 'puzzles.findBlack') : ' '}
            </span>
            {puzzle && (
              <span className="font-mono tabular-nums text-chesscom-500">
                {t('puzzles.puzzleRating', { n: puzzle.rating })}
              </span>
            )}
          </div>
          <ChessBoard
            fen={pos?.fen ?? '8/8/8/8/8/8/8/8 w - - 0 1'}
            orientation={color}
            turnColor={turn}
            movable={movable}
            onMove={onMove}
            lastMove={pos?.lastMove ? (pos.lastMove as [Key, Key]) : undefined}
            resetKey={boardKey}
          />
        </div>

        <aside className="space-y-3 lg:w-[360px]">
          {/* Source: two separate ways to get puzzles. */}
          {status.data && local && (
            <div className="card space-y-3 p-4">
              <div className="text-[11px] uppercase tracking-wider text-chesscom-500">{t('puzzles.source.title')}</div>
              <div className="grid grid-cols-2 gap-2">
                <SourceButton active={source === 'online'} onClick={() => { setPrefs({ source: 'online' }); nextPuzzle(); }} icon={Cloud} label={t('puzzles.source.online')} />
                <SourceButton active={source === 'local'} onClick={() => { setPrefs({ source: 'local' }); nextPuzzle(); }} icon={HardDrive} label={t('puzzles.source.local')} />
              </div>

              {source === 'online' && <p className="text-xs text-chesscom-500">{t('puzzles.source.onlineDesc')}</p>}

              {source === 'local' && (
                <>
                  <p className="text-xs text-chesscom-500">
                    {localReady ? t('puzzles.source.localDesc', { n: local.count.toLocaleString() }) : t('puzzles.source.localMissing')}
                  </p>
                  {local.state === 'downloading' && (
                    <div className="space-y-1">
                      <div className="h-1.5 overflow-hidden rounded bg-chesscom-100 dark:bg-chesscom-700">
                        <div
                          className="h-full bg-board-dark transition-all"
                          style={{ width: `${local.total_bytes ? Math.min(100, (local.downloaded_bytes / local.total_bytes) * 100) : 5}%` }}
                        />
                      </div>
                      <div className="text-xs text-chesscom-500">
                        {t('puzzles.source.progress', {
                          done: mb(local.downloaded_bytes),
                          total: local.total_bytes ? mb(local.total_bytes) : '?',
                          rows: local.imported_rows.toLocaleString(),
                        })}
                      </div>
                    </div>
                  )}
                  {local.state === 'error' && local.error && (
                    <div className="text-xs text-bad">{t(`puzzles.source.error.${local.error}`, { defaultValue: t('puzzles.source.error.generic', { code: local.error }) })}</div>
                  )}
                  {isAdmin ? (
                    <div className="flex flex-wrap gap-2">
                      {local.state !== 'downloading' && (
                        <button onClick={() => download.mutate()} disabled={download.isPending} className={cn('text-xs', localReady ? 'btn-secondary' : 'btn-primary')}>
                          <Download className="h-3.5 w-3.5" /> {localReady ? t('puzzles.source.update') : t('puzzles.source.download')}
                        </button>
                      )}
                      {(localReady || local.state === 'downloading') && (
                        <button onClick={() => removeLocal.mutate()} disabled={removeLocal.isPending} className="btn-secondary text-xs">
                          {local.state === 'downloading'
                            ? <><X className="h-3.5 w-3.5" /> {t('puzzles.source.cancel')}</>
                            : <><Trash2 className="h-3.5 w-3.5" /> {t('puzzles.source.delete', { size: mb(local.size_bytes) })}</>}
                        </button>
                      )}
                    </div>
                  ) : (
                    !localReady && <p className="text-xs text-chesscom-400">{t('puzzles.source.askAdmin')}</p>
                  )}
                  {isAdmin && !localReady && local.state !== 'downloading' && (
                    <p className="text-xs text-chesscom-400">{t('puzzles.source.downloadNote')}</p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Filters */}
          <div className="card space-y-3 p-4">
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-chesscom-500">{t('puzzles.theme')}</span>
              <select
                value={prefs.theme}
                onChange={(e) => { setPrefs({ theme: e.target.value }); nextPuzzle(); }}
                className="input mt-1 text-sm"
              >
                {themeOptions.map((g) => (
                  <optgroup key={g.key} label={t(`puzzles.group.${g.key}`)}>
                    {g.themes.map((th) => (
                      <option key={`${g.key}-${th}`} value={th}>{t(`puzzles.themes.${th}`)}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <div>
              <span className="text-[11px] uppercase tracking-wider text-chesscom-500">{t('puzzles.difficulty')}</span>
              <div className="mt-1 grid grid-cols-5 gap-1">
                {(status.data?.difficulties ?? []).map((d) => (
                  <button
                    key={d}
                    onClick={() => { setPrefs({ difficulty: d }); nextPuzzle(); }}
                    className={cn(
                      'rounded-md border px-1 py-1.5 text-[11px] font-medium transition-colors',
                      prefs.difficulty === d
                        ? 'border-board-dark bg-board-dark/10 text-board-dark dark:text-chesscom-100'
                        : 'border-chesscom-200 text-chesscom-600 hover:bg-chesscom-50 dark:border-chesscom-700 dark:text-chesscom-300 dark:hover:bg-chesscom-800',
                    )}
                  >
                    {t(`puzzles.diff.${d}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* The puzzle */}
          {canServe && (
          <div className="card p-4">
            {next.isFetching && <div className="text-sm text-chesscom-500">{t(source === 'online' ? 'puzzles.loadingOnline' : 'puzzles.loading')}</div>}
            {!next.isFetching && nextError && (
              <div className="text-sm text-bad">{t(`puzzles.error.${nextError}`, { defaultValue: t('puzzles.error.generic') })}</div>
            )}
            {!next.isFetching && !nextError && next.data && !puzzle && (
              <div className="text-sm text-chesscom-500">{t(source === 'online' ? 'puzzles.noneFoundOnline' : 'puzzles.noneFound')}</div>
            )}
            {!next.isFetching && puzzle && (
              <>
                <PhaseLine phase={phase} result={result} />
                {done && (
                  <div className="mt-3 space-y-1 text-xs text-chesscom-500">
                    <div className="flex flex-wrap gap-1">
                      {puzzle.themes.map((th) => (
                        <span key={th} className="badge bg-chesscom-100 text-chesscom-600 dark:bg-chesscom-700/40 dark:text-chesscom-300">
                          {t(`puzzles.themes.${th}`, { defaultValue: th })}
                        </span>
                      ))}
                    </div>
                    {puzzle.opening && <div>{puzzle.opening}</div>}
                    {puzzle.game_url && (
                      <a href={puzzle.game_url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-board-dark hover:underline">
                        {t('puzzles.viewGame')} <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                )}
                <div className="mt-3 flex gap-2">
                  {!done && (
                    <button onClick={reveal} className="btn-secondary flex-1 text-sm">
                      <Eye className="h-4 w-4" /> {t('puzzles.viewSolution')}
                    </button>
                  )}
                  {done && (
                    <button onClick={() => { const p = puzzle; clearTimers(); setPhase('play'); setPos(puzzleStart(p)); setBoardKey((k) => k + 1); }} className="btn-secondary flex-1 text-sm">
                      <RotateCcw className="h-4 w-4" /> {t('puzzles.retry')}
                    </button>
                  )}
                  <button onClick={nextPuzzle} className={cn('flex-1 text-sm', done ? 'btn-primary' : 'btn-secondary')}>
                    {done ? t('puzzles.next') : t('puzzles.skip')} <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </>
            )}
          </div>
          )}

        </aside>
      </div>
    </div>
  );
}

function PhaseLine({ phase, result }: { phase: Phase; result: { delta: number; counted: boolean } | null }) {
  const { t } = useTranslation();
  const delta = result?.counted ? (
    <span className={cn('ms-2 font-mono text-xs', result.delta >= 0 ? 'text-board-dark' : 'text-mistake')}>
      {result.delta >= 0 ? `+${result.delta}` : result.delta}
    </span>
  ) : null;
  if (phase === 'solved') {
    return <div className="flex items-center gap-2 text-sm font-semibold"><Check className="h-4 w-4 text-board-dark" /> {t('puzzles.solvedMsg')}{delta}</div>;
  }
  if (phase === 'revealed') {
    return <div className="flex items-center gap-2 text-sm font-semibold"><Eye className="h-4 w-4 text-chesscom-400" /> {t('puzzles.revealedMsg')}{delta}</div>;
  }
  if (phase === 'wrong') {
    return <div className="flex items-center gap-2 text-sm font-semibold"><X className="h-4 w-4 text-mistake" /> {t('puzzles.wrongMsg')}{delta}</div>;
  }
  return <div className="text-sm text-chesscom-700 dark:text-chesscom-200">{t('puzzles.yourTurn')}</div>;
}

function SourceButton({ active, disabled, onClick, icon: Icon, label }: {
  active: boolean; disabled?: boolean; onClick: () => void; icon: typeof Cloud; label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        active
          ? 'border-board-dark bg-board-dark/10 text-board-dark dark:text-chesscom-100'
          : 'border-chesscom-200 text-chesscom-600 hover:bg-chesscom-50 dark:border-chesscom-700 dark:text-chesscom-300 dark:hover:bg-chesscom-800',
      )}
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
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
