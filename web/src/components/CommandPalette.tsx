// Command Palette — ⌘K / Ctrl+K. Global quick-search for navigation,
// recent games, and high-level actions. Patzer's killer-app UX detail
// over chess.com (which has no equivalent).

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Search, Home, Swords, BookOpen, BarChart3, Settings as SettingsIcon, Target,
  Trophy, Frown, Equal, Users, Server, Sun, Moon, Globe, LogOut, Star,
  BookMarked, ListChecks, Microscope,
} from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../state/auth';
import type { GameRow } from '../types';
import { cn } from '../lib/utils';

interface Action {
  id: string;
  label: string;
  hint?: string;
  icon: React.ElementType;
  group: 'nav' | 'action' | 'game';
  run: () => void;
  keywords?: string;
}

interface Props { open: boolean; onClose: () => void }

export default function CommandPalette({ open, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const { user, refresh } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Recent games — only fetched while palette is open.
  const { data: gamesData } = useQuery({
    queryKey: ['palette-games'],
    queryFn: () => api.get<{ games: GameRow[] }>('/api/games?limit=30'),
    enabled: open,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const actions = useMemo<Action[]>(() => {
    const base: Action[] = [
      { id: 'nav-home', label: t('app.home'), icon: Home, group: 'nav', run: () => { nav('/'); onClose(); } },
      { id: 'nav-play', label: t('home.playTitle'), icon: Swords, group: 'nav', run: () => { nav('/play'); onClose(); } },
      { id: 'nav-review', label: t('review.title'), icon: BookOpen, group: 'nav', run: () => { nav('/review'); onClose(); } },
      { id: 'nav-insights', label: t('insights.title', { defaultValue: 'Insights' }), icon: BarChart3, group: 'nav', run: () => { nav('/insights'); onClose(); } },
      { id: 'nav-train', label: t('train.title', { defaultValue: 'Tactic Trainer' }), icon: Target, group: 'nav', keywords: 'puzzle tactic train practice', run: () => { nav('/train'); onClose(); } },
      { id: 'nav-openings', label: t('openings.title', { defaultValue: 'Openings' }), icon: BookMarked, group: 'nav', keywords: 'opening repertoire tree eco', run: () => { nav('/openings'); onClose(); } },
      { id: 'nav-plan', label: t('plan.title', { defaultValue: 'Improvement plan' }), icon: ListChecks, group: 'nav', keywords: 'plan goals weekly improvement', run: () => { nav('/plan'); onClose(); } },
      { id: 'nav-lab', label: t('lab.title', { defaultValue: 'Lab' }), icon: Microscope, group: 'nav', keywords: 'lab sandbox engine analyze stockfish position', run: () => { nav('/lab'); onClose(); } },
      { id: 'nav-players', label: t('players.title', { defaultValue: 'Players' }), icon: Users, group: 'nav', keywords: 'players people friends social leaderboard profile challenge', run: () => { nav('/players'); onClose(); } },
      { id: 'nav-settings', label: t('common.settings'), icon: SettingsIcon, group: 'nav', run: () => { nav('/settings'); onClose(); } },
      { id: 'nav-bookmarks', label: t('palette.bookmarks', { defaultValue: 'Starred games' }), icon: Star, group: 'nav', run: () => { nav('/review?bookmarked=1'); onClose(); } },
    ];
    if (user?.role === 'admin') {
      base.push({ id: 'nav-admin-users', label: t('admin.users'), icon: Users, group: 'nav', run: () => { nav('/admin/users'); onClose(); } });
      base.push({ id: 'nav-admin-system', label: t('admin.system'), icon: Server, group: 'nav', run: () => { nav('/admin/system'); onClose(); } });
    }
    base.push(
      { id: 'lang-en', label: 'Switch to English', icon: Globe, group: 'action', keywords: 'language english', run: async () => { await i18n.changeLanguage('en'); onClose(); } },
      { id: 'lang-bg', label: 'Превключи на Български', icon: Globe, group: 'action', keywords: 'language bulgarian bg', run: async () => { await i18n.changeLanguage('bg'); onClose(); } },
      { id: 'theme-light', label: t('palette.themeLight', { defaultValue: 'Light theme' }), icon: Sun, group: 'action', run: async () => { await api.patch('/api/settings/profile', { site_theme: 'light' }); await refresh(); onClose(); } },
      { id: 'theme-dark', label: t('palette.themeDark', { defaultValue: 'Dark theme' }), icon: Moon, group: 'action', run: async () => { await api.patch('/api/settings/profile', { site_theme: 'dark' }); await refresh(); onClose(); } },
      { id: 'logout', label: t('common.logout'), icon: LogOut, group: 'action', run: async () => { await api.post('/api/auth/logout'); await refresh(); nav('/login'); onClose(); } },
    );
    // Recent games as actions
    for (const g of (gamesData?.games ?? []).slice(0, 12)) {
      const opp = g.user_color === 'white' ? g.black : g.white;
      const ResultIcon = g.result === 'win' ? Trophy : g.result === 'loss' ? Frown : Equal;
      base.push({
        id: `game-${g.id}`,
        label: `vs ${opp}`,
        hint: `${g.time_control ?? ''} · ${new Date(g.end_time).toLocaleDateString()} · ${g.result}`,
        icon: ResultIcon,
        group: 'game',
        keywords: `${g.white} ${g.black} ${g.opening_name ?? ''}`,
        run: () => { nav(`/review/${g.id}`); onClose(); },
      });
    }
    return base;
  }, [t, i18n, user, nav, onClose, gamesData, refresh]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return actions;
    return actions.filter((a) => {
      const hay = `${a.label} ${a.hint ?? ''} ${a.keywords ?? ''}`.toLowerCase();
      return hay.includes(s);
    });
  }, [actions, q]);

  useEffect(() => { setActive(0); }, [q]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(filtered.length - 1, i + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
      else if (e.key === 'Enter') { e.preventDefault(); filtered[active]?.run(); }
    }
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [open, filtered, active, onClose]);

  // Keep the active item in view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal="true">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/55 backdrop-blur-sm" />
      <div className="relative z-10 w-full max-w-xl overflow-hidden rounded-xl border border-chesscom-200 bg-white shadow-lift dark:border-chesscom-700 dark:bg-chesscom-800 animate-fade-in">
        <div className="flex items-center gap-2 border-b border-chesscom-200 px-3 py-2 dark:border-chesscom-700">
          <Search className="h-4 w-4 text-chesscom-400" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('palette.placeholder', { defaultValue: 'Type to search nav, actions, games…' })}
            className="flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-chesscom-400"
          />
          <kbd className="hidden rounded border border-chesscom-200 px-1.5 py-0.5 text-[11px] text-chesscom-400 sm:inline dark:border-chesscom-700">esc</kbd>
        </div>
        <div ref={listRef} className="max-h-[60vh] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-chesscom-400">
              {t('palette.empty', { defaultValue: 'No matches.' })}
            </div>
          ) : (
            <PaletteSection items={filtered} active={active} setActive={setActive} />
          )}
        </div>
        <div className="flex items-center justify-between border-t border-chesscom-200 bg-chesscom-50/50 px-3 py-1.5 text-[11px] text-chesscom-500 dark:border-chesscom-700 dark:bg-chesscom-900/40">
          <div className="flex items-center gap-3">
            <span><kbd className="rounded border border-chesscom-200 px-1 dark:border-chesscom-700">↑</kbd> <kbd className="rounded border border-chesscom-200 px-1 dark:border-chesscom-700">↓</kbd> {t('palette.navigate', { defaultValue: 'navigate' })}</span>
            <span><kbd className="rounded border border-chesscom-200 px-1 dark:border-chesscom-700">↵</kbd> {t('palette.select', { defaultValue: 'select' })}</span>
          </div>
          <span>{t('palette.tip', { defaultValue: '⌘K / Ctrl+K to open · ? for shortcuts' })}</span>
        </div>
      </div>
    </div>
  );
}

