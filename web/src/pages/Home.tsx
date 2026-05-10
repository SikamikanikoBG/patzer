import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as Icons from 'lucide-react';
import { Swords, BookOpen, Settings as SettingsIcon, ChevronRight, Trophy, Frown, Equal, Flame, Target, Activity, Download, Sparkles, BarChart3, ListChecks, Award, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuth } from '../state/auth';
import { api } from '../api';
import { fmtAccuracy } from '../lib/utils';
import type { GameRow } from '../types';

const APP_VERSION = 'v7.0.0';
const CHANGELOG_KEY = 'patzer.lastSeenChangelog';

type Achievement = {
  id: string;
  title: string;
  description: string;
  icon: string;
  category: 'milestone' | 'mastery' | 'tactics' | 'streaks';
  unlocked: boolean;
  unlocked_at: string | null;
  progress: number;
  target: number;
};

type PlanGoal = {
  id: number;
  kind: 'puzzles_solve' | 'opening_play' | 'review_games' | 'accuracy' | 'win_streak';
  title: string;
  description: string;
  target: number;
  progress: number;
  status: 'active' | 'completed' | 'expired';
  icon: string;
  created_at: string;
  completes_at: string;
  metadata: Record<string, unknown> | null;
};

interface Stats {
  total: number; wins: number; losses: number; draws: number;
  avg_accuracy: number | null;
  streak: { kind: 'win' | 'loss' | 'draw'; count: number } | null;
}

interface TrainStats { total: number; solved: number; failed: number; accuracy: number }

interface InsightsLite {
  accuracy_trend: { t: string; acc: number; result: string | null }[];
  opening_repertoire: { eco: string; name: string; played: number; wins: number; draws: number; losses: number; color: 'white' | 'black' }[];
}

interface NextPuzzle { puzzle: { game_id: number; ply: number; played_san: string; classification: string; white: string; black: string } | null }

