import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, Loader2 } from 'lucide-react';
import { api } from '../api';

// Master-game statistics for the current position (Lichess Opening Explorer,
// proxied and cached by GET /api/openings/explorer). Shown next to — never
// instead of — the engine's own lines. When the upstream is unreachable the
// server answers { available: false } and the panel collapses to one muted
// line instead of an error.

interface ExplorerMove {
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
  averageRating: number | null;
}

interface ExplorerResponse {
  available: boolean;
  white?: number;
  draws?: number;
  black?: number;
  total?: number;
  moves?: ExplorerMove[];
  opening?: { eco: string; name: string } | null;
}

function pct(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 100) : 0;
}

function WdlBar({ white, draws, black }: { white: number; draws: number; black: number }) {
  const total = white + draws + black;
  if (total === 0) return null;
  const w = pct(white, total), d = pct(draws, total), b = Math.max(0, 100 - w - d);
  return (
    <div className="flex h-4 w-full overflow-hidden rounded text-[10px] font-semibold leading-4" title={`${w}% · ${d}% · ${b}%`}>
      <div className="bg-chesscom-50 text-chesscom-800 text-center" style={{ width: `${w}%` }}>{w >= 12 ? `${w}%` : ''}</div>
      <div className="bg-chesscom-300 text-chesscom-900 text-center dark:bg-chesscom-500 dark:text-chesscom-100" style={{ width: `${d}%` }}>{d >= 12 ? `${d}%` : ''}</div>
      <div className="bg-chesscom-800 text-chesscom-100 text-center dark:bg-chesscom-950" style={{ width: `${b}%` }}>{b >= 12 ? `${b}%` : ''}</div>
    </div>
  );
}

export default function ExplorerPanel({ fen, onPreview }: { fen: string; onPreview?: (uci: string | null) => void }) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  const [data, setData] = useState<ExplorerResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !fen) return;
    let cancelled = false;
    setLoading(true);
    const handle = window.setTimeout(() => {
      api.get<ExplorerResponse>(`/api/openings/explorer?fen=${encodeURIComponent(fen)}`)
        .then((r) => { if (!cancelled) { setData(r); setLoading(false); } })
        .catch(() => { if (!cancelled) { setData({ available: false }); setLoading(false); } });
    }, 300);
    return () => { cancelled = true; window.clearTimeout(handle); };
  }, [enabled, fen]);

  const total = data?.total ?? 0;

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-1 border-b border-chesscom-100 bg-chesscom-50/40 px-3 py-2 dark:border-chesscom-700 dark:bg-chesscom-900/40">
        <BookOpen className="h-3.5 w-3.5 text-chesscom-500" />
        <span className="text-xs font-semibold uppercase tracking-wider text-chesscom-500">
          {t('explorer.title', { defaultValue: 'Master games' })}
        </span>
        <button
          onClick={() => setEnabled((s) => !s)}
          className={`btn-ghost ml-auto px-2 py-1 text-xs ${enabled ? 'text-board-dark' : ''}`}
        >
          {enabled ? t('review.linesHide', { defaultValue: 'Hide' }) : t('explorer.show', { defaultValue: 'Show master stats' })}
        </button>
      </div>
      {enabled && (
        <div className="space-y-2 px-3 py-2 text-xs">
          {loading && !data && (
            <div className="flex items-center gap-2 py-1 text-chesscom-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('review.linesFetching', { defaultValue: 'fetching…' })}
            </div>
          )}
          {data && !data.available && (
            <div className="py-1 text-chesscom-400">{t('explorer.unavailable', { defaultValue: 'Lichess master database unreachable right now.' })}</div>
          )}
          {data?.available && total === 0 && (
            <div className="py-1 text-chesscom-400">{t('explorer.noGames', { defaultValue: 'No master games from this position.' })}</div>
          )}
          {data?.available && total > 0 && (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-chesscom-700 dark:text-chesscom-300">
                  {t('explorer.games', { count: total, defaultValue: '{{count}} master games' })}
                </span>
                {data.opening && (
                  <span className="truncate text-[11px] text-chesscom-500">{data.opening.eco} · {data.opening.name}</span>
                )}
              </div>
              <WdlBar white={data.white ?? 0} draws={data.draws ?? 0} black={data.black ?? 0} />
              <div className="flex justify-between text-[10px] uppercase tracking-wider text-chesscom-500">
                <span>{t('explorer.white', { defaultValue: 'White' })} {pct(data.white ?? 0, total)}%</span>
                <span>{t('explorer.draw', { defaultValue: 'Draw' })} {pct(data.draws ?? 0, total)}%</span>
                <span>{t('explorer.black', { defaultValue: 'Black' })} {pct(data.black ?? 0, total)}%</span>
              </div>
              <div className="space-y-0.5 pt-1">
                {(data.moves ?? []).map((m) => {
                  const n = m.white + m.draws + m.black;
                  return (
                    <div
                      key={m.uci}
                      onMouseEnter={() => onPreview?.(m.uci)}
                      onMouseLeave={() => onPreview?.(null)}
                      className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-chesscom-50 dark:hover:bg-chesscom-900/40"
                    >
                      <span className="w-12 shrink-0 font-mono font-semibold text-chesscom-900 dark:text-chesscom-100">{m.san}</span>
                      <span className="w-14 shrink-0 tabular-nums text-chesscom-500">{pct(n, total)}% · {n.toLocaleString()}</span>
                      <div className="min-w-0 flex-1"><WdlBar white={m.white} draws={m.draws} black={m.black} /></div>
                      {m.averageRating != null && <span className="w-9 shrink-0 text-right tabular-nums text-chesscom-400">{m.averageRating}</span>}
                    </div>
                  );
                })}
              </div>
              {loading && (
                <div className="flex items-center gap-2 pt-1 text-[11px] text-chesscom-400">
                  <Loader2 className="h-3 w-3 animate-spin" /> {t('review.linesRefreshing', { defaultValue: 'refreshing…' })}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
