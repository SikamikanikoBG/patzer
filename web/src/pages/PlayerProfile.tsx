// Player profile — the public record of one player, plus a challenge box and
// your personal head-to-head against them. Reachable from the Players
// directory or a "Challenge back" on a missed invitation.

import { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { ArrowLeft, Swords, Check, Loader2, Target, Flame, Calendar } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../state/auth';
import { useLobby } from '../state/lobby';
import { cn } from '../lib/utils';

const TIME_CONTROLS = ['untimed', 'bullet', 'blitz', 'rapid', 'classical'] as const;
const TIME_CLASSES = ['bullet', 'blitz', 'rapid', 'daily'] as const;

interface Rating {
  time_class: string;
  rating: number;
  rd: number;
  games_played: number;
  last_played_at: string | null;
  provisional: boolean;
}
interface RecentGame {
  id: number;
  white: string;
  black: string;
  result: string;
  user_color: 'white' | 'black' | null;
  time_control: string;
  time_class: string | null;
  opening_name: string | null;
  end_time: string;
  source: string;
}
interface Profile {
  player: { id: number; username: string; display_name: string; avatar_emoji: string; created_at: string; online: boolean; is_me: boolean };
  stats: { total: number; wins: number; losses: number; draws: number; win_rate: number | null; avg_accuracy: number | null; streak: { kind: 'win' | 'loss' | 'draw'; count: number } | null };
  ratings: Record<string, Rating>;
  recent_games: RecentGame[];
  head_to_head: { total: number; wins: number; losses: number; draws: number } | null;
}

export default function PlayerProfile() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { user } = useAuth();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['player', id],
    queryFn: () => api.get<Profile>(`/api/players/${id}`),
    enabled: !!id,
  });

  if (isLoading) {
    return <div className="mx-auto max-w-4xl"><div className="h-40 animate-pulse rounded-2xl bg-chesscom-100 dark:bg-chesscom-800" /></div>;
  }
  if (isError || !data) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <BackLink />
        <div className="rounded-xl border border-chesscom-200 bg-white p-8 text-center text-sm text-chesscom-500 dark:border-chesscom-700 dark:bg-chesscom-800">
          {t('players.notFound', { defaultValue: 'Player not found.' })}
        </div>
      </div>
    );
  }

  const { player, stats, ratings, recent_games, head_to_head } = data;
  const isMe = player.id === user?.id;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <BackLink />

      {/* Hero */}
      <motion.section
        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-chesscom-900 via-[#3b4c2f] to-board-dark p-6 text-white shadow-lift sm:p-7"
      >
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15 text-4xl backdrop-blur">
              {player.avatar_emoji}
            </div>
            {player.online && (
              <span className="absolute -bottom-1 -right-1 flex items-center gap-1 rounded-full bg-green-500 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white ring-2 ring-chesscom-900">
                {t('players.online', { defaultValue: 'on' })}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">{player.display_name}</h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-white/70">
              <span>@{player.username}</span>
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                {t('players.memberSince', { defaultValue: 'Joined {{date}}', date: new Date(player.created_at).toLocaleDateString() })}
              </span>
            </div>
          </div>
        </div>

        {/* Record strip */}
        {stats.total > 0 ? (
          <div className="mt-5 flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <HeroStat value={stats.total.toLocaleString()} label={t('players.gamesShort', { defaultValue: 'games' })} />
            <HeroStat value={`${stats.win_rate ?? 0}%`} label={t('players.winRate', { defaultValue: 'win rate' })} />
            <span className="inline-flex items-baseline gap-1.5 font-mono text-sm">
              <span className="font-semibold text-green-300">{stats.wins}</span>
              <span className="text-white/40">/</span>
              <span className="font-semibold text-red-300">{stats.losses}</span>
              <span className="text-white/40">/</span>
              <span className="font-semibold text-white/80">{stats.draws}</span>
              <span className="ml-1 text-xs uppercase tracking-wider text-white/50">{t('players.wld', { defaultValue: 'W/L/D' })}</span>
            </span>
            {stats.avg_accuracy != null && (
              <HeroStat value={`${stats.avg_accuracy}%`} label={t('players.accuracy', { defaultValue: 'accuracy' })} icon={Target} />
            )}
            {stats.streak && (
              <HeroStat
                value={`${stats.streak.count}`}
                label={t(`players.streak.${stats.streak.kind}`, { defaultValue: `${stats.streak.kind} streak` })}
                icon={Flame}
                glow={stats.streak.kind === 'win'}
              />
            )}
          </div>
        ) : (
          <p className="mt-4 text-sm text-white/70">{t('players.noGamesYet', { defaultValue: 'No games played yet.' })}</p>
        )}
      </motion.section>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* Ratings */}
          <section className="card overflow-hidden">
            <div className="border-b border-chesscom-100 px-4 py-3 dark:border-chesscom-700">
              <h2 className="text-sm font-semibold text-chesscom-900 dark:text-chesscom-100">{t('players.ratingsTitle', { defaultValue: 'Ratings' })}</h2>
            </div>
            <div className="grid grid-cols-2 divide-chesscom-100 sm:grid-cols-4 dark:divide-chesscom-700">
              {TIME_CLASSES.map((tcId) => {
                const r = ratings[tcId];
                const played = r && r.games_played > 0;
                return (
                  <div key={tcId} className="p-4 text-center">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-chesscom-400">
                      {t(`players.tc.${tcId}`, { defaultValue: tcId })}
                    </div>
                    <div className={cn('mt-1 font-mono text-xl font-bold tabular-nums', played ? 'text-chesscom-900 dark:text-chesscom-100' : 'text-chesscom-300 dark:text-chesscom-600')}>
                      {played ? r.rating : '—'}
                    </div>
                    {played && (
                      <div className="text-[10px] text-chesscom-400">
                        {r.provisional ? t('players.provisional', { defaultValue: 'provisional' }) : `${r.games_played} ${t('players.gamesShort', { defaultValue: 'games' })}`}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Recent games */}
          <section>
            <h2 className="mb-2 text-sm font-semibold text-chesscom-900 dark:text-chesscom-100">{t('players.recentGames', { defaultValue: 'Recent games' })}</h2>
            {recent_games.length === 0 ? (
              <div className="rounded-xl border border-chesscom-200 bg-white p-6 text-center text-sm text-chesscom-500 dark:border-chesscom-700 dark:bg-chesscom-800">
                {t('players.noRecent', { defaultValue: 'No games yet.' })}
              </div>
            ) : (
              <ul className="divide-y divide-chesscom-100 overflow-hidden rounded-xl border border-chesscom-200 bg-white shadow-soft dark:divide-chesscom-800 dark:border-chesscom-700 dark:bg-chesscom-800">
                {recent_games.map((g) => {
                  const oppName = g.user_color === 'white' ? g.black : g.white;
                  const row = (
                    <div className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
                      <ResultGlyph r={g.result} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-chesscom-900 dark:text-chesscom-100">
                          {t('players.vs', { defaultValue: 'vs' })} {oppName || t('players.unknownOpp', { defaultValue: '—' })}
                        </div>
                        <div className="text-xs text-chesscom-500">
                          <span>{new Date(g.end_time).toLocaleDateString()}</span>
                          <span className="mx-1.5 text-chesscom-400">·</span>
                          <span>{g.time_control}</span>
                          {g.opening_name && (
                            <span className="hidden sm:inline">
                              <span className="mx-1.5 text-chesscom-400">·</span>
                              <span>{g.opening_name}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                  // Only the viewer's own games are openable in the analyzer
                  // (game rows are user-scoped; another player's id 404s).
                  return (
                    <li key={g.id}>
                      {isMe ? (
                        <Link to={`/review/${g.id}`} className="block transition-colors hover:bg-chesscom-50 dark:hover:bg-chesscom-900/40">{row}</Link>
                      ) : row}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {/* Sidebar: head-to-head + challenge */}
        <div className="space-y-5">
          {head_to_head && (
            <section className="card p-4">
              <h2 className="mb-3 text-sm font-semibold text-chesscom-900 dark:text-chesscom-100">{t('players.h2hTitle', { defaultValue: 'Your head-to-head' })}</h2>
              {head_to_head.total === 0 ? (
                <p className="text-sm text-chesscom-500">{t('players.h2hNone', { defaultValue: 'You haven’t played each other yet.' })}</p>
              ) : (
                <div className="flex items-center justify-around text-center">
                  <H2HCol value={head_to_head.wins} label={t('players.h2hWins', { defaultValue: 'Wins' })} tone="text-green-500" />
                  <H2HCol value={head_to_head.draws} label={t('players.h2hDraws', { defaultValue: 'Draws' })} tone="text-chesscom-400" />
                  <H2HCol value={head_to_head.losses} label={t('players.h2hLosses', { defaultValue: 'Losses' })} tone="text-bad" />
                </div>
              )}
            </section>
          )}

          {!isMe && <ChallengeBox toUserId={player.id} displayName={player.display_name} onPlay={(gid) => nav(`/play?game=${gid}`)} />}
        </div>
      </div>
    </div>
  );
}

function ChallengeBox({ toUserId, displayName, onPlay }: { toUserId: number; displayName: string; onPlay: (gameId: number) => void }) {
  const { t } = useTranslation();
  const lobby = useLobby();
  const [color, setColor] = useState<'white' | 'black' | 'random'>('random');
  const [tc, setTc] = useState<typeof TIME_CONTROLS[number]>('rapid');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  // Is there already a pending outgoing challenge to this player?
  const pending = lobby.outgoing.find((c) => c.to.id === toUserId);

  async function send() {
    setBusy(true);
    try {
      await api.post('/api/challenges', { to_user_id: toUserId, color, time_control: tc });
      await lobby.refreshChallenges();
      setSent(true);
    } finally { setBusy(false); }
  }
  async function cancel() {
    if (!pending) return;
    await api.del(`/api/challenges/${pending.id}`);
    await lobby.refreshChallenges();
    setSent(false);
  }

  if (pending) {
    return (
      <section className="card p-4">
        <h2 className="mb-2 text-sm font-semibold text-chesscom-900 dark:text-chesscom-100">{t('players.challengeTitle', { defaultValue: 'Challenge' })}</h2>
        <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="flex-1">{t('players.waitingFor', { defaultValue: 'Waiting for {{name}}…', name: displayName })}</span>
        </div>
        <button onClick={cancel} className="mt-2 w-full rounded-lg border border-chesscom-200 py-2 text-sm font-medium text-chesscom-600 transition-colors hover:bg-chesscom-50 dark:border-chesscom-700 dark:hover:bg-chesscom-900/40">
          {t('common.cancel', { defaultValue: 'Cancel' })}
        </button>
      </section>
    );
  }

  return (
    <section className="card p-4">
      <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-chesscom-900 dark:text-chesscom-100">
        <Swords className="h-4 w-4 text-board-dark" />
        {t('players.challengeTitle', { defaultValue: 'Challenge' })} {displayName}
      </h2>
      <div className="space-y-3">
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-chesscom-500">{t('play.color', { defaultValue: 'Color' })}</div>
          <div className="grid grid-cols-3 gap-1">
            {(['white', 'random', 'black'] as const).map((cOpt) => (
              <button
                key={cOpt}
                onClick={() => setColor(cOpt)}
                className={cn(
                  'rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
                  color === cOpt
                    ? 'bg-chesscom-900 text-white dark:bg-chesscom-100 dark:text-chesscom-900'
                    : 'bg-chesscom-100 text-chesscom-700 hover:bg-chesscom-200 dark:bg-chesscom-800 dark:text-chesscom-200',
                )}
              >
                {t(`play.${cOpt}`, { defaultValue: cOpt })}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-chesscom-500">{t('play.timeControl', { defaultValue: 'Time control' })}</div>
          <select
            value={tc}
            onChange={(e) => setTc(e.target.value as typeof TIME_CONTROLS[number])}
            className="w-full rounded-lg border border-chesscom-200 bg-white px-3 py-2 text-sm outline-none focus:border-board-dark dark:border-chesscom-700 dark:bg-chesscom-800"
          >
            {TIME_CONTROLS.map((tt) => <option key={tt} value={tt}>{t(`play.tc.${tt}`, { defaultValue: tt })}</option>)}
          </select>
        </div>
        <button
          onClick={send}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-green-500 py-2.5 text-sm font-bold text-white shadow-soft transition-all hover:bg-green-600 hover:shadow-lift disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : sent ? <Check className="h-4 w-4" /> : <Swords className="h-4 w-4" />}
          {t('players.sendChallenge', { defaultValue: 'Send challenge' })}
        </button>
        <p className="text-center text-[11px] text-chesscom-400">{t('players.challengeHint', { defaultValue: 'They’ll get a live invitation if online.' })}</p>
      </div>
    </section>
  );
}

function HeroStat({ value, label, icon: Icon, glow }: { value: string; label: string; icon?: React.ElementType; glow?: boolean }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className={cn('font-mono text-xl font-semibold tabular-nums', glow ? 'text-gold-300' : 'text-white')}>{value}</span>
      <span className="inline-flex items-center gap-1 text-xs uppercase tracking-wider text-white/55">
        {Icon && <Icon className="h-3 w-3" />}{label}
      </span>
    </span>
  );
}

function H2HCol({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div>
      <div className={cn('font-mono text-2xl font-bold tabular-nums', tone)}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-chesscom-400">{label}</div>
    </div>
  );
}

function ResultGlyph({ r }: { r: string }) {
  const map: Record<string, { cls: string; ch: string }> = {
    win: { cls: 'bg-green-500/15 text-green-500', ch: 'W' },
    loss: { cls: 'bg-bad/15 text-bad', ch: 'L' },
  };
  const m = map[r] ?? { cls: 'bg-chesscom-100 text-chesscom-500 dark:bg-chesscom-700 dark:text-chesscom-300', ch: 'D' };
  return <span className={cn('inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-bold', m.cls)}>{m.ch}</span>;
}

function BackLink() {
  const { t } = useTranslation();
  return (
    <Link to="/players" className="inline-flex items-center gap-1.5 text-sm font-medium text-chesscom-500 transition-colors hover:text-chesscom-900 dark:hover:text-chesscom-100">
      <ArrowLeft className="h-4 w-4" />
      {t('players.backToPlayers', { defaultValue: 'All players' })}
    </Link>
  );
}