export default function Home() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const { data: gamesData, isLoading } = useQuery({
    queryKey: ['games', 'home'],
    queryFn: () => api.get<{ games: GameRow[] }>('/api/games?limit=4'),
  });

  const { data: stats } = useQuery({
    queryKey: ['stats', 'me'],
    queryFn: () => api.get<Stats>('/api/stats/me'),
  });

  const { data: trainStats } = useQuery({
    queryKey: ['train-stats'],
    queryFn: () => api.get<TrainStats>('/api/train/stats'),
  });

  const { data: insights } = useQuery({
    queryKey: ['insights-home'],
    queryFn: () => api.get<InsightsLite>('/api/insights/v2'),
  });

  const { data: nextPuzzle } = useQuery({
    queryKey: ['train-next'],
    queryFn: () => api.get<NextPuzzle>('/api/train/next'),
  });

  const { data: planData } = useQuery({
    queryKey: ['plan-home'],
    queryFn: () => api.get<{ goals: PlanGoal[] }>('/api/plan'),
  });

  const { data: achievementsData } = useQuery({
    queryKey: ['achievements-home'],
    queryFn: () => api.get<{ achievements: Achievement[] }>('/api/achievements'),
  });

  const games = gamesData?.games ?? [];
  const topOpening = insights?.opening_repertoire?.[0] ?? null;

  // What's new toast — surface v7.0.0 highlights once.
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  useEffect(() => {
    try {
      const seen = localStorage.getItem(CHANGELOG_KEY);
      if (seen !== APP_VERSION) setShowWhatsNew(true);
    } catch {
      // localStorage unavailable — ignore.
    }
  }, []);
  function dismissWhatsNew() {
    try { localStorage.setItem(CHANGELOG_KEY, APP_VERSION); } catch { /* ignore */ }
    setShowWhatsNew(false);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Hero Play tile */}
      <motion.section
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="grid gap-4 md:grid-cols-[1.4fr_1fr]"
      >
        <Link to="/play" className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-board-dark via-[#5d7d3f] to-chesscom-700 p-6 text-white shadow-lift transition-transform hover:-translate-y-0.5 sm:p-8">
          <div className="relative z-10 flex h-full flex-col">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 text-3xl backdrop-blur">
                {user?.profile.avatar_emoji ?? '♟'}
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-white/60">{t('login.title')}</div>
                <h1 className="text-2xl font-bold sm:text-3xl">
                  {t('home.greeting', { name: user?.profile.display_name ?? '' })}
                </h1>
              </div>
            </div>
            <p className="mt-3 max-w-md text-sm text-white/80">
              {t('app.tagline')}
            </p>
            <div className="mt-auto pt-6">
              <span className="inline-flex items-center gap-2 rounded-md bg-white px-4 py-2.5 text-sm font-bold text-chesscom-900 shadow-soft transition-transform group-hover:translate-x-1">
                <Swords className="h-4 w-4 text-green-500" /> {t('home.playTitle')}
              </span>
            </div>
          </div>
          <svg className="pointer-events-none absolute -right-10 -top-10 hidden h-72 w-72 opacity-20 sm:block" viewBox="0 0 8 8" shapeRendering="crispEdges">
            {Array.from({ length: 64 }).map((_, i) => {
              const x = i % 8; const y = Math.floor(i / 8);
              return <rect key={i} x={x} y={y} width={1} height={1} fill={(x + y) % 2 === 0 ? '#eeeed2' : '#769656'} />;
            })}
          </svg>
        </Link>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-1">
          <Link to="/review" className="card-hover flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gold-500/15 text-gold-600">
              <BookOpen className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{t('home.reviewTitle')}</div>
              <div className="truncate text-xs text-chesscom-500">{t('home.reviewDesc')}</div>
            </div>
            <ChevronRight className="h-4 w-4 text-chesscom-400" />
          </Link>
          <Link to="/insights" className="card-hover flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-board-dark/15 text-board-dark">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{t('insights.title', { defaultValue: 'Insights' })}</div>
              <div className="truncate text-xs text-chesscom-500">{t('insights.sub2', { defaultValue: 'Spot your weak patterns' })}</div>
            </div>
            <ChevronRight className="h-4 w-4 text-chesscom-400" />
          </Link>
        </div>
      </motion.section>

      {/* First-run empty state */}
      {stats && stats.total === 0 && (
        <section className="card-hover relative overflow-hidden border-dashed">
          <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-board-dark/15 text-board-dark">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">{t('home.firstRunTitle', { defaultValue: 'Play your first game' })}</h3>
                <p className="mt-1 text-sm text-chesscom-500 dark:text-chesscom-300">
                  {user?.profile.chesscom_username
                    ? t('home.firstRunReady', { defaultValue: 'Ready to go. Hop into Play vs Bot — or import your Chess.com games to review.' })
                    : t('home.firstRunNoUsername', { defaultValue: 'Pick an opponent and a time control, or set your Chess.com username in Settings to import existing games.' })}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Link to="/play" className="btn-primary text-sm">
                <Swords className="h-4 w-4" /> {t('home.playTitle')}
              </Link>
              {user?.profile.chesscom_username ? (
                <Link to="/review" className="btn-secondary text-sm">
                  <Download className="h-4 w-4" /> {t('home.importGames', { defaultValue: 'Import games' })}
                </Link>
              ) : (
                <Link to="/settings" className="btn-secondary text-sm">
                  <SettingsIcon className="h-4 w-4" /> {t('home.setUsername', { defaultValue: 'Set username' })}
                </Link>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Stats strip with sparkline */}
      {stats && stats.total > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Activity className="h-4 w-4 text-board-dark" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-chesscom-500">{t('home.yourStats', { defaultValue: 'Your stats' })}</h2>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard icon={Activity} label={t('home.statGames', { defaultValue: 'Games' })} value={String(stats.total)} sublabel={`${stats.wins}W · ${stats.draws}D · ${stats.losses}L`} />
            <StatCard icon={Trophy} label={t('home.statWinRate', { defaultValue: 'Win rate' })} value={`${Math.round((stats.wins / Math.max(1, stats.total)) * 100)}%`} sublabel={stats.wins ? `${stats.wins} wins` : undefined} />
            <StatCard
              icon={Target}
              label={t('home.statAccuracy', { defaultValue: 'Avg accuracy' })}
              value={stats.avg_accuracy != null ? `${stats.avg_accuracy}%` : '—'}
              sublabel={t('home.acrossAnalyzed', { defaultValue: 'across analyzed games' })}
              chart={insights?.accuracy_trend && insights.accuracy_trend.length > 1 ? <Sparkline values={insights.accuracy_trend.map((p) => p.acc)} /> : undefined}
            />
            <StatCard icon={Flame} label={t('home.statStreak', { defaultValue: 'Streak' })} value={stats.streak ? `${stats.streak.count} ${stats.streak.kind}` : '—'} highlight={stats.streak?.kind === 'win'} />
          </div>
        </section>
      )}

      {/* Plan + Achievements */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05, duration: 0.25 }}
        className="grid gap-3 md:grid-cols-2"
      >
        <PlanTile goals={planData?.goals ?? null} />
        <AchievementsTile achievements={achievementsData?.achievements ?? null} />
      </motion.section>

      {/* Today's tactic + Top opening */}
      {(nextPuzzle?.puzzle || topOpening) && (
        <section className="grid gap-3 md:grid-cols-2">
          {nextPuzzle?.puzzle && (
            <Link to="/train" className="card-hover relative overflow-hidden p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-mistake/15 text-mistake">
                  <Target className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-chesscom-500">{t('home.todayPuzzle', { defaultValue: "Today's puzzle" })}</div>
                  <div className="mt-0.5 truncate text-sm font-semibold text-chesscom-900 dark:text-chesscom-100">
                    {t('home.todayPuzzleTitle', { defaultValue: "You played {{san}}. Find a stronger move.", san: nextPuzzle.puzzle.played_san })}
                  </div>
                  <div className="mt-1 truncate text-[11px] text-chesscom-500">
                    {t('home.fromGame', { defaultValue: 'From your game vs {{opp}}', opp: user?.profile.display_name === nextPuzzle.puzzle.white ? nextPuzzle.puzzle.black : nextPuzzle.puzzle.white })}
                    {trainStats && trainStats.total > 0 && <> · {trainStats.solved}/{trainStats.total} solved</>}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-chesscom-400" />
              </div>
            </Link>
          )}
          {topOpening && (
            <Link to="/insights" className="card-hover p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gold-500/15 text-gold-600">
                  <BookOpen className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-chesscom-500">{t('home.topOpening', { defaultValue: 'Your top opening' })}</div>
                  <div className="mt-0.5 truncate text-sm font-semibold">{topOpening.name}</div>
                  <div className="mt-1 truncate text-[11px] text-chesscom-500">
                    {topOpening.played} games · {topOpening.wins}W / {topOpening.draws}D / {topOpening.losses}L · {topOpening.color === 'white' ? '♔' : '♚'}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-chesscom-400" />
              </div>
            </Link>
          )}
        </section>
      )}

      {/* What's new — small dismissible badge */}
      {showWhatsNew && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="card flex items-center gap-3 p-3"
        >
          <span className="inline-flex h-7 shrink-0 items-center rounded-full bg-gold-500/15 px-2.5 text-[10px] font-bold uppercase tracking-wider text-gold-600">
            {APP_VERSION}
          </span>
          <div className="min-w-0 flex-1 text-xs text-chesscom-600 dark:text-chesscom-300">
            {t('home.whatsNew', { defaultValue: "What's new: plans, achievements, and a top-3 lines panel in Review." })}
          </div>
          <button onClick={dismissWhatsNew} className="btn-ghost p-1.5 text-chesscom-500" title={t('common.cancel')}>
            <X className="h-3.5 w-3.5" />
          </button>
        </motion.div>
      )}

      {/* Recent games */}
      {!isLoading && games.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-chesscom-500">{t('home.recentGames', { defaultValue: 'Recent games' })}</h2>
            <Link to="/review" className="text-xs font-medium text-board-dark hover:text-board-dark/80">
              {t('home.viewAll', { defaultValue: 'View all →' })}
            </Link>
          </div>
          <div className="grid gap-2">
            {games.map((g) => (
              <Link key={g.id} to={`/review/${g.id}`}
                className="card-hover flex items-center gap-3 p-3">
                <ResultIcon r={g.result} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {g.user_color === 'white'
                      ? <><span className="text-chesscom-900 dark:text-chesscom-100">{g.white}</span> <span className="text-chesscom-400">vs</span> {g.black}</>
                      : <>{g.white} <span className="text-chesscom-400">vs</span> <span className="text-chesscom-900 dark:text-chesscom-100">{g.black}</span></>}
                    <span className="ml-2 text-[11px] text-chesscom-400">{g.time_control}</span>
                  </div>
                  <div className="text-[11px] text-chesscom-500">{new Date(g.end_time).toLocaleString()}</div>
                </div>
                {g.analyzed ? (
                  <div className="text-right text-[11px]">
                    <div className="text-chesscom-400">accuracy</div>
                    <div className="font-mono font-semibold tabular-nums">
                      <span>{fmtAccuracy(g.accuracy_white)}</span>
                      <span className="mx-1 text-chesscom-400">/</span>
                      <span>{fmtAccuracy(g.accuracy_black)}</span>
                    </div>
                  </div>
                ) : (
                  <span className="badge bg-chesscom-100 text-chesscom-500 dark:bg-chesscom-700 dark:text-chesscom-300">unreviewed</span>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sublabel, highlight, chart }: { icon: React.ElementType; label: string; value: string; sublabel?: string; highlight?: boolean; chart?: React.ReactNode }) {
  return (
    <div className={`card flex flex-col gap-1 p-4 ${highlight ? 'ring-2 ring-gold-500/30' : ''}`}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-chesscom-500">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-mono text-2xl font-bold tabular-nums">{value}</div>
        {chart && <div className="opacity-90">{chart}</div>}
      </div>
      {sublabel && <div className="text-[11px] text-chesscom-400">{sublabel}</div>}
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const W = 64, H = 22;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const path = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (W - 2) + 1;
    const y = H - 1 - ((v - min) / range) * (H - 2);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="text-board-dark">
      <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlanTile({ goals }: { goals: PlanGoal[] | null }) {
  const { t } = useTranslation();
  const list = goals ?? [];
  const active = list.filter((g) => g.status === 'active');
  const imminent = active.length
    ? [...active].sort((a, b) => new Date(a.completes_at).getTime() - new Date(b.completes_at).getTime())[0]!
    : null;

  if (active.length === 0) {
    return (
      <Link to="/plan" className="card-hover flex items-start gap-3 p-5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-board-dark/15 text-board-dark">
          <ListChecks className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-chesscom-500">{t('home.planLabel', { defaultValue: "This week's plan" })}</div>
          <div className="mt-0.5 text-sm font-semibold">{t('home.planEmpty', { defaultValue: 'Build your first improvement plan' })}</div>
          <div className="mt-1 truncate text-[11px] text-chesscom-500">
            {t('home.planEmptyDesc', { defaultValue: 'Pick a few weekly goals — puzzles, openings, accuracy.' })}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-chesscom-400" />
      </Link>
    );
  }

  const pct = imminent ? Math.min(100, Math.round((imminent.progress / Math.max(1, imminent.target)) * 100)) : 0;
  return (
    <Link to="/plan" className="card-hover p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-board-dark/15 text-board-dark">
          <ListChecks className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-chesscom-500">{t('home.planLabel', { defaultValue: "This week's plan" })}</div>
            <div className="font-mono text-[10px] tabular-nums text-chesscom-500">{active.length} {t('home.planActive', { defaultValue: 'active' })}</div>
          </div>
          {imminent && (
            <>
              <div className="mt-0.5 truncate text-sm font-semibold">{imminent.title}</div>
              <div className="mt-1 truncate text-[11px] text-chesscom-500">{imminent.description}</div>
              <div className="mt-2 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-chesscom-100 dark:bg-chesscom-900">
                  <div className="h-full bg-board-dark transition-all" style={{ width: `${pct}%` }} />
                </div>
                <span className="font-mono text-[10px] tabular-nums text-chesscom-500">{imminent.progress}/{imminent.target}</span>
              </div>
            </>
          )}
        </div>
        <ChevronRight className="h-4 w-4 text-chesscom-400" />
      </div>
    </Link>
  );
}

function AchievementsTile({ achievements }: { achievements: Achievement[] | null }) {
  const { t } = useTranslation();
  const list = achievements ?? [];
  const unlocked = list.filter((a) => a.unlocked);
  const recent = [...unlocked]
    .sort((a, b) => new Date(b.unlocked_at ?? 0).getTime() - new Date(a.unlocked_at ?? 0).getTime())
    .slice(0, 3);

  if (list.length > 0 && unlocked.length === 0) {
    return (
      <Link to="/insights#achievements" className="card-hover flex items-start gap-3 p-5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gold-500/15 text-gold-600">
          <Award className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-chesscom-500">{t('home.achievementsLabel', { defaultValue: 'Achievements' })}</div>
          <div className="mt-0.5 text-sm font-semibold">{t('home.achievementsEmpty', { defaultValue: 'Earn your first badge by playing a game' })}</div>
          <div className="mt-1 truncate text-[11px] text-chesscom-500">
            {t('home.achievementsEmptyDesc', { defaultValue: '0 of {{n}} unlocked', n: list.length })}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-chesscom-400" />
      </Link>
    );
  }

  return (
    <Link to="/insights#achievements" className="card-hover p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gold-500/15 text-gold-600">
          <Award className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-chesscom-500">{t('home.achievementsLabel', { defaultValue: 'Achievements' })}</div>
            <div className="font-mono text-[10px] tabular-nums text-chesscom-500">{unlocked.length}/{list.length || '—'}</div>
          </div>
          <div className="mt-1 truncate text-sm font-semibold">
            {recent.length > 0
              ? t('home.achievementsRecent', { defaultValue: 'Recently unlocked' })
              : t('home.achievementsLabel', { defaultValue: 'Achievements' })}
          </div>
          {recent.length > 0 && (
            <div className="mt-2 flex items-center gap-1.5">
              {recent.map((a) => {
                const Icon = resolveIcon(a.icon);
                return (
                  <span key={a.id} title={a.title}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gold-500/15 text-gold-600 ring-1 ring-gold-500/30">
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                );
              })}
              {unlocked.length > 3 && (
                <span className="text-[10px] text-chesscom-500">+{unlocked.length - 3}</span>
              )}
            </div>
          )}
        </div>
        <ChevronRight className="h-4 w-4 text-chesscom-400" />
      </div>
    </Link>
  );
}

function resolveIcon(name: string): React.ComponentType<{ className?: string }> {
  const lib = Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>;
  return lib[name] ?? lib.Award ?? (() => null);
}

function ResultIcon({ r }: { r: string }) {
  if (r === 'win') return <div className="rounded-lg bg-board-dark/15 p-2 text-board-dark"><Trophy className="h-4 w-4" /></div>;
  if (r === 'loss') return <div className="rounded-lg bg-mistake/15 p-2 text-mistake"><Frown className="h-4 w-4" /></div>;
  return <div className="rounded-lg bg-chesscom-100 p-2 text-chesscom-500 dark:bg-chesscom-700 dark:text-chesscom-300"><Equal className="h-4 w-4" /></div>;
}
