import { useEffect, useRef, useState } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from './state/auth';
import { useLobby } from './state/lobby';
import { setSoundEnabled, unlockAudio } from './lib/sounds';
import Layout from './components/Layout';
import Setup from './pages/Setup';
import Login from './pages/Login';
import Signup from './pages/Signup';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import VerifyEmail from './pages/VerifyEmail';
import Home from './pages/Home';
import SettingsPage from './pages/Settings';
import Play from './pages/Play';
import Review from './pages/Review';
import GameAnalyzer from './pages/GameAnalyzer';
import Insights from './pages/Insights';
import Train from './pages/Train';
import Openings from './pages/Openings';
import Plan from './pages/Plan';
import Lab from './pages/Lab';
import Players from './pages/Players';
import PlayerProfile from './pages/PlayerProfile';
import AdminUsers from './pages/admin/Users';
import AdminSystem from './pages/admin/System';
import IncomingChallengeModal from './components/IncomingChallengeModal';
import CommandPalette from './components/CommandPalette';
import ShortcutsModal from './components/ShortcutsModal';
import { LogoMark } from './components/Logo';

export default function App() {
  const { loading, setupRequired, user, refresh } = useAuth();
  const { i18n } = useTranslation();
  const location = useLocation();
  const nav = useNavigate();
  const lobby = useLobby();

  useEffect(() => { void refresh(); }, [refresh]);

  // Connect/disconnect lobby WS based on auth + apply sound setting
  useEffect(() => {
    if (user) {
      lobby.connect();
      setSoundEnabled(!!user.profile.sound_enabled);
    } else {
      lobby.disconnect();
    }
    return () => { /* keep connection during navigation; disconnect on logout */ };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.profile.sound_enabled]);

  // Unlock Web Audio on first user interaction (browser policy)
  useEffect(() => {
    const onInteract = () => { unlockAudio(); window.removeEventListener('click', onInteract); window.removeEventListener('keydown', onInteract); };
    window.addEventListener('click', onInteract);
    window.addEventListener('keydown', onInteract);
    return () => { window.removeEventListener('click', onInteract); window.removeEventListener('keydown', onInteract); };
  }, []);

  // When the challenger gets "challenge_accepted" via lobby WS, navigate to game
  useEffect(() => {
    if (!user) return;
    const id = setInterval(() => {
      const nav$ = lobby.consumeAcceptedNav();
      if (nav$) nav(`/play?game=${nav$.game_id}`);
    }, 500);
    return () => clearInterval(id);
  }, [user, lobby, nav]);

  // Sync UI language with profile language whenever the user changes
  useEffect(() => {
    if (user?.profile?.language && user.profile.language !== i18n.language) {
      void i18n.changeLanguage(user.profile.language);
    }
  }, [user, i18n]);

  // Global keyboard shortcuts (only when authenticated). ⌘K / Ctrl+K opens
  // the command palette, ? opens the shortcuts overlay, "g X" jumps pages.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const gPrefixRef = useRef<number>(0);
  useEffect(() => {
    if (!user) return;
    function isTextField(t: EventTarget | null): boolean {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    }
    function onKey(e: KeyboardEvent) {
      // ⌘K / Ctrl+K — palette (always, even in inputs).
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (isTextField(e.target)) return;
      if (e.key === '?') { e.preventDefault(); setShortcutsOpen(true); return; }
      // "g X" prefix navigation
      if (e.key === 'g' || e.key === 'G') {
        gPrefixRef.current = Date.now();
        return;
      }
      const since = Date.now() - gPrefixRef.current;
      if (since < 1200) {
        const map: Record<string, string> = { h: '/', p: '/play', r: '/review', i: '/insights', t: '/train', s: '/settings', o: '/openings', n: '/plan', l: '/lab', u: '/players' };
        const target = map[e.key.toLowerCase()];
        if (target) {
          e.preventDefault();
          gPrefixRef.current = 0;
          nav(target);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [user, nav]);

  // Apply site theme (light / dark / auto) — toggles `dark` class on <html>
  useEffect(() => {
    const theme = user?.profile?.site_theme ?? 'auto';
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const wantDark = theme === 'dark' || (theme === 'auto' && mql.matches);
      document.documentElement.classList.toggle('dark', wantDark);
    };
    apply();
    if (theme === 'auto') {
      mql.addEventListener('change', apply);
      return () => mql.removeEventListener('change', apply);
    }
    return undefined;
  }, [user?.profile?.site_theme]);

  if (loading) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 text-ink-500">
        <div className="animate-pulse-soft">
          <LogoMark size={56} />
        </div>
        <div className="h-1 w-32 overflow-hidden rounded-full bg-ink-200 dark:bg-ink-800">
          <div className="h-full w-1/3 animate-loader-slide bg-amber-500" />
        </div>
      </div>
    );
  }

  if (setupRequired) {
    if (location.pathname !== '/setup') return <Navigate to="/setup" replace />;
    return (
      <Routes>
        <Route path="/setup" element={<Setup />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        {/* Reached from emailed links — must work without an authenticated session. */}
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <>
      <Routes>
        {/* Email links still resolve even if the user happens to be logged in. */}
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route element={<Layout onOpenPalette={() => setPaletteOpen(true)} onOpenShortcuts={() => setShortcutsOpen(true)} />}>
          <Route path="/" element={<Home />} />
          <Route path="/play" element={<Play />} />
          <Route path="/review" element={<Review />} />
          <Route path="/review/:id" element={<GameAnalyzer />} />
          <Route path="/insights" element={<Insights />} />
          <Route path="/train" element={<Train />} />
          <Route path="/openings" element={<Openings />} />
          <Route path="/plan" element={<Plan />} />
          <Route path="/lab" element={<Lab />} />
          <Route path="/players" element={<Players />} />
          <Route path="/players/:id" element={<PlayerProfile />} />
          <Route path="/settings" element={<SettingsPage />} />
          {user.role === 'admin' && <Route path="/admin/users" element={<AdminUsers />} />}
          {user.role === 'admin' && <Route path="/admin/system" element={<AdminSystem />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <IncomingChallengeModal />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </>
  );
}
