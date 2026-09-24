import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fmtClock(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Stored time controls are either a clock ("600+0", chess.com's "180+2" or
 *  "1/86400") — shown as-is — or the keyword `untimed`, which needs words. */
export function fmtTimeControl(tc: string | null | undefined, t: (key: string) => string): string {
  if (!tc) return '—';
  return tc === 'untimed' ? t('play.tc.untimed') : tc;
}

export function fmtAccuracy(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n.toFixed(1)}%`;
}