function PaletteSection({ items, active, setActive }: { items: Action[]; active: number; setActive: (i: number) => void }) {
  const groups: Record<Action['group'], Action[]> = { nav: [], action: [], game: [] };
  for (const a of items) groups[a.group].push(a);
  const labels: Record<Action['group'], string> = { nav: 'Navigate', action: 'Actions', game: 'Recent games' };
  let runningIndex = 0;
  return (
    <>
      {(['nav', 'action', 'game'] as const).map((key) => {
        const list = groups[key];
        if (list.length === 0) return null;
        return (
          <div key={key} className="mb-1">
            <div className="px-3 pb-0.5 pt-2 text-[11px] uppercase tracking-wide text-chesscom-400">{labels[key]}</div>
            {list.map((a) => {
              const i = runningIndex++;
              const isActive = i === active;
              return (
                <button
                  key={a.id}
                  data-i={i}
                  onMouseMove={() => setActive(i)}
                  onClick={a.run}
                  className={cn(
                    'flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors',
                    isActive ? 'bg-gold-500/15 text-chesscom-900 dark:text-chesscom-100' : 'text-chesscom-700 dark:text-chesscom-200 hover:bg-chesscom-100/60 dark:hover:bg-chesscom-700/40',
                  )}
                >
                  <a.icon className="h-4 w-4 shrink-0 text-chesscom-500" />
                  <span className="flex-1 truncate">{a.label}</span>
                  {a.hint && <span className="truncate text-xs text-chesscom-400">{a.hint}</span>}
                </button>
              );
            })}
          </div>
        );
      })}
    </>
  );
}
