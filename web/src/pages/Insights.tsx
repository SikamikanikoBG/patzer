// Insights v2 — the "Beyond Chess.com" analytics page. Activity heatmap,
// rating trajectory, opening repertoire, mistake taxonomy, time-class breakdown.
// All charts are inline SVG (no extra deps); calls /api/insights/v2.

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Activity, BarChart3, Target, TrendingUp, Flame, AlertTriangle, BookOpen } from 'lucide-react';
import { api } from '../api';

type Color = 'white' | 'black';
interface OpeningRow { eco: string; name: string; color: Color; played: number; wins: number; draws: number; losses: number; avg_accuracy: number | null }
interface InsightsV2 {
  games_analyzed: number;
  activity_heatmap: { day: string; games: number; wins: number }[];
  rating_trajectory: Record<string, { t: string; r: number }[]>;
  time_class_stats: Record<string, { games: number; wins: number; draws: number; losses: number; avg_accuracy: number | null }>;
  opening_repertoire: OpeningRow[];
  mistake_taxonomy: {
    hung_pieces: number; back_rank: number; missed_mate: number;
    opening_pitfalls: number; endgame_drift: number;
    one_move_blunders: number; promising_to_losing: number;
  };
  phase_accuracy: { opening: number; middlegame: number; endgame: number };
  accuracy_trend: { t: string; acc: number; result: string | null }[];
}

export default function Insights() {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ['insights-v2'],
    queryFn: () => api.get<InsightsV2>('/api/insights/v2'),
  });

  if (isLoading) return <Skeleton />;
  if (!data || data.games_analyzed === 0) {
    return (
      <div className="card flex flex-col items-center gap-2 p-10 text-center">
        <BarChart3 className="h-8 w-8 text-chesscom-400" />
        <div className="text-base font-semibold">{t('insights.empty', { defaultValue: 'No insights yet' })}</div>
        <div className="text-sm text-chesscom-500">{t('insights.emptyDesc', { defaultValue: 'Analyze a few games and your weak spots will show up here.' })}</div>
        <Link to="/review" className="btn-primary mt-2 text-sm">{t('review.title')}</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="page-h1">{t('insights.title', { defaultValue: 'Insights' })}</h1>
        <p className="page-sub">{t('insights.subv2', { defaultValue: 'Patterns across your last {{n}} analyzed games.', n: data.games_analyzed })}</p>
      </header>

      {/* Phase accuracy + Time-class breakdown side-by-side */}
      <div className="grid gap-4 md:grid-cols-2">
        <PhaseAccuracyCard data={data.phase_accuracy} />
        <TimeClassCard data={data.time_class_stats} />
      </div>

      {/* Activity heatmap */}
      <ActivityHeatmap data={data.activity_heatmap} />

      {/* Rating trajectory + accuracy trend */}
      <div className="grid gap-4 md:grid-cols-2">
        <RatingTrajectoryCard data={data.rating_trajectory} />
        <AccuracyTrendCard data={data.accuracy_trend} />
      </div>

      {/* Mistake taxonomy + Opening repertoire */}
      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <MistakeTaxonomyCard data={data.mistake_taxonomy} />
        <OpeningRepertoireCard data={data.opening_repertoire} />
      </div>
    </div>
  );
}

/* ───── Phase accuracy ─────────────────────────────────────────────────── */
function PhaseAccuracyCard({ data }: { data: InsightsV2['phase_accuracy'] }) {
  const { t } = useTranslation();
  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center gap-2">
        <Target className="h-4 w-4 text-gold-500" />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-chesscom-500">{t('insights.phaseAccuracy', { defaultValue: 'Phase accuracy' })}</h2>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <PhaseStat label={t('review.opening', { defaultValue: 'Opening' })} value={data.opening} />
        <PhaseStat label={t('review.middlegame', { defaultValue: 'Middlegame' })} value={data.middlegame} />
        <PhaseStat label={t('review.endgame', { defaultValue: 'Endgame' })} value={data.endgame} />
      </div>
    </section>
  );
}

function PhaseStat({ label, value }: { label: string; value: number }) {
  const tone = value >= 80 ? 'text-board-dark' : value >= 60 ? 'text-gold-600' : 'text-mistake';
  return (
    <div className="rounded-md bg-chesscom-50/70 px-3 py-3 text-center dark:bg-chesscom-900/40">
      <div className="text-[10px] uppercase tracking-wide text-chesscom-500">{label}</div>
      <div className={`mt-0.5 font-mono text-2xl font-bold tabular-nums ${tone}`}>{value.toFixed(1)}<span className="text-xs opacity-70">%</span></div>
    </div>
  );
}

