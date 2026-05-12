// AI-written Game Review panel. Renders the chess.com-style "Game Report"
// prose that comes from POST /api/games/:id/review (SSE streaming).

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, Loader2 } from 'lucide-react';
import { renderMarkdown, stripReasoning } from '../lib/markdown';

export interface GameReviewProse {
  version: number;
  language: 'en' | 'bg';
  audience: string;
  opening: { eco: string; name: string; prose: string } | null;
  summary: string;
  skill_assessment: string;
  phases: {
    opening: { from_ply: number; to_ply: number; accuracy: number; acpl: number; prose: string } | null;
    middlegame: { from_ply: number; to_ply: number; accuracy: number; acpl: number; prose: string } | null;
    endgame: { from_ply: number; to_ply: number; accuracy: number; acpl: number; prose: string } | null;
  };
  key_moments: Array<{
    ply: number; side: 'white' | 'black'; san: string;
    classification: string; cp_loss: number; win_pct_delta: number;
    best_san: string | null; title: string; prose: string;
  }>;
}

interface Props {
  gameId: number;
  /** Existing cached review, if any. */
  initial: GameReviewProse | null;
  /** Reports back when a moment is clicked so the parent can move the board. */
  onMomentJump?: (ply: number) => void;
  /** Called when prose is freshly generated; parent caches in component state. */
  onGenerated?: (review: GameReviewProse) => void;
}

interface ProgressEvent {
  step: 'opening' | 'phase:opening' | 'phase:middlegame' | 'phase:endgame' | 'summary' | 'moment';
  done: number;
  total: number;
  index?: number;
}

export default function GameReportPanel({ gameId, initial, onMomentJump, onGenerated }: Props) {
  const { t } = useTranslation();
  const [review, setReview] = useState<GameReviewProse | null>(initial);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { setReview(initial); }, [initial]);
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  async function generate() {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true); setError(null); setProgress(null);
    try {
      const res = await fetch(`/api/games/${gameId}/review`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'patzer' },
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        setError((j as { error?: string }).error ?? `HTTP ${res.status}`);
        setBusy(false);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, nl);
          buf = buf.slice(nl + 2);
          let event = 'message';
          let data = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).replace(/^ /, '');
          }
          if (event === 'progress') {
            try { setProgress(JSON.parse(data) as ProgressEvent); } catch { /* ignore */ }
          } else if (event === 'done') {
            try {
              const parsed = JSON.parse(data) as { review: GameReviewProse };
              setReview(parsed.review);
              onGenerated?.(parsed.review);
            } catch (err) {
              setError(`bad payload: ${(err as Error).message}`);
            }
          } else if (event === 'error') {
            setError(data);
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // No outer card / header here — this panel is mounted INSIDE a tab labelled
  // "AI report" in the analyzer's tab strip. A second header inside is what
  // gave the page a "analysis within analysis" feel.
  if (!review && !busy) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-xs text-chesscom-500">{t('review.gameReportDesc', { defaultValue: 'A written breakdown of the game by the AI coach. Highlights phases, key moments, and a skill estimate.' })}</p>
        <button onClick={generate} className="btn-primary w-full text-sm">
          <Sparkles className="h-4 w-4" />
          {t('review.generateReport', { defaultValue: 'Write AI report' })}
        </button>
        {error && <div className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">{error}</div>}
      </div>
    );
  }

  if (busy && !review) {
    const stepLabel = progress?.step ?? '...';
    const pct = progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 0;
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-gold-500" />
          <span className="text-sm font-semibold">{t('review.generating', { defaultValue: 'Writing AI report…' })}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-chesscom-100 dark:bg-chesscom-800">
          <div className="h-full bg-gold-500 transition-all duration-200" style={{ width: `${pct}%` }} />
        </div>
        <div className="text-xs text-chesscom-500">{stepLabel} · {progress?.done ?? 0}/{progress?.total ?? '?'}</div>
      </div>
    );
  }

  if (!review) return null;

  return (
    <div className="flex flex-col gap-3">
      <div
        className="coach-md text-sm text-chesscom-800 dark:text-chesscom-100"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(stripReasoning(review.summary)) }}
      />
      <div className="rounded-lg bg-chesscom-50 px-3 py-2 text-xs italic text-chesscom-700 dark:bg-chesscom-900/40 dark:text-chesscom-200">
        {review.skill_assessment}
      </div>
      {review.opening && (
        <div className="text-xs text-chesscom-500">
          <span className="font-semibold text-chesscom-700 dark:text-chesscom-200">{review.opening.name}</span>
          {review.opening.eco && <span className="ml-1 font-mono">({review.opening.eco})</span>} — {review.opening.prose}
        </div>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {(['opening', 'middlegame', 'endgame'] as const).map((k) => {
          const p = review.phases[k];
          if (!p) return null;
          return (
            <div key={k} className="rounded-lg bg-chesscom-50 p-2 text-xs dark:bg-chesscom-900/40">
              <div className="font-semibold capitalize">{t(`review.${k}`, { defaultValue: k })}</div>
              <div className="mt-0.5 font-mono text-chesscom-500">{p.accuracy.toFixed(1)}%</div>
              <div className="mt-1 line-clamp-3">{p.prose}</div>
            </div>
          );
        })}
      </div>
      {review.key_moments.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] uppercase tracking-wide text-chesscom-500">Key Moments</div>
          {review.key_moments.map((m) => (
            <button key={m.ply}
              onClick={() => onMomentJump?.(m.ply)}
              className="block w-full rounded-lg border border-chesscom-200 bg-white px-3 py-2 text-left text-xs hover:border-gold-500/40 hover:bg-gold-50/40 dark:border-chesscom-700 dark:bg-chesscom-800 dark:hover:bg-chesscom-900/40">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[11px] tabular-nums text-chesscom-500">#{Math.ceil(m.ply / 2)}{m.side === 'black' ? '…' : '.'}</span>
                <span className="font-semibold">{m.title}</span>
              </div>
              <div className="mt-0.5 text-chesscom-700 dark:text-chesscom-200">{m.prose}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
