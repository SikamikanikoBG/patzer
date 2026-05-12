import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as Icons from 'lucide-react';
import {
  Swords, BookOpen, ChevronRight, Target, Sparkles,
  ListChecks, Award, ArrowRight,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuth } from '../state/auth';
import { api } from '../api';
import { fmtAccuracy } from '../lib/utils';
import type { GameRow } from '../types';

// Home — quieter, more hierarchical than the v7.1 design.
// One hero (greeting + stats inline + primary action), one "continue" row of
// at most three compact tiles, one slim recent-games list. No standalone
// stats strip, no "what's new" toast (footer chip handles that), no kitschy
// hero ornaments.

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

interface NextPuzzle {
  puzzle: { game_id: number; ply: number; played_san: string; classification: string; white: string; black: string } | null;
}

export default function Home() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const { data: gamesData } = useQuery({
    queryKey: ['games', 'home'],
    queryFn: () => api.get<{ games: GameRow[] }>('/api/games?limit=5'),
  });
  const { data: stats } = useQuery({
    queryKey: ['stats', 'me'],
    queryFn: () => api.get<Stats>('/api/stats/me'),
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

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Hero
        displayName={user?.profile.display_name ?? ''}
        avatar={user?.profile.avatar_emoji ?? '♟'}
        stats={stats ?? null}
        tagline={t('app.tagline')}
      />

      <ContinueRow
        puzzle={nextPuzzle?.puzzle ?? null}
        goals={planData?.goals ?? null}
        achievements={achievementsData?.achievements ?? null}
        playerName={user?.profile.display_name ?? ''}
      />

      <RecentGames games={games} />
    </div>
  );
}

/* ───────────────────────────────  HERO  ────────────────────────────────── */

