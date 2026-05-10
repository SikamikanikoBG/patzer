import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Swords, BookOpen, Settings as SettingsIcon, ChevronRight, Trophy, Frown, Equal, Flame, Target, Activity, Download, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuth } from '../state/auth';
import { api } from '../api';
import { fmtAccuracy } from '../lib/utils';
import type { GameRow } from '../types';

interface Stats {
  total: number; wins: number; losses: number; draws: number;
  avg_accuracy: number | null;
  streak: { kind: 'win' | 'loss' | 'draw'; count: number } | null;
}

export default function Home() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['games', 'home'],
    queryFn: () => api.get<{ games: GameRow[] }>('/api/games?limit=4'),
  });

  const { data: stats } = useQuery({
    queryKey: ['stats', 'me'],
    queryFn: () => api.get<Stats>('/api/stats/me'),
  });

  const games = data?.games ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Hero Play tile — chess.com green gradient with prominent CTA */}
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
          {/* Decorative chessboard art on the right */}
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
              <Activity className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{t('insights.title', { defaultValue: 'Insights' })}</div>
              <div className="truncate text-xs text-chesscom-500">{t('insights.sub2', { defaultValue: 'Spot your weak patterns' })}</div>
            </div>
            <ChevronRight className="h-4 w-4 text-chesscom-400" />
          </Link>
        </div>
      </motion.section>

      {/* First-run empty state — fires when the user has zero saved games.
          Without this the page collapses to greeting + 3 cards on a fresh
          install, leaving 70% of the viewport blank with no next step. */}
      {stats && stats.total === 0 && (
        <section className="card-hover relative overflow-hidden border-dashed">
          <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent-500/15 text-accent-600">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Play your first game</h3>
                <p className="mt-1 text-sm text-ink-500 dark:text-ink-300">
                  {user?.profile.chesscom_username
                    ? "Ready to go. Hop into Play vs Bot — or import your Chess.com games to review."
                    : "Pick an opponent and a time control, or set your Chess.com username in Settings to import existing games."}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Link to="/play" className="btn-primary text-sm">
                <Swords className="h-4 w-4" /> Play vs Bot
              </Link>
              {user?.profile.chesscom_username ? (
                <Link to="/review" className="btn-secondary text-sm">
                  <Download className="h-4 w-4" /> Import games
                </Link>
              ) : (
                <Link to="/settings" className="btn-secondary text-sm">
                  <SettingsIcon className="h-4 w-4" /> Set username
                </Link>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Stats strip */}
      {stats && stats.total > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Activity className="h-4 w-4 text-accent-500" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-500">Your stats</h2>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard icon={Activity} label="Games" value={String(stats.total)} sublabel={`${stats.wins}W · ${stats.draws}D · ${stats.losses}L`} />
            <StatCard icon={Trophy} label="Win rate" value={`${Math.round((stats.wins / Math.max(1, stats.total)) * 100)}%`} sublabel={stats.wins ? `${stats.wins} wins` : undefined} />
            <StatCard icon={Target} label="Avg accuracy" value={stats.avg_accuracy != null ? `${stats.avg_accuracy}%` : '—'} sublabel="across analyzed games" />
            <StatCard icon={Flame} label="Streak" value={stats.streak ? `${stats.streak.count} ${stats.streak.kind}` : '—'} highlight={stats.streak?.kind === 'win'} />
          </div>
        </section>
      )}

      {/* (Hero strip + small tiles above replace the old 3-card grid.) */}

      {/* Recent games */}
      {!isLoading && games.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-500">Recent games</h2>
            <Link to="/review" className="text-xs font-medium text-accent-600 hover:text-accent-700">
              View all →
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
                      ? <><span className="text-ink-900 dark:text-cream">{g.white}</span> <span className="text-ink-400">vs</span> {g.black}</>
                      : <>{g.white} <span className="text-ink-400">vs</span> <span className="text-ink-900 dark:text-cream">{g.black}</span></>}
                    <span className="ml-2 text-[11px] text-ink-400">{g.time_control}</span>
                  </div>
                  <div className="text-[11px] text-ink-500">{new Date(g.end_time).toLocaleString()}</div>
                </div>
                {g.analyzed ? (
                  <div className="text-right text-[11px]">
                    <div className="text-ink-400">accuracy</div>
                    <div className="font-mono font-semibold tabular-nums">
                      <span>{fmtAccuracy(g.accuracy_white)}</span>
                      <span className="mx-1 text-ink-400">/</span>
                      <span>{fmtAccuracy(g.accuracy_black)}</span>
                    </div>
                  </div>
                ) : (
                  <span className="badge bg-ink-100 text-ink-500 dark:bg-ink-700 dark:text-ink-300">unreviewed</span>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sublabel, highlight }: { icon: React.ElementType; label: string; value: string; sublabel?: string; highlight?: boolean }) {
  return (
    <div className={`card flex flex-col gap-1 p-4 ${highlight ? 'ring-2 ring-accent-500/30' : ''}`}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-ink-500">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="font-mono text-2xl font-bold tabular-nums">{value}</div>
      {sublabel && <div className="text-[11px] text-ink-400">{sublabel}</div>}
    </div>
  );
}

function ResultIcon({ r }: { r: string }) {
  if (r === 'win') return <div className="rounded-lg bg-accent-100 p-2 text-accent-700"><Trophy className="h-4 w-4" /></div>;
  if (r === 'loss') return <div className="rounded-lg bg-bad/10 p-2 text-bad"><Frown className="h-4 w-4" /></div>;
  return <div className="rounded-lg bg-ink-100 p-2 text-ink-500 dark:bg-ink-700 dark:text-ink-300"><Equal className="h-4 w-4" /></div>;
}
