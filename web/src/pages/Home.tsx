import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Swords, BookOpen, Settings as SettingsIcon, ChevronRight, Trophy, Frown, Equal, Zap, Flame, Target, Activity } from 'lucide-react';
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

  const cards = [
    { to: '/play',     icon: Swords,        title: t('home.playTitle'),     desc: t('home.playDesc'),     accent: 'from-emerald-500 to-emerald-700', icon_bg: 'bg-emerald-500/15 text-emerald-700' },
    { to: '/review',   icon: BookOpen,      title: t('home.reviewTitle'),   desc: t('home.reviewDesc'),   accent: 'from-amber-500 to-orange-700',     icon_bg: 'bg-amber-500/15 text-amber-700' },
    { to: '/settings', icon: SettingsIcon,  title: t('home.settingsTitle'), desc: t('home.settingsDesc'), accent: 'from-slate-500 to-slate-800',      icon_bg: 'bg-slate-500/15 text-slate-700' },
  ];

  const games = data?.games ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {/* Greeting card */}
      <motion.section
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="card-hover relative overflow-hidden"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-ink-900 to-ink-800 dark:from-cream dark:to-amber-50" />
        <div className="absolute -right-8 -top-8 text-[200px] leading-none opacity-[0.06] dark:opacity-[0.08]">♞</div>
        <div className="relative flex flex-col gap-3 p-6 sm:p-8">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-cream/15 text-3xl text-cream backdrop-blur dark:bg-ink-900/15 dark:text-ink-900">
              {user?.profile.avatar_emoji}
            </div>
            <div>
              <div className="text-sm uppercase tracking-wider text-cream/60 dark:text-ink-700/60">{t('login.title')}</div>
              <h1 className="text-2xl font-bold text-cream dark:text-ink-900 sm:text-3xl">
                {t('home.greeting', { name: user?.profile.display_name ?? '' })}
              </h1>
            </div>
          </div>
          <p className="text-sm text-cream/70 dark:text-ink-700/70">
            {t('app.tagline')}
          </p>
        </div>
      </motion.section>

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

      {/* Action cards */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <Zap className="h-4 w-4 text-accent-500" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-500">Jump in</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {cards.map((c, i) => (
            <motion.div key={c.to}
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 * (i + 1) }}>
              <Link to={c.to} className="group card-hover flex h-full flex-col p-5">
                <div className={`mb-4 flex h-11 w-11 items-center justify-center rounded-xl ${c.icon_bg}`}>
                  <c.icon className="h-5 w-5" />
                </div>
                <div className="flex flex-1 flex-col">
                  <div className="text-base font-semibold">{c.title}</div>
                  <div className="mt-1 text-sm text-ink-500 dark:text-ink-300">{c.desc}</div>
                </div>
                <div className="mt-4 flex items-center gap-1 text-sm font-medium text-accent-600 transition-transform group-hover:translate-x-1">
                  Open <ChevronRight className="h-4 w-4" />
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </section>

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
