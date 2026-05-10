import { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from './state/auth';
import { useLobby } from './state/lobby';
import { setSoundEnabled, unlockAudio } from './lib/sounds';
import Layout from './components/Layout';
import Setup from './pages/Setup';
import Login from './pages/Login';
import Home from './pages/Home';
import SettingsPage from './pages/Settings';
import Play from './pages/Play';
import Review from './pages/Review';
import GameAnalyzer from './pages/GameAnalyzer';
import AdminUsers from './pages/admin/Users';
import AdminSystem from './pages/admin/System';
import IncomingChallengeModal from './components/IncomingChallengeModal';

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
      <div className="flex h-screen items-center justify-center text-ink-500">
        <div className="animate-pulse">♞</div>
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
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/play" element={<Play />} />
          <Route path="/review" element={<Review />} />
          <Route path="/review/:id" element={<GameAnalyzer />} />
          <Route path="/settings" element={<SettingsPage />} />
          {user.role === 'admin' && <Route path="/admin/users" element={<AdminUsers />} />}
          {user.role === 'admin' && <Route path="/admin/system" element={<AdminSystem />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <IncomingChallengeModal />
    </>
  );
}
