// Players — the social directory. Browse everyone on this Patzer instance,
// see their record at a glance, sort the leaderboard, and jump into a full
// profile. Also surfaces *missed invitations* (challenges that expired before
// you answered) so the social loop closes.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Search, Trophy, Swords, ChevronRight, Crown, Inbox, Clock } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../state/auth';
import { cn } from '../lib/utils';

interface PlayerSummary {
  id: number;
  username: string;
  display_name: string;
  avatar_emoji: string;
  created_at: string;
  online: boolean;
  is_me: boolean;
  total: number;
  wins: number;
  losses: number;
  draws: number;
  win_rate: number | null;
  best_rating: number | null;
  last_played_at: string | null;
}

interface HistoryChallenge {
  id: number;
  status: string;
  color: string;
  time_control: string;
  created_at: string;
  direction: 'incoming' | 'outgoing';
  missed: boolean;
  from: { id: number; username: string; display_name: string; avatar_emoji: string };
  to: { id: number; username: string; display_name: string; avatar_emoji: string };
}

type SortKey = 'rating' | 'winrate' | 'games' | 'name';

export default function Players() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('rating');

  const { data, isLoading } = useQuery({
    queryKey: ['players'],
    queryFn: () => api.get<{ players: PlayerSummary[] }>('/api/players'),
    refetchInterval: 30_000,
  });
  const { data: history } = useQuery({
    queryKey: ['challenges', 'history'],
    queryFn: () => api.get<{ challenges: HistoryChallenge[] }>('/api/challenges/history?limit=40'),
    refetchInterval: 30_000,
  });

  const players = data?.players ?? [];
  const missed = (history?.challenges ?? []).filter((c) => c.missed).slice(0, 6);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const base = s
      ? players.filter((p) => p.display_name.toLowerCase().includes(s) || p.username.toLowerCase().includes(s))
      : players;
    const sorted = [...base].sort((a, b) => {
      // Online players always float to the top within the chosen sort.
      if (a.online !== b.online) return a.online ? -1 : 1;
      switch (sort) {
        case 'rating': return (b.best_rating ?? -1) - (a.best_rating ?? -1);
        case 'winrate': return (b.win_rate ?? -1) - (a.win_rate ?? -1);
        case 'games': return b.total - a.total;
        case 'name': return a.display_name.localeCompare(b.display_name);
      }
    });
    return sorted;
  }, [players, q, sort]);

  const onlineCount = players.filter((p) => p.online).length;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
        className="flex flex-wrap items-end justify-between gap-3"
      >
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-chesscom-900 dark:text-chesscom-100">
            {t('players.title', { defaultValue: 'Players' })}
          </h1>
          <p className="mt-0.5 text-sm text-chesscom-500">
            {t('players.subtitle', {
              defaultValue: '{{n}} players · {{online}} online',
              n: players.length,
              online: onlineCount,
            })}
          </p>
        </div>
      </motion.div>

      {/* Missed invitations */}
      {missed.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
          className="overflow-hidden rounded-2xl border border-amber-500/30 bg-amber-500/5 dark:border-amber-500/20"
        >
          <div className="flex items-center gap-2 border-b border-amber-500/20 px-4 py-2.5">
            <Inbox className="h-4 w-4 text-amber-600" />
            <span className="text-sm font-semibold text-chesscom-900 dark:text-chesscom-100">
              {t('players.missedTitle', { defaultValue: 'Missed invitations' })}
            </span>
            <span className="font-mono text-[11px] tabular-nums text-amber-700/80 dark:text-amber-500/80">{missed.length}</span>
          </div>
          <ul className="divide-y divide-amber-500/10">
            {missed.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="text-xl">{c.from.avatar_emoji}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-chesscom-900 dark:text-chesscom-100">{c.from.display_name}</div>
                  <div className="flex items-center gap-1.5 text-xs text-chesscom-500">
                    <Clock className="h-3 w-3" />
                    {t(`play.tc.${c.time_control}`, { defaultValue: c.time_control })}
                    <span className="text-chesscom-400">·</span>
                    {new Date(c.created_at).toLocaleDateString()}
                  </div>
                </div>
                <Link
                  to={`/players/${c.from.id}`}
                  className="inline-flex items-center gap-1.5 rounded-md bg-green-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-green-600"
                >
                  <Swords className="h-3.5 w-3.5" />
                  {t('players.challengeBack', { defaultValue: 'Challenge back' })}
                </Link>
              </li>
            ))}
          </ul>
        </motion.section>
      )}

      {/* Search + sort */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-chesscom-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('players.searchPlaceholder', { defaultValue: 'Search players…' })}
            className="w-full rounded-lg border border-chesscom-200 bg-white py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-board-dark dark:border-chesscom-700 dark:bg-chesscom-800"
          />
        </div>
        <div className="flex rounded-lg border border-chesscom-200 bg-white p-0.5 text-xs dark:border-chesscom-700 dark:bg-chesscom-800">
          {(['rating', 'winrate', 'games', 'name'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setSort(k)}
              className={cn(
                'rounded-md px-2.5 py-1.5 font-medium transition-colors',
                sort === k
                  ? 'bg-chesscom-900 text-white dark:bg-chesscom-100 dark:text-chesscom-900'
                  : 'text-chesscom-500 hover:text-chesscom-900 dark:hover:text-chesscom-100',
              )}
            >
              {t(`players.sort.${k}`, { defaultValue: { rating: 'Rating', winrate: 'Win %', games: 'Games', name: 'Name' }[k] })}
            </button>
          ))}
        </div>
      </div>

      {/* Directory */}
      {isLoading ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[72px] animate-pulse rounded-xl bg-chesscom-100 dark:bg-chesscom-800" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-chesscom-200 bg-white p-8 text-center text-sm text-chesscom-500 dark:border-chesscom-700 dark:bg-chesscom-800">
          {q
            ? t('players.noMatch', { defaultValue: 'No players match “{{q}}”.', q })
            : t('players.empty', { defaultValue: 'No other players yet. Ask an admin to create more accounts.' })}
        </div>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {filtered.map((p, i) => (
            <PlayerCard key={p.id} p={p} rank={sort === 'rating' && !q ? i : null} />
          ))}
        </ul>
      )}
    </div>
  );
}

