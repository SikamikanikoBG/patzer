import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Star } from 'lucide-react';
import { cn } from '../lib/utils';

// A quiet "star the repo" affordance. Patzer is free and self-hosted, so the
// only currency a user can pay back with is a star — but a chess app is not
// the place for a pulsing call to action next to the board. It lives in the
// footer, in the changelog modal (right after you've read what you just got)
// and under the login card, and nowhere else.
//
// Once you click it we assume you starred — the browser can't actually know
// without your GitHub auth — and the link goes muted for good on this device.

export const REPO_URL = 'https://github.com/SikamikanikoBG/patzer';

const COUNT_KEY = 'github.stars';
const STARRED_KEY = 'github.starred';
const COUNT_TTL_MS = 24 * 60 * 60 * 1000;

// One API call a day per browser. The count is decoration: if GitHub is
// unreachable, rate-limits us, or the box has no internet at all, the link
// still works and simply shows no number.
function useStarCount(): number | null {
  const [count, setCount] = useState<number | null>(() => {
    try {
      const raw = localStorage.getItem(COUNT_KEY);
      if (!raw) return null;
      const { n, at } = JSON.parse(raw) as { n: number; at: number };
      return Date.now() - at < COUNT_TTL_MS ? n : null;
    } catch { return null; }
  });

  useEffect(() => {
    if (count !== null) return;
    let alive = true;
    fetch('https://api.github.com/repos/SikamikanikoBG/patzer')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { stargazers_count?: number } | null) => {
        if (!alive || typeof d?.stargazers_count !== 'number') return;
        setCount(d.stargazers_count);
        try { localStorage.setItem(COUNT_KEY, JSON.stringify({ n: d.stargazers_count, at: Date.now() })); } catch { /* ignore */ }
      })
      .catch(() => { /* no network, no number, no error in the UI */ });
    return () => { alive = false; };
    // Deliberately once per mount: `count` only ever goes null → number here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return count;
}

export function formatStars(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}k` : String(n);
}

interface Props {
  /** `footer` is the compact chip; `inline` carries a label and sits in prose. */
  variant?: 'footer' | 'inline';
  className?: string;
}

export default function GitHubStar({ variant = 'footer', className }: Props) {
  const { t } = useTranslation();
  const count = useStarCount();
  const [starred, setStarred] = useState<boolean>(() => {
    try { return localStorage.getItem(STARRED_KEY) === '1'; } catch { return false; }
  });

  function markStarred() {
    setStarred(true);
    try { localStorage.setItem(STARRED_KEY, '1'); } catch { /* ignore */ }
  }

  const label = starred
    ? t('github.starred', { defaultValue: 'Starred' })
    : t('github.star', { defaultValue: 'Star on GitHub' });
  const title = starred
    ? t('github.thanks', { defaultValue: 'Thanks for starring Patzer!' })
    : t('github.starTitle', { defaultValue: 'Star Patzer on GitHub — it is the whole thank-you the project asks for' });

  return (
    <a
      href={REPO_URL}
      target="_blank"
      rel="noreferrer"
      onClick={markStarred}
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md transition-colors',
        variant === 'footer' ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-1 text-sm',
        starred
          ? 'text-chesscom-400 hover:text-chesscom-600 dark:hover:text-chesscom-200'
          : 'text-gold-600 hover:bg-gold-500/10 hover:text-gold-700 dark:text-gold-500 dark:hover:text-gold-400',
        className,
      )}
    >
      <Star className={cn(variant === 'footer' ? 'h-3.5 w-3.5' : 'h-4 w-4', starred ? '' : 'fill-current')} />
      <span>{label}</span>
      {count !== null && (
        <span className="rounded bg-black/5 px-1 font-mono text-[11px] leading-4 dark:bg-white/10">
          {formatStars(count)}
        </span>
      )}
    </a>
  );
}