/* ───── Time-class stats ───────────────────────────────────────────────── */
function TimeClassCard({ data }: { data: InsightsV2['time_class_stats'] }) {
  const { t } = useTranslation();
  const order: { key: string; label: string }[] = [
    { key: 'bullet', label: 'Bullet' },
    { key: 'blitz', label: 'Blitz' },
    { key: 'rapid', label: 'Rapid' },
    { key: 'daily', label: 'Daily' },
  ];
  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center gap-2">
        <Activity className="h-4 w-4 text-board-dark" />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-chesscom-500">{t('insights.timeClass', { defaultValue: 'By time class' })}</h2>
      </div>
      <div className="space-y-2">
        {order.map(({ key, label }) => {
          const s = data[key];
          if (!s || s.games === 0) return (
            <div key={key} className="flex items-center justify-between text-xs text-chesscom-400">
              <span>{label}</span><span>—</span>
            </div>
          );
          const wp = (s.wins / s.games) * 100;
          const dp = (s.draws / s.games) * 100;
          return (
            <div key={key}>
              <div className="mb-1 flex items-baseline justify-between text-xs">
                <span className="font-medium text-chesscom-700 dark:text-chesscom-200">{label}</span>
                <span className="font-mono tabular-nums text-chesscom-500">
                  {s.games}g · {s.wins}W {s.draws}D {s.losses}L
                  {s.avg_accuracy != null && <> · {s.avg_accuracy.toFixed(1)}%</>}
                </span>
              </div>
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-chesscom-100 dark:bg-chesscom-900">
                <div className="h-full bg-board-dark" style={{ width: `${wp}%` }} />
                <div className="h-full bg-chesscom-300 dark:bg-chesscom-600" style={{ width: `${dp}%` }} />
                <div className="h-full bg-mistake/80" style={{ width: `${100 - wp - dp}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ───── Activity heatmap ───────────────────────────────────────────────── */
function ActivityHeatmap({ data }: { data: InsightsV2['activity_heatmap'] }) {
  const { t } = useTranslation();
  // Build a 53-week × 7-day grid ending today.
  const grid = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(today);
    // Fill back exactly 52 weeks + today's column.
    const totalDays = 53 * 7;
    const start = new Date(today);
    start.setDate(start.getDate() - (totalDays - 1));
    const dayMap = new Map<string, { games: number; wins: number }>();
    for (const r of data) dayMap.set(r.day, { games: r.games, wins: r.wins });

    const cells: { date: string; day: number; games: number; wins: number }[] = [];
    let max = 0;
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      const v = dayMap.get(iso) ?? { games: 0, wins: 0 };
      max = Math.max(max, v.games);
      cells.push({ date: iso, day: d.getDay(), games: v.games, wins: v.wins });
    }
    return { cells, max, end };
  }, [data]);

  function tone(games: number, max: number): string {
    if (games === 0) return 'fill-chesscom-100 dark:fill-chesscom-900';
    const ratio = games / Math.max(1, max);
    if (ratio < 0.25) return 'fill-board-dark/30';
    if (ratio < 0.5) return 'fill-board-dark/55';
    if (ratio < 0.75) return 'fill-board-dark/75';
    return 'fill-board-dark';
  }

  const totalGames = data.reduce((a, b) => a + b.games, 0);
  const totalWins = data.reduce((a, b) => a + b.wins, 0);

  // 53 cols × 7 rows. Cell 12px, gap 2px. Width ≈ 53*14 = 742, fits 760 board col.
  const cellSize = 11;
  const cellGap = 2;
  const cols = 53;
  const rows = 7;
  const W = cols * (cellSize + cellGap);
  const H = rows * (cellSize + cellGap);

  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-mistake" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-chesscom-500">{t('insights.activity', { defaultValue: 'Activity' })}</h2>
        </div>
        <div className="text-[11px] text-chesscom-500">
          {t('insights.activityFooter', { defaultValue: '{{games}} games · {{wins}} wins in last 12 months', games: totalGames, wins: totalWins })}
        </div>
      </div>
      <div className="overflow-x-auto">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block">
          {grid.cells.map((c, i) => {
            const col = Math.floor(i / 7);
            const row = i % 7;
            const x = col * (cellSize + cellGap);
            const y = row * (cellSize + cellGap);
            return (
              <rect
                key={c.date}
                x={x}
                y={y}
                width={cellSize}
                height={cellSize}
                rx={2}
                className={tone(c.games, grid.max)}
              >
                <title>{`${c.date} — ${c.games} game${c.games === 1 ? '' : 's'}${c.games > 0 ? `, ${c.wins} won` : ''}`}</title>
              </rect>
            );
          })}
        </svg>
      </div>
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-chesscom-400">
        <span>{t('insights.less', { defaultValue: 'Less' })}</span>
        <span className="h-2.5 w-2.5 rounded-sm bg-chesscom-100 dark:bg-chesscom-900" />
        <span className="h-2.5 w-2.5 rounded-sm bg-board-dark/30" />
        <span className="h-2.5 w-2.5 rounded-sm bg-board-dark/55" />
        <span className="h-2.5 w-2.5 rounded-sm bg-board-dark/75" />
        <span className="h-2.5 w-2.5 rounded-sm bg-board-dark" />
        <span>{t('insights.more', { defaultValue: 'More' })}</span>
      </div>
    </section>
  );
}

/* ───── Rating trajectory ─────────────────────────────────────────────── */
function RatingTrajectoryCard({ data }: { data: InsightsV2['rating_trajectory'] }) {
  const { t } = useTranslation();
  const series = (['rapid', 'blitz', 'bullet', 'daily'] as const)
    .map((k) => ({ key: k, points: data[k] ?? [] }))
    .filter((s) => s.points.length > 0);

  if (series.length === 0) {
    return (
      <section className="card p-4">
        <div className="mb-3 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-board-dark" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-chesscom-500">{t('insights.ratingTrend', { defaultValue: 'Rating trajectory' })}</h2>
        </div>
        <div className="py-6 text-center text-xs text-chesscom-400">{t('insights.noRatedGames', { defaultValue: 'No rated PvP games yet.' })}</div>
      </section>
    );
  }

  // Combined Y axis across all series
  const all = series.flatMap((s) => s.points.map((p) => p.r));
  let min = Math.min(...all);
  let max = Math.max(...all);
  if (min === max) { min -= 50; max += 50; }
  const pad = Math.max(20, Math.round((max - min) * 0.08));
  min -= pad; max += pad;

  const W = 480, H = 140, padX = 28, padY = 14;
  const colors: Record<string, string> = {
    rapid: '#769656',
    blitz: '#e0a02b',
    bullet: '#c63b3a',
    daily: '#6c7a89',
  };
  const xs = series.flatMap((s) => s.points.map((p) => new Date(p.t).getTime()));
  const tMin = Math.min(...xs), tMax = Math.max(...xs);
  const xScale = (t: number) => padX + ((t - tMin) / Math.max(1, tMax - tMin)) * (W - 2 * padX);
  const yScale = (r: number) => H - padY - ((r - min) / (max - min)) * (H - 2 * padY);

  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-board-dark" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-chesscom-500">{t('insights.ratingTrend', { defaultValue: 'Rating trajectory' })}</h2>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-chesscom-500">
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colors[s.key] }} />
              <span className="capitalize">{s.key}</span>
            </span>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {/* y axis labels */}
        {[min, (min + max) / 2, max].map((v, i) => (
          <g key={i}>
            <line x1={padX} x2={W - padX} y1={yScale(v)} y2={yScale(v)} className="stroke-chesscom-200 dark:stroke-chesscom-700" strokeWidth={0.5} strokeDasharray="2 3" />
            <text x={padX - 4} y={yScale(v) + 3} textAnchor="end" fontSize={9} className="fill-chesscom-400">{Math.round(v)}</text>
          </g>
        ))}
        {series.map((s) => {
          const path = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(new Date(p.t).getTime()).toFixed(1)},${yScale(p.r).toFixed(1)}`).join(' ');
          return (
            <g key={s.key}>
              <path d={path} fill="none" stroke={colors[s.key]} strokeWidth={1.5} />
              {s.points.map((p, i) => (
                <circle key={i} cx={xScale(new Date(p.t).getTime())} cy={yScale(p.r)} r={1.6} fill={colors[s.key]}>
                  <title>{`${s.key} ${p.r} · ${new Date(p.t).toLocaleDateString()}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
    </section>
  );
}

/* ───── Accuracy trend ─────────────────────────────────────────────────── */
function AccuracyTrendCard({ data }: { data: InsightsV2['accuracy_trend'] }) {
  const { t } = useTranslation();
  if (data.length === 0) {
    return (
      <section className="card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Target className="h-4 w-4 text-gold-500" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-chesscom-500">{t('insights.accuracyTrend', { defaultValue: 'Accuracy trend' })}</h2>
        </div>
        <div className="py-6 text-center text-xs text-chesscom-400">—</div>
      </section>
    );
  }
  const W = 480, H = 140, padX = 28, padY = 14;
  const xs = data.map((_, i) => i);
  const xMin = 0, xMax = Math.max(1, xs[xs.length - 1] ?? 1);
  const yMin = 0, yMax = 100;
  const xScale = (i: number) => padX + ((i - xMin) / Math.max(1, xMax - xMin)) * (W - 2 * padX);
  const yScale = (v: number) => H - padY - ((v - yMin) / (yMax - yMin)) * (H - 2 * padY);
  const path = data.map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(p.acc).toFixed(1)}`).join(' ');
  const avg = data.reduce((a, b) => a + b.acc, 0) / data.length;
  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-gold-500" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-chesscom-500">{t('insights.accuracyTrend', { defaultValue: 'Accuracy trend' })}</h2>
        </div>
        <span className="font-mono text-xs tabular-nums text-chesscom-500">{t('insights.avg', { defaultValue: 'avg' })} {avg.toFixed(1)}%</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {[0, 50, 100].map((v) => (
          <line key={v} x1={padX} x2={W - padX} y1={yScale(v)} y2={yScale(v)} className="stroke-chesscom-200 dark:stroke-chesscom-700" strokeWidth={0.5} strokeDasharray="2 3" />
        ))}
        {/* avg line */}
        <line x1={padX} x2={W - padX} y1={yScale(avg)} y2={yScale(avg)} stroke="#e0a02b" strokeWidth={0.7} strokeDasharray="3 3" opacity={0.7} />
        <path d={path} fill="none" stroke="#769656" strokeWidth={1.5} />
        {data.map((p, i) => (
          <circle key={i} cx={xScale(i)} cy={yScale(p.acc)} r={1.8} fill={p.result === 'win' ? '#769656' : p.result === 'loss' ? '#c63b3a' : '#6c7a89'}>
            <title>{`${p.acc.toFixed(1)}% · ${p.result ?? '—'} · ${new Date(p.t).toLocaleDateString()}`}</title>
          </circle>
        ))}
        <text x={padX - 4} y={yScale(0) + 3} textAnchor="end" fontSize={9} className="fill-chesscom-400">0</text>
        <text x={padX - 4} y={yScale(50) + 3} textAnchor="end" fontSize={9} className="fill-chesscom-400">50</text>
        <text x={padX - 4} y={yScale(100) + 3} textAnchor="end" fontSize={9} className="fill-chesscom-400">100</text>
      </svg>
    </section>
  );
}

/* ───── Mistake taxonomy ──────────────────────────────────────────────── */
function MistakeTaxonomyCard({ data }: { data: InsightsV2['mistake_taxonomy'] }) {
  const { t } = useTranslation();
  const buckets: { key: keyof InsightsV2['mistake_taxonomy']; label: string; desc: string }[] = [
    { key: 'hung_pieces', label: t('insights.tax.hung', { defaultValue: 'Hung pieces' }), desc: t('insights.tax.hungDesc', { defaultValue: '≥2 pawns of material lost' }) },
    { key: 'one_move_blunders', label: t('insights.tax.oneMove', { defaultValue: 'One-move blunders' }), desc: t('insights.tax.oneMoveDesc', { defaultValue: 'Sudden cliff edges' }) },
    { key: 'back_rank', label: t('insights.tax.backRank', { defaultValue: 'Back-rank weakness' }), desc: t('insights.tax.backRankDesc', { defaultValue: 'King exposed on home rank' }) },
    { key: 'missed_mate', label: t('insights.tax.missedMate', { defaultValue: 'Missed wins / mates' }), desc: t('insights.tax.missedMateDesc', { defaultValue: 'You had it — and walked away' }) },
    { key: 'opening_pitfalls', label: t('insights.tax.openingTrap', { defaultValue: 'Opening pitfalls' }), desc: t('insights.tax.openingTrapDesc', { defaultValue: 'Mistakes before move 15' }) },
    { key: 'endgame_drift', label: t('insights.tax.endgameDrift', { defaultValue: 'Endgame drift' }), desc: t('insights.tax.endgameDriftDesc', { defaultValue: 'Errors in technical positions' }) },
    { key: 'promising_to_losing', label: t('insights.tax.promisingLosing', { defaultValue: 'Squandered advantages' }), desc: t('insights.tax.promisingLosingDesc', { defaultValue: '+1.5 → flat in one move' }) },
  ];
  const max = Math.max(1, ...buckets.map((b) => data[b.key]));
  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-mistake" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-chesscom-500">{t('insights.taxonomy', { defaultValue: 'Mistake taxonomy' })}</h2>
        </div>
        <Link to="/train" className="text-[11px] font-medium text-board-dark hover:underline">{t('insights.trainCta', { defaultValue: 'Train these →' })}</Link>
      </div>
      <div className="space-y-1.5">
        {buckets.sort((a, b) => data[b.key] - data[a.key]).map((b) => {
          const v = data[b.key];
          const pct = (v / max) * 100;
          return (
            <div key={b.key} className="grid grid-cols-[1fr_auto] items-center gap-2">
              <div className="min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-xs font-medium text-chesscom-700 dark:text-chesscom-200">{b.label}</span>
                  <span className="font-mono text-xs tabular-nums text-chesscom-500">{v}</span>
                </div>
                <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-chesscom-100 dark:bg-chesscom-900">
                  <div className="h-full bg-mistake/70" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-0.5 truncate text-[10px] text-chesscom-400">{b.desc}</div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ───── Opening repertoire ────────────────────────────────────────────── */
function OpeningRepertoireCard({ data }: { data: OpeningRow[] }) {
  const { t } = useTranslation();
  if (data.length === 0) {
    return (
      <section className="card p-4">
        <div className="mb-3 flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-gold-500" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-chesscom-500">{t('insights.openings', { defaultValue: 'Top openings' })}</h2>
        </div>
        <div className="py-6 text-center text-xs text-chesscom-400">—</div>
      </section>
    );
  }
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-chesscom-200 px-4 py-3 dark:border-chesscom-700">
        <BookOpen className="h-4 w-4 text-gold-500" />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-chesscom-500">{t('insights.openings', { defaultValue: 'Top openings' })}</h2>
      </div>
      <table className="w-full text-xs">
        <thead className="bg-chesscom-50/50 text-[10px] uppercase tracking-wide text-chesscom-500 dark:bg-chesscom-900/40">
          <tr>
            <th className="px-3 py-1.5 text-left">{t('insights.opening', { defaultValue: 'Opening' })}</th>
            <th className="px-2 py-1.5 text-center" title="As white / as black"><span className="sr-only">side</span>♔/♚</th>
            <th className="px-2 py-1.5 text-right">{t('insights.played', { defaultValue: 'Games' })}</th>
            <th className="px-2 py-1.5 text-right">{t('insights.score', { defaultValue: 'Score' })}</th>
            <th className="px-2 py-1.5 text-right">{t('insights.acc', { defaultValue: 'Acc' })}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((o) => {
            const total = Math.max(1, o.played);
            const score = (o.wins + 0.5 * o.draws) / total;
            const tone = score >= 0.55 ? 'text-board-dark' : score <= 0.4 ? 'text-mistake' : 'text-chesscom-700 dark:text-chesscom-200';
            return (
              <tr key={`${o.color}|${o.eco}`} className="border-t border-chesscom-100 dark:border-chesscom-700/60">
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="rounded bg-chesscom-100 px-1 py-px text-[10px] font-mono text-chesscom-600 dark:bg-chesscom-900/60 dark:text-chesscom-300">{o.eco}</span>
                    <span className="truncate font-medium text-chesscom-800 dark:text-chesscom-100">{o.name}</span>
                  </div>
                </td>
                <td className="px-2 py-1.5 text-center">{o.color === 'white' ? '♔' : '♚'}</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">{o.played}</td>
                <td className="px-2 py-1.5 text-right">
                  <span className={`font-mono tabular-nums ${tone}`}>{(score * 100).toFixed(0)}%</span>
                  <span className="ml-1 text-[10px] text-chesscom-400">{o.wins}/{o.draws}/{o.losses}</span>
                </td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">{o.avg_accuracy != null ? `${o.avg_accuracy.toFixed(1)}` : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function Skeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-7 w-40 rounded bg-chesscom-200 dark:bg-chesscom-700" />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="h-28 rounded-xl bg-chesscom-200 dark:bg-chesscom-700" />
        <div className="h-28 rounded-xl bg-chesscom-200 dark:bg-chesscom-700" />
      </div>
      <div className="h-32 rounded-xl bg-chesscom-200 dark:bg-chesscom-700" />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="h-40 rounded-xl bg-chesscom-200 dark:bg-chesscom-700" />
        <div className="h-40 rounded-xl bg-chesscom-200 dark:bg-chesscom-700" />
      </div>
    </div>
  );
}

