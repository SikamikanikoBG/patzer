import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Trophy, Frown, Equal, BookOpen, Inbox, Settings as SettingsIcon, Star, Search, X } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../state/auth';
import { fmtAccuracy } from '../lib/utils';
import { cn } from '../lib/utils';
import type { GameRow } from '../types';

export default function Review() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const bookmarkedOnly = searchParams.get('bookmarked') === '1';

  const { data, isLoading } = useQuery({
    queryKey: ['games', { bookmarkedOnly, q }],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '100' });
      if (bookmarkedOnly) params.set('bookmarked', '1');
      if (q.trim()) params.set('q', q.trim());
      return api.get<{ games: GameRow[] }>(`/api/games?${params.toString()}`);
    },
  });

  const importMut = useMutation({
    mutationFn: () => api.post<{ imported: number; total: number }>('/api/games/import/chesscom', { limit: 20 }),
    onSuccess: (r) => {
      setImportMsg(t('review.imported', { n: r.imported }));
      qc.invalidateQueries({ queryKey: ['games'] });
      setTimeout(() => setImportMsg(null), 3000);
    },
  });

  const games = data?.games ?? [];
  const counts = useMemo(() => {
    const total = games.length;
    const starred = games.filter((g) => g.bookmarked).length;
    return { total, starred };
  }, [games]);

  function toggleBookmarkedOnly() {
    const next = new URLSearchParams(searchParams);
    if (bookmarkedOnly) next.delete('bookmarked'); else next.set('bookmarked', '1');
    setSearchParams(next);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="page-h1">{t('review.title')}</h1>
          <p className="page-sub">{t('review.subtitle', { defaultValue: 'Browse, analyze and learn from your games.' })}</p>
        </div>
        {user?.profile.chesscom_username ? (
          <button onClick={() => importMut.mutate()} disabled={importMut.isPending} className="btn-primary self-start sm:self-auto">
            <Download className="h-4 w-4" />
            {importMut.isPending ? t('review.importing') : `${t('review.import')} (@${user.profile.chesscom_username})`}
          </button>
        ) : (
          <Link to="/settings" className="btn-secondary text-sm">
            <SettingsIcon className="h-4 w-4" /> {t('review.setUsername', { defaultValue: 'Set Chess.com username' })}
          </Link>
        )}
      </header>

      {importMsg && (
        <div className="rounded-md border border-board-dark/30 bg-board-dark/10 px-4 py-2 text-sm text-board-dark dark:text-chesscom-100">
          {importMsg}
        </div>
      )}

      {/* Filter bar — search + starred-only toggle. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-chesscom-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('review.searchPlaceholder', { defaultValue: 'Search players, opening, notes…' })}
            className="input pl-8 pr-8 text-sm"
          />
          {q && (
            <button
              onClick={() => setQ('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-chesscom-400 hover:bg-chesscom-100 dark:hover:bg-chesscom-700"
              aria-label="Clear"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <button
          onClick={toggleBookmarkedOnly}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-colors',
            bookmarkedOnly
              ? 'border-gold-500 bg-gold-500/10 text-gold-700 dark:text-gold-400'
              : 'border-chesscom-200 bg-white text-chesscom-600 hover:bg-chesscom-50 dark:border-chesscom-700 dark:bg-chesscom-800 dark:text-chesscom-300',
          )}
          title={t('review.starredOnly', { defaultValue: 'Starred only' })}
        >
          <Star className={cn('h-3.5 w-3.5', bookmarkedOnly && 'fill-gold-500')} />
          {bookmarkedOnly ? t('review.starredFilterOn', { defaultValue: 'Starred only' }) : t('review.starredFilterOff', { defaultValue: 'All games' })}
        </button>
        <span className="text-xs text-chesscom-400">
          {counts.total} {t('review.games', { defaultValue: 'games' })}{counts.starred > 0 && ` · ${counts.starred} ★`}
        </span>
      </div>

      {isLoading && (
        <div className="grid gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card flex h-16 animate-pulse items-center gap-3 p-3">
              <div className="h-10 w-10 rounded-lg bg-chesscom-200 dark:bg-chesscom-700" />
              <div className="flex-1 space-y-1">
                <div className="h-3 w-1/3 rounded bg-chesscom-200 dark:bg-chesscom-700" />
                <div className="h-2 w-1/4 rounded bg-chesscom-100 dark:bg-chesscom-800" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && games.length === 0 && (
        <div className="card flex flex-col items-center justify-center gap-3 p-12 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-chesscom-100 text-chesscom-400 dark:bg-chesscom-800">
            <Inbox className="h-6 w-6" />
          </div>
          <div className="text-base font-semibold">
            {bookmarkedOnly ? t('review.noStarred', { defaultValue: 'No starred games yet' }) : t('review.noGames')}
          </div>
          {bookmarkedOnly ? (
            <button onClick={toggleBookmarkedOnly} className="btn-secondary text-sm">{t('review.showAll', { defaultValue: 'Show all games' })}</button>
          ) : (
            !user?.profile.chesscom_username && (
              <Link to="/settings" className="btn-secondary text-sm">
                <SettingsIcon className="h-4 w-4" /> {t('review.noUsername')}
              </Link>
            )
          )}
        </div>
      )}

      {!isLoading && games.length > 0 && (
        <div className="grid gap-2">
          {games.map((g) => <GameCard key={g.id} g={g} />)}
        </div>
      )}
    </div>
  );
}

function GameCard({ g }: { g: GameRow }) {
  const qc = useQueryClient();
  const star = useMutation({
    mutationFn: (next: boolean) => api.patch(`/api/games/${g.id}/bookmark`, { bookmarked: next }),
    onMutate: (next: boolean) => {
      // Optimistic update.
      qc.setQueriesData<{ games: GameRow[] }>({ queryKey: ['games'] }, (old) =>
        old ? { games: old.games.map((row) => (row.id === g.id ? { ...row, bookmarked: next ? 1 : 0 } : row)) } : old);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['games'] }),
  });
  const isStarred = !!g.bookmarked;

  return (
    <div className="card-hover group relative flex items-center gap-3 p-3 sm:gap-4 sm:p-4">
      <Link to={`/review/${g.id}`} className="flex flex-1 items-center gap-3 sm:gap-4">
        <ResultIcon r={g.result} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className={cn('truncate font-semibold', g.user_color === 'white' ? 'text-chesscom-900 dark:text-chesscom-100' : 'text-chesscom-700 dark:text-chesscom-200')}>{g.white}</span>
            <span className="text-chesscom-400">vs</span>
            <span className={cn('truncate font-semibold', g.user_color === 'black' ? 'text-chesscom-900 dark:text-chesscom-100' : 'text-chesscom-700 dark:text-chesscom-200')}>{g.black}</span>
            <span className="text-xs text-chesscom-400">· {g.time_control}</span>
            {g.opening_name && <span className="hidden truncate text-xs text-chesscom-400 sm:inline">· {g.opening_name}</span>}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-chesscom-500">
            <span>{new Date(g.end_time).toLocaleDateString()}</span>
            <span>·</span>
            <span className="capitalize">{g.source}</span>
            {g.notes && <span className="ml-1 italic text-chesscom-400">· note</span>}
          </div>
        </div>
        {g.analyzed ? (
          <div className="text-right text-xs">
            <div className="text-[11px] uppercase tracking-wider text-chesscom-400">accuracy</div>
            <div className="font-mono text-sm font-semibold tabular-nums">
              <span className="text-chesscom-700 dark:text-chesscom-200">{fmtAccuracy(g.accuracy_white)}</span>
              <span className="mx-1 text-chesscom-400">/</span>
              <span className="text-chesscom-700 dark:text-chesscom-200">{fmtAccuracy(g.accuracy_black)}</span>
            </div>
          </div>
        ) : (
          <span className="badge gap-1 bg-chesscom-100 text-chesscom-500 dark:bg-chesscom-700 dark:text-chesscom-300">
            <BookOpen className="h-3 w-3" /> review
          </span>
        )}
      </Link>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); star.mutate(!isStarred); }}
        title={isStarred ? 'Unstar' : 'Star'}
        className={cn(
          'rounded-md p-1.5 transition-colors',
          isStarred
            ? 'text-gold-500 hover:bg-gold-500/15'
            : 'text-chesscom-300 opacity-0 hover:bg-chesscom-100 hover:text-gold-500 group-hover:opacity-100 dark:hover:bg-chesscom-700',
        )}
      >
        <Star className={cn('h-4 w-4', isStarred && 'fill-gold-500')} />
      </button>
    </div>
  );
}

function ResultIcon({ r }: { r: string }) {
  if (r === 'win') return <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-board-dark/15 text-board-dark"><Trophy className="h-4 w-4" /></div>;
  if (r === 'loss') return <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-mistake/15 text-mistake"><Frown className="h-4 w-4" /></div>;
  return <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-chesscom-100 text-chesscom-500 dark:bg-chesscom-700 dark:text-chesscom-300"><Equal className="h-4 w-4" /></div>;
}
