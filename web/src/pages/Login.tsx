import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, Link } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { motion } from 'framer-motion';
import { api } from '../api';
import { useAuth } from '../state/auth';
import { useAuthConfig } from '../lib/useAuthConfig';
import { humanizeError } from '../lib/errors';
import { LogoMark } from '../components/Logo';

export default function Login() {
  const { t, i18n } = useTranslation();
  const { refresh } = useAuth();
  const { config } = useAuthConfig();
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [unverified, setUnverified] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(''); setUnverified(false);
    try {
      await api.post('/api/auth/login', { username, password });
      await refresh();
      nav('/');
    } catch (err) {
      const code = (err as { data?: { error?: string } })?.data?.error;
      if (code === 'email_unverified') {
        setUnverified(true);
        setError(t('auth.errEmailUnverified'));
      } else if (code && code !== 'invalid_credentials') {
        setError(humanizeError(err, t));
      } else {
        setError(t('login.invalid'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-cream px-4 py-10 dark:bg-ink-900">
      {/* Decorative background */}
      <div className="pointer-events-none absolute -left-40 -top-40 h-[480px] w-[480px] rounded-full bg-amber-200/30 blur-3xl dark:bg-amber-700/10" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 h-[480px] w-[480px] rounded-full bg-emerald-200/30 blur-3xl dark:bg-emerald-700/10" />

      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-sm"
      >
        <div className="mb-8 flex flex-col items-center text-center">
          <LogoMark size={64} className="mb-3" />
          <h1 className="text-3xl font-bold tracking-tight">{t('app.name')}</h1>
          <p className="mt-1 text-sm text-ink-500">{t('app.tagline')}</p>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6 shadow-lift">
          <h2 className="text-lg font-semibold">{t('login.title')}</h2>
          <div>
            <label className="label mb-1 block" htmlFor="login-username">{t('common.username')}</label>
            <input id="login-username" className="input" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div>
            <label className="label mb-1 block" htmlFor="login-password">{t('common.password')}</label>
            <input id="login-password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && (
            <div role="alert" aria-live="assertive" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">
              {error}
              {unverified && (
                <Link to="/verify-email" className="mt-1 block font-medium underline">{t('auth.resendVerification')}</Link>
              )}
            </div>
          )}
          <button type="submit" disabled={busy || !username || !password} className="btn-primary w-full">
            <LogIn className="h-4 w-4" />
            {busy ? t('login.submitting') : t('login.submit')}
          </button>

          {(config.signup_enabled || config.email_enabled) && (
            <div className="flex items-center justify-between pt-1 text-sm">
              {config.signup_enabled
                ? <Link to="/signup" className="font-medium text-accent-600 hover:underline">{t('auth.createAccount')}</Link>
                : <span />}
              {config.email_enabled && (
                <Link to="/forgot-password" className="text-ink-500 hover:underline">{t('auth.forgotPassword')}</Link>
              )}
            </div>
          )}
        </form>

        <div className="mt-6 flex justify-center gap-3 text-xs text-ink-400">
          <button type="button" onClick={() => i18n.changeLanguage('en')} className={`px-2 py-1 ${i18n.language === 'en' ? 'text-ink-700 underline dark:text-ink-200' : 'hover:text-ink-700'}`}>EN</button>
          <span>·</span>
          <button type="button" onClick={() => i18n.changeLanguage('bg')} className={`px-2 py-1 ${i18n.language === 'bg' ? 'text-ink-700 underline dark:text-ink-200' : 'hover:text-ink-700'}`}>BG</button>
        </div>
      </motion.div>
    </div>
  );
}
