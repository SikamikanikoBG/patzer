import { useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LogOut, Home, Swords, BookOpen, Settings as SettingsIcon, Users, Server, Menu, X, BarChart3, Target, Search, Keyboard, BookMarked, ListChecks, Microscope } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../state/auth';
import { cn } from '../lib/utils';
import ChangelogModal from './ChangelogModal';
import { LogoMark, LogoLockup } from './Logo';

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
  const { user, refresh } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [version, setVersion] = useState<string>('');

  useEffect(() => {
    api.get<{ version: string }>('/api/meta')
      .then((d) => setVersion(d.version))
      .catch(() => setVersion(''));
  }, []);

  // Auto-close mobile drawer on route change
  useEffect(() => { setNavOpen(false); }, [location.pathname]);

  async function logout() {
    await api.post('/api/auth/logout');
    await refresh();
    nav('/login');
  }

  function NavPill({ to, icon: Icon, label }: { to: string; icon: React.ElementType; label: string }) {
    return (
      <NavLink
        to={to}
        end
        className={({ isActive }) =>
          cn(
            'relative flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            isActive
              ? 'text-white'
              : 'text-chesscom-300 hover:bg-chesscom-800 hover:text-white',
            isActive && 'after:absolute after:inset-x-3 after:-bottom-0.5 after:h-0.5 after:rounded-full after:bg-gold-500',
          )
        }
      >
        <Icon className="h-4 w-4" />
        <span>{label}</span>
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
      {/* Top bar — dark sage, horizontal nav. */}
      <header className="sticky top-0 z-30 bg-chesscom-900 text-white shadow-soft">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-3 sm:px-6">
          <NavLink to="/" className="flex shrink-0 items-center gap-2">
            <LogoMark size={28} />
            <span className="hidden text-base font-bold tracking-tight sm:inline">{t('app.name')}</span>
          </NavLink>

          {/* Desktop nav */}
          <nav className="ml-4 hidden flex-1 items-center gap-0.5 md:flex">
            <NavPill to="/" icon={Home} label={t('app.home')} />
            <NavPill to="/play" icon={Swords} label={t('home.playTitle')} />
            <NavPill to="/review" icon={BookOpen} label={t('home.reviewTitle')} />
            <NavPill to="/insights" icon={BarChart3} label={t('insights.title', { defaultValue: 'Insights' })} />
            <NavPill to="/train" icon={Target} label={t('train.nav', { defaultValue: 'Train' })} />
            <NavPill to="/openings" icon={BookMarked} label={t('openings.nav', { defaultValue: 'Openings' })} />
            <NavPill to="/plan" icon={ListChecks} label={t('plan.nav', { defaultValue: 'Plan' })} />
            <NavPill to="/lab" icon={Microscope} label={t('lab.nav', { defaultValue: 'Lab' })} />
            {user?.role === 'admin' && (
              <>
                <span className="mx-2 h-5 w-px bg-chesscom-700" />
                <NavPill to="/admin/users" icon={Users} label={t('admin.users')} />
                <NavPill to="/admin/system" icon={Server} label={t('admin.system')} />
              </>
            )}
          </nav>

          <div className="flex flex-1 items-center justify-end gap-2 md:flex-none">
            {/* Command palette quick-trigger — visible cue for ⌘K. */}
            {onOpenPalette && (
              <button
                onClick={onOpenPalette}
                className="hidden items-center gap-2 rounded-md border border-chesscom-700 bg-chesscom-800/70 px-2.5 py-1.5 text-xs text-chesscom-300 hover:bg-chesscom-800 hover:text-white sm:inline-flex"
                title="Command palette (⌘K)"
              >
                <Search className="h-3.5 w-3.5" />
                <span className="hidden lg:inline">{t('palette.search', { defaultValue: 'Search' })}</span>
                <kbd className="hidden rounded border border-chesscom-700 px-1 font-mono text-[10px] text-chesscom-300 lg:inline">⌘K</kbd>
              </button>
            )}
            {onOpenShortcuts && (
              <button
                onClick={onOpenShortcuts}
                className="hidden rounded-md p-2 text-chesscom-300 hover:bg-chesscom-800 hover:text-white sm:inline-flex"
                title={t('shortcuts.title', { defaultValue: 'Keyboard shortcuts' })}
              >
                <Keyboard className="h-4 w-4" />
              </button>
            )}
            {/* Language toggle */}
            <div className="hidden rounded-lg border border-chesscom-700 bg-chesscom-800 p-0.5 text-xs sm:flex">
              <button
                onClick={() => i18n.changeLanguage('en')}
                className={cn('rounded-md px-2 py-1 transition-colors', i18n.language === 'en' ? 'bg-gold-500 text-chesscom-900' : 'text-chesscom-300 hover:text-white')}
              >EN</button>
              <button
                onClick={() => i18n.changeLanguage('bg')}
                className={cn('rounded-md px-2 py-1 transition-colors', i18n.language === 'bg' ? 'bg-gold-500 text-chesscom-900' : 'text-chesscom-300 hover:text-white')}
              >BG</button>
            </div>

            {/* User chip */}
            <NavLink to="/settings" className="hidden items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-chesscom-800 sm:flex">
              <span className="text-lg leading-none">{user?.profile.avatar_emoji ?? '♟'}</span>
              <div className="text-right text-xs leading-tight">
                <div className="font-medium">{user?.profile.display_name}</div>
                <div className="text-[10px] text-chesscom-400">@{user?.username}</div>
              </div>
            </NavLink>

            <NavLink
              to="/settings"
              className="hidden rounded-md p-2 text-chesscom-300 hover:bg-chesscom-800 hover:text-white sm:inline-flex"
              title={t('common.settings')}
            >
              <SettingsIcon className="h-4 w-4" />
            </NavLink>

            <button
              onClick={logout}
              className="hidden rounded-md p-2 text-chesscom-300 hover:bg-chesscom-800 hover:text-white sm:inline-flex"
              title={t('common.logout')}
            >
              <LogOut className="h-4 w-4" />
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
          <aside className="fixed inset-y-0 right-0 z-50 flex w-72 flex-col bg-chesscom-900 p-4 text-white md:hidden">
            <div className="mb-4 flex items-center justify-between">
              <LogoLockup size={24} />
              <button onClick={() => setNavOpen(false)} className="rounded-lg p-1.5 text-chesscom-300 hover:bg-chesscom-800">
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="space-y-1">
              <MobileNavItem to="/" icon={Home} label={t('app.home')} />
              <MobileNavItem to="/play" icon={Swords} label={t('home.playTitle')} />
              <MobileNavItem to="/review" icon={BookOpen} label={t('home.reviewTitle')} />
              <MobileNavItem to="/insights" icon={BarChart3} label={t('insights.title', { defaultValue: 'Insights' })} />
              <MobileNavItem to="/train" icon={Target} label={t('train.nav', { defaultValue: 'Train' })} />
              <MobileNavItem to="/openings" icon={BookMarked} label={t('openings.nav', { defaultValue: 'Openings' })} />
              <MobileNavItem to="/plan" icon={ListChecks} label={t('plan.nav', { defaultValue: 'Plan' })} />
              <MobileNavItem to="/lab" icon={Microscope} label={t('lab.nav', { defaultValue: 'Lab' })} />
              <MobileNavItem to="/settings" icon={SettingsIcon} label={t('common.settings')} />
              {user?.role === 'admin' && (
                <>
                  <div className="px-3 pt-4 pb-1 text-[10px] uppercase tracking-wide text-chesscom-400">{t('common.admin')}</div>
                  <MobileNavItem to="/admin/users" icon={Users} label={t('admin.users')} />
                  <MobileNavItem to="/admin/system" icon={Server} label={t('admin.system')} />
                </>
              )}
            </nav>
            <div className="mt-auto space-y-2 pt-6">
              <div className="flex gap-1">
                <button onClick={() => i18n.changeLanguage('en')} className={cn('flex-1 rounded-lg px-2 py-1 text-xs', i18n.language === 'en' ? 'bg-gold-500 text-chesscom-900' : 'bg-chesscom-800 text-chesscom-200')}>EN</button>
                <button onClick={() => i18n.changeLanguage('bg')} className={cn('flex-1 rounded-lg px-2 py-1 text-xs', i18n.language === 'bg' ? 'bg-gold-500 text-chesscom-900' : 'bg-chesscom-800 text-chesscom-200')}>BG</button>
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

      {/* Footer with version chip */}
      <footer className="border-t border-chesscom-200 bg-white px-3 py-2 text-center text-[11px] text-chesscom-400 dark:border-chesscom-800 dark:bg-chesscom-900">
        {version && (
          <button
            onClick={() => setShowChangelog(true)}
            className="hover:text-chesscom-700 dark:hover:text-chesscom-200"
            title="View changelog"
          >
            Patzer v{version}
          </button>
        )}
      </footer>

      {showChangelog && <ChangelogModal onClose={() => setShowChangelog(false)} />}
    </div>
  );
}
