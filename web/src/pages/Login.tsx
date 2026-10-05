import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { KeyRound, LogIn } from 'lucide-react';
import { motion } from 'framer-motion';
import { api } from '../api';
import { useAuth } from '../state/auth';
import { useAuthConfig } from '../lib/useAuthConfig';
import { humanizeError } from '../lib/errors';
import { LogoMark } from '../components/Logo';
import { LANGUAGES, normalizeLanguage } from '../lib/languages';

// /login?sso_error=<code> after a failed single sign-on (see server/src/auth/oidc.ts).
const SSO_ERROR_KEYS: Record<string, string> = {
  unavailable: 'sso.errUnavailable',
  expired: 'sso.errExpired',
  denied: 'sso.errDenied',
  not_provisioned: 'sso.errNotProvisioned',
  conflict: 'sso.errConflict',
  admin_first: 'sso.errAdminFirst',
  rate_limited: 'auth.errRateLimited',
};

export default function Login() {
  const { t, i18n } = useTranslation();
  const { refresh } = useAuth();
  const { config, loaded } = useAuthConfig();
  const [params] = useSearchParams();
  const ssoError = params.get('sso_error');
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

        {/* Wait for /api/auth/config, so SSO-only servers never flash the password form. */}
        {loaded && (
          <form onSubmit={submit} className="card space-y-4 p-6 shadow-lift">
            <h2 className="text-lg font-semibold">{t('login.title')}</h2>
            {ssoError && (
              <div role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">
                {t(SSO_ERROR_KEYS[ssoError] ?? 'sso.errFailed')}
              </div>
            )}

            {config.oidc_enabled && (
              // A plain link, not fetch: the server answers with a redirect to the provider.
              <a href="/api/auth/oidc/start" className={`${config.oidc_only ? 'btn-primary' : 'btn-secondary'} w-full`}>
                <KeyRound className="h-4 w-4" />
                {config.oidc_button_text || t('sso.signIn')}
              </a>
            )}
            {config.oidc_enabled && !config.oidc_only && (
              <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-ink-400">
                <span className="h-px flex-1 bg-ink-200 dark:bg-ink-700" />
                {t('sso.or')}
                <span className="h-px flex-1 bg-ink-200 dark:bg-ink-700" />
              </div>
            )}

            {!config.oidc_only && (
              <>
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
                      ? <Link to="/signup" className="font-medium text-accent-600 hover:underline">
                          {config.signup_mode === 'invite' ? t('auth.haveInvite') : t('auth.createAccount')}
                        </Link>
                      : <span />}
                    {config.email_enabled && (
                      <Link to="/forgot-password" className="text-ink-500 hover:underline">{t('auth.forgotPassword')}</Link>
                    )}
                  </div>
                )}
              </>
            )}
          </form>
        )}

        <div className="mt-6 flex justify-center gap-3 text-xs text-ink-400">
          {LANGUAGES.map((l, i) => (
            <Fragment key={l.code}>
              {i > 0 && <span>·</span>}
              <button type="button" onClick={() => i18n.changeLanguage(l.code)} className={`px-2 py-1 ${normalizeLanguage(i18n.language) === l.code ? 'text-ink-700 underline dark:text-ink-200' : 'hover:text-ink-700'}`}>{l.short}</button>
            </Fragment>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