function Hero({ displayName, avatar, stats, tagline }: {
  displayName: string; avatar: string; stats: Stats | null; tagline: string;
}) {
  const { t } = useTranslation();
  const hour = new Date().getHours();
  const greetingKey = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const greeting = t(`home.greet.${greetingKey}`, {
    defaultValue: greetingKey === 'morning' ? 'Good morning'
      : greetingKey === 'afternoon' ? 'Good afternoon' : 'Good evening',
  });

  const hasGames = stats && stats.total > 0;
  const winPct = stats && stats.total ? Math.round((stats.wins / stats.total) * 100) : 0;

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="relative isolate overflow-hidden rounded-2xl bg-gradient-to-br from-chesscom-900 via-[#3b4c2f] to-board-dark text-white shadow-lift"
    >
      {/* Background pattern — a subtle chess-board grid that fades to the
          edges. SVG inline so it ships as a data-URI; no extra request. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.08] [mask-image:radial-gradient(ellipse_at_top_right,black_30%,transparent_75%)]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 2 2' shape-rendering='crispEdges'><rect width='2' height='2' fill='%23ffffff' opacity='0'/><rect x='1' width='1' height='1' fill='%23ffffff'/><rect y='1' width='1' height='1' fill='%23ffffff'/></svg>\")",
          backgroundSize: '56px 56px',
        }}
      />

      <div className="relative grid gap-6 p-6 sm:p-8 md:grid-cols-[1fr_auto] md:items-end">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-2xl backdrop-blur">
              {avatar}
            </div>
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-[0.18em] text-white/55">{greeting}</div>
              <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">{displayName}</h1>
            </div>
          </div>

          {hasGames ? (
            <div className="mt-5 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm text-white/75">
              <StatInline value={stats!.total.toLocaleString()} label={t('home.statGames', { defaultValue: 'games' })} />
              <StatInline value={`${winPct}%`} label={t('home.statWinRate', { defaultValue: 'win rate' })} />
              {stats!.avg_accuracy != null && (
                <StatInline value={`${stats!.avg_accuracy}%`} label={t('home.statAccuracy', { defaultValue: 'accuracy' })} />
              )}
              {stats!.streak && (
                <StatInline
                  value={`${stats!.streak.count}`}
                  label={t(`home.streak.${stats!.streak.kind}`, { defaultValue: `${stats!.streak.kind} streak` })}
                  glow={stats!.streak.kind === 'win'}
                />
              )}
            </div>
          ) : (
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-white/75">{tagline}</p>
          )}
        </div>

        <div className="flex flex-wrap gap-2 md:flex-col md:items-end">
          <Link
            to="/play"
            className="group inline-flex items-center gap-2 rounded-md bg-green-500 px-5 py-2.5 text-sm font-bold text-white shadow-soft transition-all hover:bg-green-600 hover:shadow-lift focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-chesscom-900"
          >
            <Swords className="h-4 w-4" />
            {t('home.playTitle')}
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <Link
            to="/review"
            className="inline-flex items-center gap-2 rounded-md bg-white/10 px-4 py-2 text-xs font-medium text-white/90 backdrop-blur transition-colors hover:bg-white/15 hover:text-white"
          >
            <BookOpen className="h-3.5 w-3.5" />
            {t('home.reviewTitle')}
          </Link>
        </div>
      </div>
    </motion.section>
  );
}

function StatInline({ value, label, glow }: { value: string; label: string; glow?: boolean }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className={`font-mono text-xl font-semibold tabular-nums ${glow ? 'text-gold-300' : 'text-white'}`}>
        {value}
      </span>
      <span className="text-xs uppercase tracking-wider text-white/55">{label}</span>
    </span>
  );
}

/* ───────────────────────  CONTINUE YOUR JOURNEY  ───────────────────────── */

function ContinueRow({ puzzle, goals, achievements, playerName }: {
  puzzle: NextPuzzle['puzzle'];
  goals: PlanGoal[] | null;
  achievements: Achievement[] | null;
  playerName: string;
}) {
  // Stagger entrance — modest. 60ms between cards, no scale or rotate gimmicks.
  const variants = {
    hidden: { opacity: 0, y: 8 },
    show: (i: number) => ({ opacity: 1, y: 0, transition: { delay: 0.05 + i * 0.06, duration: 0.3, ease: 'easeOut' as const } }),
  };

  return (
    <section>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <motion.div initial="hidden" animate="show" custom={0} variants={variants}>
          <PuzzleTile puzzle={puzzle} playerName={playerName} />
        </motion.div>
        <motion.div initial="hidden" animate="show" custom={1} variants={variants}>
          <PlanTile goals={goals} />
        </motion.div>
        <motion.div initial="hidden" animate="show" custom={2} variants={variants}>
          <AchievementsTile achievements={achievements} />
        </motion.div>
      </div>
    </section>
  );
}

function PuzzleTile({ puzzle, playerName }: { puzzle: NextPuzzle['puzzle']; playerName: string }) {
  const { t } = useTranslation();
  if (!puzzle) {
    return (
      <Link to="/train" className="card-hover flex h-full items-start gap-3 p-4">
        <Pill tone="muted" Icon={Target} />
        <div className="min-w-0 flex-1">
          <Kicker>{t('home.todayPuzzle', { defaultValue: "Today's puzzle" })}</Kicker>
          <Title>{t('home.puzzleEmpty', { defaultValue: 'No puzzles yet — play a few games' })}</Title>
          <Sub>{t('home.puzzleEmptyDesc', { defaultValue: 'Puzzles come from your own analyzed blunders.' })}</Sub>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-chesscom-400" />
      </Link>
    );
  }
  const opponent = playerName === puzzle.white ? puzzle.black : puzzle.white;
  return (
    <Link to="/train" className="card-hover flex h-full items-start gap-3 p-4">
      <Pill tone="mistake" Icon={Target} />
      <div className="min-w-0 flex-1">
        <Kicker>{t('home.todayPuzzle', { defaultValue: "Today's puzzle" })}</Kicker>
        <Title>
          {t('home.todayPuzzleTitle', {
            defaultValue: 'You played {{san}}. Find a stronger move.',
            san: puzzle.played_san,
          })}
        </Title>
        <Sub>{t('home.fromGame', { defaultValue: 'From your game vs {{opp}}', opp: opponent })}</Sub>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-chesscom-400" />
    </Link>
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
      <Link to="/plan" className="card-hover flex h-full items-start gap-3 p-4">
        <Pill tone="board" Icon={ListChecks} />
        <div className="min-w-0 flex-1">
          <Kicker>{t('home.planLabel', { defaultValue: "This week's plan" })}</Kicker>
          <Title>{t('home.planEmpty', { defaultValue: 'Build your first improvement plan' })}</Title>
          <Sub>{t('home.planEmptyDesc', { defaultValue: 'Pick a few weekly goals — puzzles, openings, accuracy.' })}</Sub>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-chesscom-400" />
      </Link>
    );
  }

  const pct = imminent ? Math.min(100, Math.round((imminent.progress / Math.max(1, imminent.target)) * 100)) : 0;
  return (
    <Link to="/plan" className="card-hover flex h-full items-start gap-3 p-4">
      <Pill tone="board" Icon={ListChecks} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <Kicker>{t('home.planLabel', { defaultValue: "This week's plan" })}</Kicker>
          <span className="font-mono text-[11px] tabular-nums text-chesscom-500">
            {active.length} {t('home.planActive', { defaultValue: 'active' })}
          </span>
        </div>
        {imminent && (
          <>
            <Title>{imminent.title}</Title>
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-chesscom-100 dark:bg-chesscom-900">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ delay: 0.4, duration: 0.6, ease: 'easeOut' }}
                  className="h-full bg-board-dark"
                />
              </div>
              <span className="font-mono text-[11px] tabular-nums text-chesscom-500">
                {imminent.progress}/{imminent.target}
              </span>
            </div>
          </>
        )}
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-chesscom-400" />
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

  return (
    <Link to="/insights#achievements" className="card-hover flex h-full items-start gap-3 p-4">
      <Pill tone="gold" Icon={Award} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <Kicker>{t('home.achievementsLabel', { defaultValue: 'Achievements' })}</Kicker>
          <span className="font-mono text-[11px] tabular-nums text-chesscom-500">
            {unlocked.length}/{list.length || '—'}
          </span>
        </div>
        {recent.length > 0 ? (
          <>
            <Title>{recent[0]!.title}</Title>
            <div className="mt-2 flex items-center gap-1.5">
              {recent.map((a) => {
                const Icon = resolveIcon(a.icon);
                return (
                  <span
                    key={a.id}
                    title={a.title}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gold-500/15 text-gold-600 ring-1 ring-gold-500/30"
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                );
              })}
              {unlocked.length > 3 && (
                <span className="text-[11px] text-chesscom-500">+{unlocked.length - 3}</span>
              )}
            </div>
          </>
        ) : (
          <>
            <Title>{t('home.achievementsEmpty', { defaultValue: 'Earn your first badge' })}</Title>
            <Sub>{t('home.achievementsEmptyDesc', { defaultValue: 'Play and analyze a game to unlock.', n: list.length })}</Sub>
          </>
        )}
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-chesscom-400" />
    </Link>
  );
}

/* ─────────────────────────────  RECENT GAMES  ──────────────────────────── */

function RecentGames({ games }: { games: GameRow[] }) {
  const { t } = useTranslation();
  if (games.length === 0) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.3 }}
        className="card flex items-start gap-3 p-5"
      >
        <Pill tone="board" Icon={Sparkles} />
        <div className="min-w-0 flex-1">
          <Title>{t('home.firstRunTitle', { defaultValue: 'Play your first game' })}</Title>
          <Sub>{t('home.firstRunReady', { defaultValue: 'Hop into Play vs Bot — or import your Chess.com games to review.' })}</Sub>
        </div>
      </motion.section>
    );
  }
  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.18, duration: 0.3 }}
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight text-chesscom-900 dark:text-chesscom-100">
          {t('home.recentGames', { defaultValue: 'Recent games' })}
        </h2>
        <Link to="/review" className="text-xs font-medium text-board-dark hover:underline">
          {t('home.viewAll', { defaultValue: 'View all →' })}
        </Link>
      </div>
      <ul className="divide-y divide-chesscom-100 overflow-hidden rounded-xl border border-chesscom-200 bg-white shadow-soft dark:divide-chesscom-800 dark:border-chesscom-700 dark:bg-chesscom-800">
        {games.map((g) => (
          <li key={g.id}>
            <Link
              to={`/review/${g.id}`}
              className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-chesscom-50 dark:hover:bg-chesscom-900/40 sm:px-4 sm:py-3"
            >
              <ResultGlyph r={g.result} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {g.user_color === 'white' ? (
                    <>
                      <span className="text-chesscom-900 dark:text-chesscom-100">{g.white}</span>
                      <span className="mx-1.5 text-chesscom-400">vs</span>
                      <span className="text-chesscom-500">{g.black}</span>
                    </>
                  ) : (
                    <>
                      <span className="text-chesscom-500">{g.white}</span>
                      <span className="mx-1.5 text-chesscom-400">vs</span>
                      <span className="text-chesscom-900 dark:text-chesscom-100">{g.black}</span>
                    </>
                  )}
                </div>
                <div className="text-xs text-chesscom-500">
                  <span>{new Date(g.end_time).toLocaleDateString()}</span>
                  <span className="mx-1.5 text-chesscom-400">·</span>
                  <span>{g.time_control}</span>
                  {g.opening_name && (
                    <span className="hidden sm:inline">
                      <span className="mx-1.5 text-chesscom-400">·</span>
                      <span className="truncate">{g.opening_name}</span>
                    </span>
                  )}
                </div>
              </div>
              <div className="shrink-0 text-right">
                {g.analyzed ? (
                  <div className="font-mono text-xs tabular-nums">
                    <span className={g.user_color === 'white' ? 'font-semibold text-chesscom-900 dark:text-chesscom-100' : 'text-chesscom-500'}>
                      {fmtAccuracy(g.accuracy_white)}
                    </span>
                    <span className="mx-1 text-chesscom-400">/</span>
                    <span className={g.user_color === 'black' ? 'font-semibold text-chesscom-900 dark:text-chesscom-100' : 'text-chesscom-500'}>
                      {fmtAccuracy(g.accuracy_black)}
                    </span>
                  </div>
                ) : (
                  <span className="text-[11px] uppercase tracking-wider text-chesscom-400">
                    {t('home.unreviewed', { defaultValue: 'unreviewed' })}
                  </span>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </motion.section>
  );
}

/* ─────────────────────────────────  ATOMS  ─────────────────────────────── */

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-chesscom-500">{children}</div>
  );
}

function Title({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-0.5 line-clamp-2 text-sm font-semibold text-chesscom-900 dark:text-chesscom-100">{children}</div>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-1 line-clamp-2 text-xs text-chesscom-500">{children}</div>
  );
}

function Pill({ Icon, tone }: { Icon: React.ElementType; tone: 'gold' | 'board' | 'mistake' | 'muted' }) {
  const toneCls: Record<typeof tone, string> = {
    gold: 'bg-gold-500/15 text-gold-600',
    board: 'bg-board-dark/15 text-board-dark',
    mistake: 'bg-[color:var(--tw-bg)] text-[color:var(--tw-fg)]', // fallback if used
    muted: 'bg-chesscom-100 text-chesscom-500 dark:bg-chesscom-700 dark:text-chesscom-300',
  };
  // For 'mistake' tone use direct tailwind classes since we have move.mistake palette
  const cls = tone === 'mistake'
    ? 'bg-[#ffa459]/15 text-[#ffa459]'
    : toneCls[tone];
  return (
    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${cls}`}>
      <Icon className="h-4 w-4" />
    </div>
  );
}

function ResultGlyph({ r }: { r: string }) {
  if (r === 'win') {
    return (
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-green-500/15 text-xs font-bold text-green-500">
        W
      </span>
    );
  }
  if (r === 'loss') {
    return (
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-bad/15 text-xs font-bold text-bad">
        L
      </span>
    );
  }
  return (
    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-chesscom-100 text-xs font-bold text-chesscom-500 dark:bg-chesscom-700 dark:text-chesscom-300">
      D
    </span>
  );
}

function resolveIcon(name: string): React.ComponentType<{ className?: string }> {
  const lib = Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>;
  return lib[name] ?? lib.Award ?? (() => null);
}
