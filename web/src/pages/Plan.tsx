// Plan — weekly improvement goals derived from the user's recent play.
// The backend curates 3-5 goals each week (puzzles to solve, openings to
// rep, etc.). The user can regenerate to refresh the active set.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Icons from 'lucide-react';
import {
  ListChecks, RefreshCw, Sparkles, Check, ChevronDown, ChevronRight, ArrowRight,
  Target as TargetFallback,
} from 'lucide-react';

type GoalKind = 'puzzles_solve' | 'opening_play' | 'review_games' | 'accuracy' | 'win_streak';
type GoalStatus = 'active' | 'completed' | 'expired';

interface PlanGoal {
  id: number;
  kind: GoalKind;
  title: string;
  description: string;
  target: number;
  progress: number;
  status: GoalStatus;
  icon: string;
  created_at: string;
  completes_at: string;
  metadata: Record<string, unknown> | null;
}

import { api } from '../api';

const CTA_HREF: Record<GoalKind, { href: string; label: string }> = {
  puzzles_solve: { href: '/train', label: 'Train' },
  opening_play:  { href: '/play',  label: 'Play' },
  review_games:  { href: '/review', label: 'Review' },
  accuracy:      { href: '/play',  label: 'Play' },
  win_streak:    { href: '/play',  label: 'Play' },
};