function PlayerCard({ p, rank }: { p: PlayerSummary; rank: number | null }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isMe = p.id === user?.id;
  return (
    <li>
      <Link
        to={`/players/${p.id}`}
        className="group flex items-center gap-3 rounded-xl border border-chesscom-200 bg-white p-3 shadow-soft transition-all hover:border-board-dark/40 hover:shadow-lift dark:border-chesscom-700 dark:bg-chesscom-800"
      >
        <div className="relative shrink-0">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-chesscom-100 text-2xl dark:bg-chesscom-900/60">
            {p.avatar_emoji}
          </div>
          {p.online && (
            <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-green-500 dark:border-chesscom-800" title="online" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {rank !== null && rank < 3 && (
              <Crown className={cn('h-3.5 w-3.5 shrink-0', rank === 0 ? 'text-gold-500' : rank === 1 ? 'text-chesscom-400' : 'text-amber-700/70')} />
            )}
            <span className="truncate font-semibold text-chesscom-900 dark:text-chesscom-100">{p.display_name}</span>
            {isMe && (
              <span className="rounded bg-board-dark/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-board-dark">
                {t('players.you', { defaultValue: 'You' })}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-chesscom-500">
            <span className="truncate">@{p.username}</span>
            {p.total > 0 && (
              <>
                <span className="text-chesscom-300">·</span>
                <span className="tabular-nums">
                  {p.total} {t('players.gamesShort', { defaultValue: 'games' })}
                </span>
                {p.win_rate != null && (
                  <>
                    <span className="text-chesscom-300">·</span>
                    <span className="tabular-nums">{p.win_rate}%</span>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {p.best_rating != null && (
            <div className="text-right">
              <div className="flex items-center justify-end gap-1 font-mono text-sm font-bold tabular-nums text-chesscom-900 dark:text-chesscom-100">
                <Trophy className="h-3 w-3 text-gold-500" />
                {p.best_rating}
              </div>
              <div className="text-[10px] uppercase tracking-wide text-chesscom-400">{t('players.rating', { defaultValue: 'rating' })}</div>
            </div>
          )}
          <ChevronRight className="h-4 w-4 text-chesscom-300 transition-transform group-hover:translate-x-0.5" />
        </div>
      </Link>
    </li>
  );
}
