import { useEffect, useRef, useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LogOut, Home, Swords, BookOpen, Settings as SettingsIcon, Users, Server, Menu, X, BarChart3, Target, Search, Keyboard, BookMarked, ListChecks, Microscope, ChevronDown } from 'lucide-react';
import { api } from '../api';
import UpdateNotice from './UpdateNotice';
import { useAuth } from '../state/auth';
import { cn } from '../lib/utils';
import ChangelogModal from './ChangelogModal';
import GitHubStar from './GitHubStar';
import { LogoMark, LogoLockup } from './Logo';
import { LANGUAGES, normalizeLanguage } from '../lib/languages';

// v4.0.0 Layout — chess.com-style horizontal top bar.
// Replaces the v3 narrow left rail. The dark sage navbar (`bg-chesscom-900`)
// gives the app the same chrome as chess.com itself; primary nav pills carry
// gold underlines on the active route (matches chess.com's premium accent).
// v6: command palette trigger + shortcuts trigger live in the right cluster.

interface LayoutProps {
  onOpenPalette?: () => void;
  onOpenShortcuts?: () => void;
}

export default function Layout({ onOpenPalette, onOpenShortcuts }: LayoutProps) {
  const { t, i18n } = useTranslation();
  const uiLang = normalizeLanguage(i18n.language);
  const { user, refresh } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [version, setVersion] = useState<string>('');

  useEffect(() => {
    api.get<{ version: string }>('/api/meta')
      .then((d) => setVersion(d.version))
      .catch(() => setVersion(''));
  }, []);

  // Auto-close mobile drawer and the admin menu on route change
  useEffect(() => {
    setNavOpen(false);
    setAdminOpen(false);
  }, [location.pathname]);

  async function logout() {
    await api.post('/api/auth/logout');
    await refresh();
    nav('/login');
  }

  // Nine destinations plus an Admin menu don't fit on a laptop with labels
  // showing. A breakpoint can't decide this: an admin carries two more items
  // than a regular profile, and Bulgarian labels are noticeably wider than
  // English ones, so any fixed width is wrong for somebody. Measure instead —
  // if the pills would overflow, drop to icons with tooltips, which keeps
  // every destination one click away rather than hiding some of them.
  const navRef = useRef<HTMLElement | null>(null);
  const fullNavWidth = useRef(0);
  const [compactNav, setCompactNav] = useState(false);
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const check = () => {
      const available = nav.clientWidth;
      // dataset, not the closure: the observer can fire mid-update.
      const isCompact = nav.dataset.compact === '1';
      if (!isCompact) {
        // Labels are showing, so this is the width they actually need.
        fullNavWidth.current = nav.scrollWidth;
        if (nav.scrollWidth > available + 1) setCompactNav(true);
      } else if (fullNavWidth.current && available > fullNavWidth.current + 24) {
        // 24px of hysteresis so a window sitting exactly on the boundary
        // doesn't flip back and forth.
        setCompactNav(false);
      }
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [compactNav, user?.role, i18n.language]);
  const navLabelClass = compactNav ? 'hidden' : 'inline';

  function NavPill({ to, icon: Icon, label }: { to: string; icon: React.ElementType; label: string }) {
    return (
      <NavLink
        to={to}
        end
        title={label}
        className={({ isActive }) =>
          cn(
            'relative flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-2 text-sm font-medium transition-colors 2xl:px-3',
            isActive
              ? 'text-white'
              : 'text-chesscom-300 hover:bg-chesscom-800 hover:text-white',
            isActive && 'after:absolute after:inset-x-3 after:-bottom-0.5 after:h-0.5 after:rounded-full after:bg-gold-500',
          )
        }
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className={navLabelClass}>{label}</span>
      </NavLink>
    );
  }

  function MobileNavItem({ to, icon: Icon, label }: { to: string; icon: React.ElementType; label: string }) {
    return (
      <NavLink
        to={to}
        end
        className={({ isActive }) =>
          cn(
            'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
            isActive
              ? 'bg-gold-500 text-chesscom-900'
              : 'text-chesscom-200 hover:bg-chesscom-800 hover:text-white',
          )
        }
      >
        <Icon className="h-4 w-4" />
        <span>{label}</span>
      </NavLink>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-panel dark:bg-chesscom-950">
      <UpdateNotice />
      {/* Top bar — dark sage, horizontal nav. */}
      <header className="sticky top-0 z-30 bg-chesscom-900 text-white shadow-soft">
        <div className="mx-auto flex h-14 max-w-[1920px] items-center gap-2 px-3 sm:px-6">
          <NavLink to="/" className="flex shrink-0 items-center gap-2">
            <LogoMark size={28} />
            <span className="hidden text-base font-bold tracking-tight sm:inline">{t('app.name')}</span>
          </NavLink>

          {/* Desktop nav */}
          <nav ref={navRef} data-compact={compactNav ? '1' : '0'} className="ml-4 hidden min-w-0 flex-1 items-center gap-0.5 md:flex">
            <NavPill to="/" icon={Home} label={t('app.home')} />
            <NavPill to="/play" icon={Swords} label={t('home.playTitle')} />
            <NavPill to="/review" icon={BookOpen} label={t('home.reviewTitle')} />
            <NavPill to="/insights" icon={BarChart3} label={t('insights.title', { defaultValue: 'Insights' })} />
            <NavPill to="/train" icon={Target} label={t('train.nav', { defaultValue: 'Train' })} />
            <NavPill to="/openings" icon={BookMarked} label={t('openings.nav', { defaultValue: 'Openings' })} />
            <NavPill to="/plan" icon={ListChecks} label={t('plan.nav', { defaultValue: 'Plan' })} />
            <NavPill to="/players" icon={Users} label={t('players.nav', { defaultValue: 'Players' })} />
            <NavPill to="/lab" icon={Microscope} label={t('lab.nav', { defaultValue: 'Lab' })} />
            {user?.role === 'admin' && (
              <>
                <span className="mx-2 h-5 w-px bg-chesscom-700" />
                <div className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setAdminOpen((open) => !open)}
                    title={t('common.admin', { defaultValue: 'Admin' })}
                    aria-expanded={adminOpen}
                    aria-haspopup="menu"
                    className={cn(
                      'relative flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      adminOpen
                        ? 'bg-chesscom-800 text-white'
                        : 'text-chesscom-300 hover:bg-chesscom-800 hover:text-white',
                    )}
                  >
                    <Users className="h-4 w-4 shrink-0" />
                    <span className={navLabelClass}>{t('common.admin', { defaultValue: 'Admin' })}</span>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  {adminOpen && (
                    <div
                      role="menu"
                      className="absolute left-0 top-full mt-1 min-w-44 rounded-lg border border-chesscom-700 bg-chesscom-900 p-1 shadow-lg"
                    >
                      <NavLink
                        to="/admin/users"
                        role="menuitem"
                        onClick={() => setAdminOpen(false)}
                        className={({ isActive }) => cn(
                          'flex items-center gap-2 rounded-md px-3 py-2 text-sm',
                          isActive
                            ? 'bg-chesscom-800 text-white'
                            : 'text-chesscom-200 hover:bg-chesscom-800 hover:text-white',
                        )}
                      >
                        <Users className="h-4 w-4" />
                        <span>{t('admin.users')}</span>
                      </NavLink>
                      <NavLink
                        to="/admin/system"
                        role="menuitem"
                        onClick={() => setAdminOpen(false)}
                        className={({ isActive }) => cn(
                          'flex items-center gap-2 rounded-md px-3 py-2 text-sm',
                          isActive
                            ? 'bg-chesscom-800 text-white'
                            : 'text-chesscom-200 hover:bg-chesscom-800 hover:text-white',
                        )}
                      >
                        <Server className="h-4 w-4" />
                        <span>{t('admin.system')}</span>
                      </NavLink>
                    </div>
                  )}
                </div>
              </>
            )}
          </nav>

          <div className="flex flex-1 items-center justify-end gap-2 md:flex-none">
            {/* Command palette quick-trigger — visible cue for ⌘K. */}
            {onOpenPalette && (
              <button
                onClick={onOpenPalette}
                className="hidden shrink-0 items-center gap-2 rounded-md border border-chesscom-700 bg-chesscom-800/70 px-2.5 py-1.5 text-xs text-chesscom-300 hover:bg-chesscom-800 hover:text-white sm:inline-flex"
                title="Command palette (⌘K)"
              >
                <Search className="h-3.5 w-3.5" />
                <span className="hidden min-[1800px]:inline">{t('palette.search', { defaultValue: 'Search' })}</span>
                <kbd className="hidden rounded border border-chesscom-700 px-1 font-mono text-[11px] text-chesscom-300 min-[1800px]:inline">⌘K</kbd>
              </button>
            )}
            {onOpenShortcuts && (
              <button
                onClick={onOpenShortcuts}
                className="hidden shrink-0 rounded-md p-2 text-chesscom-300 hover:bg-chesscom-800 hover:text-white min-[1800px]:inline-flex"
                title={t('shortcuts.title', { defaultValue: 'Keyboard shortcuts' })}
              >
                <Keyboard className="h-4 w-4" />
              </button>
            )}
            {/* Language toggle — only on genuinely wide screens (2xl). Below
                that the nav plus the user cluster already fill the bar, and
                this was the first thing to hang off the right edge on a
                laptop. Nothing becomes unreachable: the switch is in
                Settings, in the command palette (⌘K → "Switch to …") and in
                the mobile drawer. */}
            <div className="hidden shrink-0 rounded-lg border border-chesscom-700 bg-chesscom-800 p-0.5 text-xs min-[1800px]:flex">
              {LANGUAGES.map((l) => (
                <button
                  key={l.code}
                  onClick={() => i18n.changeLanguage(l.code)}
                  className={cn('rounded-md px-2 py-1 transition-colors', uiLang === l.code ? 'bg-gold-500 text-chesscom-900' : 'text-chesscom-300 hover:text-white')}
                >{l.short}</button>
              ))}
            </div>

            {/* User chip */}
            <NavLink
              to="/settings"
              className="hidden shrink-0 items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-chesscom-800 sm:flex"
              title={`${user?.profile.display_name ?? ''} @${user?.username ?? ''}`}
            >
              <span className="text-lg leading-none">{user?.profile.avatar_emoji ?? '♟'}</span>
              <div className="hidden max-w-[10rem] text-right text-xs leading-tight xl:block">
                <div className="truncate font-medium">{user?.profile.display_name}</div>
                <div className="truncate text-[11px] text-chesscom-400">@{user?.username}</div>
              </div>
            </NavLink>

            <NavLink
              to="/settings"
              className="hidden shrink-0 rounded-md p-2 text-chesscom-300 hover:bg-chesscom-800 hover:text-white xl:inline-flex"
              title={t('common.settings')}
            >
              <SettingsIcon className="h-4 w-4" />
            </NavLink>

            <button
              onClick={logout}
              className="hidden shrink-0 items-center gap-1.5 rounded-md border border-chesscom-700 bg-chesscom-800/50 px-2.5 py-1.5 text-sm text-chesscom-200 hover:border-bad/60 hover:bg-bad/15 hover:text-white sm:inline-flex"
              title={t('common.logout')}
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden xl:inline">{t('common.logout')}</span>
            </button>

            {/* Mobile menu button */}
            <button
              onClick={() => setNavOpen(true)}
              className="rounded-lg p-2 text-chesscom-200 hover:bg-chesscom-800 md:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile drawer */}
      {navOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setNavOpen(false)} />
          <aside className="fixed inset-y-0 right-0 z-50 flex w-72 max-w-[85vw] flex-col overflow-y-auto bg-chesscom-900 p-4 text-white md:hidden">
            <div className="mb-3 flex items-center justify-between">
              <LogoLockup size={24} />
              <button onClick={() => setNavOpen(false)} className="rounded-lg p-1.5 text-chesscom-300 hover:bg-chesscom-800">
                <X className="h-5 w-5" />
              </button>
            </div>
            {user && (
              <NavLink
                to="/settings"
                className="mb-3 flex items-center gap-2 rounded-lg bg-chesscom-800/60 px-3 py-2 hover:bg-chesscom-800"
              >
                <span className="text-xl leading-none">{user.profile.avatar_emoji ?? '♟'}</span>
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="truncate text-sm font-medium">{user.profile.display_name}</div>
                  <div className="truncate text-xs text-chesscom-400">@{user.username}</div>
                </div>
              </NavLink>
            )}
            <nav className="space-y-1">
              <MobileNavItem to="/" icon={Home} label={t('app.home')} />
              <MobileNavItem to="/play" icon={Swords} label={t('home.playTitle')} />
              <MobileNavItem to="/review" icon={BookOpen} label={t('home.reviewTitle')} />
              <MobileNavItem to="/insights" icon={BarChart3} label={t('insights.title', { defaultValue: 'Insights' })} />
              <MobileNavItem to="/train" icon={Target} label={t('train.nav', { defaultValue: 'Train' })} />
              <MobileNavItem to="/openings" icon={BookMarked} label={t('openings.nav', { defaultValue: 'Openings' })} />
              <MobileNavItem to="/plan" icon={ListChecks} label={t('plan.nav', { defaultValue: 'Plan' })} />
              <MobileNavItem to="/players" icon={Users} label={t('players.nav', { defaultValue: 'Players' })} />
              <MobileNavItem to="/lab" icon={Microscope} label={t('lab.nav', { defaultValue: 'Lab' })} />
              <MobileNavItem to="/settings" icon={SettingsIcon} label={t('common.settings')} />
              {user?.role === 'admin' && (
                <>
                  <div className="px-3 pt-4 pb-1 text-[11px] uppercase tracking-wide text-chesscom-400">{t('common.admin')}</div>
                  <MobileNavItem to="/admin/users" icon={Users} label={t('admin.users')} />
                  <MobileNavItem to="/admin/system" icon={Server} label={t('admin.system')} />
                </>
              )}
            </nav>
            <div className="mt-auto space-y-2 pt-6">
              <div className="flex gap-1">
                {LANGUAGES.map((l) => (
                  <button key={l.code} onClick={() => i18n.changeLanguage(l.code)} className={cn('flex-1 rounded-lg px-2 py-1 text-xs', uiLang === l.code ? 'bg-gold-500 text-chesscom-900' : 'bg-chesscom-800 text-chesscom-200')}>{l.short}</button>
                ))}
              </div>
              <button onClick={logout} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-chesscom-200 hover:bg-chesscom-800">
                <LogOut className="h-4 w-4" />
                {t('common.logout')}
              </button>
            </div>
          </aside>
        </>
      )}

      {/* Main content */}
      <main className="flex-1">
        <div className="mx-auto max-w-7xl px-3 py-4 sm:px-6 sm:py-6">
          <Outlet />
        </div>
      </main>

      {/* Footer with version chip and the one place the repo is advertised. */}
      <footer className="border-t border-chesscom-200 bg-white px-3 py-2 text-xs text-chesscom-400 dark:border-chesscom-800 dark:bg-chesscom-900">
        <div className="flex items-center justify-center gap-2">
          {version && (
            <button
              onClick={() => setShowChangelog(true)}
              className="hover:text-chesscom-700 dark:hover:text-chesscom-200"
              title="View changelog"
            >
              Patzer v{version}
            </button>
          )}
          {version && <span aria-hidden="true">·</span>}
          <GitHubStar />
        </div>
      </footer>

      {showChangelog && <ChangelogModal onClose={() => setShowChangelog(false)} />}
    </div>
  );
}