export default function Plan() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [expiredOpen, setExpiredOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['plan'],
    queryFn: () => api.get<{ goals: PlanGoal[] }>('/api/plan'),
  });

  const regen = useMutation({
    mutationFn: () => api.post<{ goals: PlanGoal[] }>('/api/plan/regenerate'),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['plan'] }); },
  });

  const groups = useMemo(() => {
    const goals = data?.goals ?? [];
    const active = goals
      .filter((g) => g.status === 'active')
      .sort((a, b) => progressPct(b) - progressPct(a));
    const completed = goals.filter((g) => g.status === 'completed');
    const expired = goals.filter((g) => g.status === 'expired');
    return { active, completed, expired };
  }, [data]);

  if (isLoading) return <Skeleton />;

  const total = (data?.goals?.length ?? 0);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="page-h1 flex items-center gap-2">
            <ListChecks className="h-6 w-6 text-board-dark" />
            {t('plan.title', { defaultValue: 'Improvement plan' })}
          </h1>
          <p className="page-sub">
            {t('plan.subtitle', { defaultValue: 'A focused set of weekly goals based on your recent play.' })}
          </p>
        </div>
        <button
          onClick={() => regen.mutate()}
          disabled={regen.isPending}
          className="btn-secondary text-sm"
        >
          <RefreshCw className={`h-4 w-4 ${regen.isPending ? 'animate-spin' : ''}`} />
          {regen.isPending
            ? t('plan.regenerating', { defaultValue: 'Regenerating…' })
            : t('plan.regenerate', { defaultValue: 'Regenerate' })}
        </button>
      </header>

      {total === 0 ? (
        <div className="card flex flex-col items-center gap-3 p-10 text-center">
          <Sparkles className="h-8 w-8 text-gold-500" />
          <div className="text-base font-semibold">
            {t('plan.empty', { defaultValue: 'No goals yet — generate your first plan.' })}
          </div>
          <p className="max-w-md text-sm text-chesscom-500">
            {t('plan.emptyDesc', { defaultValue: 'Your plan refreshes weekly with focused targets drawn from what you actually need to improve.' })}
          </p>
          <button onClick={() => regen.mutate()} disabled={regen.isPending} className="btn-primary mt-2 text-sm">
            <Sparkles className="h-4 w-4" />
            {t('plan.generate', { defaultValue: 'Generate plan' })}
          </button>
        </div>
      ) : (
        <>
          {groups.active.length > 0 && (
            <section className="space-y-3">
              <SectionHeader
                label={t('plan.activeGroup', { defaultValue: 'Active' })}
                count={groups.active.length}
              />
              <div className="grid gap-3 md:grid-cols-2">
                {groups.active.map((g) => <GoalCard key={g.id} goal={g} />)}
              </div>
            </section>
          )}

          {groups.completed.length > 0 && (
            <section className="space-y-3">
              <SectionHeader
                label={t('plan.completedGroup', { defaultValue: 'Completed this week' })}
                count={groups.completed.length}
                tone="board-dark"
              />
              <div className="grid gap-3 md:grid-cols-2">
                {groups.completed.map((g) => <GoalCard key={g.id} goal={g} />)}
              </div>
            </section>
          )}

          {groups.expired.length > 0 && (
            <section className="space-y-3">
              <button
                onClick={() => setExpiredOpen((v) => !v)}
                className="flex w-full items-center gap-2 text-left"
              >
                {expiredOpen ? <ChevronDown className="h-3.5 w-3.5 text-chesscom-400" /> : <ChevronRight className="h-3.5 w-3.5 text-chesscom-400" />}
                <SectionHeader
                  label={t('plan.expiredGroup', { defaultValue: 'Expired' })}
                  count={groups.expired.length}
                  tone="chesscom-400"
                />
              </button>
              {expiredOpen && (
                <div className="grid gap-3 md:grid-cols-2">
                  {groups.expired.map((g) => <GoalCard key={g.id} goal={g} />)}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function SectionHeader({ label, count, tone = 'chesscom-500' }: { label: string; count: number; tone?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <h2 className={`text-xs font-semibold uppercase tracking-wider text-${tone}`}>{label}</h2>
      <span className="text-[10px] text-chesscom-400">{count}</span>
    </div>
  );
}

function GoalCard({ goal }: { goal: PlanGoal }) {
  const { t } = useTranslation();
  const Icon = resolveIcon(goal.icon);

  const pct = progressPct(goal);
  const completed = goal.status === 'completed';
  const expired = goal.status === 'expired';

  // Status-driven tones
  const borderTone = completed
    ? 'border-gold-500/60'
    : expired
    ? 'border-chesscom-300 dark:border-chesscom-700 opacity-70'
    : 'border-chesscom-200 dark:border-chesscom-700';
  const accentBg = completed
    ? 'bg-gold-500/15 text-gold-600'
    : expired
    ? 'bg-chesscom-100 text-chesscom-400 dark:bg-chesscom-700/40 dark:text-chesscom-300'
    : 'bg-board-dark/15 text-board-dark';

  const days = daysRemaining(goal.completes_at);
  const cta = CTA_HREF[goal.kind];

  return (
    <div className={`card relative overflow-hidden p-4 ${borderTone}`}>
      {completed && (
        <div className="pointer-events-none absolute -right-6 -top-6 text-gold-500/15">
          <Sparkles className="h-24 w-24" />
        </div>
      )}
      <div className="flex items-start gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${accentBg}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate text-sm font-semibold text-chesscom-900 dark:text-chesscom-100">
              {goal.title}
            </h3>
            {completed && <Check className="h-4 w-4 shrink-0 text-gold-600" />}
          </div>
          <p className="mt-0.5 text-xs text-chesscom-500">{goal.description}</p>
        </div>
      </div>

      <div className="mt-3 space-y-1.5">
        <div className="flex items-baseline justify-between text-[11px]">
          <span className="text-chesscom-500">
            {t('plan.progress', { defaultValue: 'Progress' })}
          </span>
          <span className="font-mono tabular-nums text-chesscom-700 dark:text-chesscom-200">
            {goal.progress} / {goal.target}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-chesscom-100 dark:bg-chesscom-900">
          <div
            className={`h-full transition-all ${
              completed ? 'bg-gold-500' : expired ? 'bg-chesscom-400' : 'bg-board-dark'
            }`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[10px] text-chesscom-400">
          <span>
            {expired
              ? t('plan.expired', { defaultValue: 'Expired' })
              : completed
              ? t('plan.done', { defaultValue: 'Done' })
              : days <= 0
              ? t('plan.endsToday', { defaultValue: 'ends today' })
              : t('plan.daysLeft', { defaultValue: '{{n}}d left', n: days })}
          </span>
          <span className="font-mono tabular-nums">{pct}%</span>
        </div>
      </div>

      {!completed && !expired && (
        <Link to={cta.href} className="btn-secondary mt-3 w-full text-sm">
          {t(`plan.cta.${goal.kind}`, { defaultValue: cta.label })}
          <ArrowRight className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}

function resolveIcon(name: string): React.ElementType {
  // lucide-react is exported as a namespace of named components. Look up by
  // string; fall back to a sensible default (Target) if the server returns
  // something we don't ship.
  const all = Icons as unknown as Record<string, unknown>;
  const candidate = all[name];
  if (typeof candidate === 'function' || (candidate && typeof candidate === 'object')) {
    return candidate as React.ElementType;
  }
  return TargetFallback;
}

function progressPct(g: PlanGoal): number {
  if (g.target <= 0) return 0;
  return Math.min(100, Math.round((g.progress / g.target) * 100));
}

function daysRemaining(completesAt: string): number {
  const end = new Date(completesAt).getTime();
  const now = Date.now();
  return Math.max(0, Math.ceil((end - now) / (24 * 60 * 60 * 1000)));
}

function Skeleton() {
  return (
    <div className="mx-auto max-w-5xl animate-pulse space-y-5">
      <div className="h-7 w-48 rounded bg-chesscom-200 dark:bg-chesscom-700" />
      <div className="h-4 w-72 rounded bg-chesscom-200 dark:bg-chesscom-700" />
      <div className="grid gap-3 md:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-32 rounded-xl bg-chesscom-200 dark:bg-chesscom-700" />
        ))}
      </div>
    </div>
  );
}
