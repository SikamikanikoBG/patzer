import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, Link } from 'react-router-dom';
import { UserPlus, MailCheck } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../state/auth';
import { useAuthConfig } from '../lib/useAuthConfig';
import { humanizeError } from '../lib/errors';
import AuthShell from '../components/AuthShell';

export default function Signup() {
  const { t, i18n } = useTranslation();
  const { refresh } = useAuth();
  const { config, loaded } = useAuthConfig();
  const nav = useNavigate();

  const [form, setForm] = useState({ username: '', password: '', display_name: '', email: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false); // verification-required state

  const emailLooksValid = !form.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
  const canSubmit =
    form.username.trim().length >= 2 &&
    form.password.length >= 10 &&
    form.display_name.trim().length >= 1 &&
    emailLooksValid &&
    !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true); setError('');
    try {
      const res = await api.post<{ user?: unknown; verification_required?: boolean }>('/api/auth/register', {
        ...form,
        language: i18n.language === 'bg' ? 'bg' : 'en',
      });
      if (res.verification_required) {
        setDone(true);
        return;
      }
      // Logged straight in — hydrate auth state and go home.
      await refresh();
      nav('/');
    } catch (err) {
      setError(humanizeError(err, t));
    } finally {
      setBusy(false);
    }
  }

  // Signup turned off server-side: don't show a form that will only 403.
  if (loaded && !config.signup_enabled) {
    return (
      <AuthShell title={t('auth.signupTitle')}>
        <p className="text-sm text-ink-500">{t('auth.signupDisabledNotice')}</p>
        <Link to="/login" className="btn-secondary w-full justify-center">{t('auth.backToLogin')}</Link>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell title={t('auth.checkInboxTitle')}>
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <MailCheck className="h-10 w-10 text-accent-600" />
          <p className="text-sm text-ink-600 dark:text-ink-300">{t('auth.checkInboxBody', { email: form.email })}</p>
        </div>
        <Link to="/login" className="btn-secondary w-full justify-center">{t('auth.backToLogin')}</Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t('auth.signupTitle')} subtitle={t('auth.signupSubtitle')}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label mb-1 block">{t('common.username')}</label>
          <input className="input" autoComplete="username" autoFocus value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
        </div>
        <div>
          <label className="label mb-1 block">{t('common.displayName')}</label>
          <input className="input" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
        </div>
        <div>
          <label className="label mb-1 block">
            {t('common.email')} <span className="text-ink-400">{config.email_enabled ? t('auth.emailRecommended') : t('common.optional')}</span>
          </label>
          <input className="input" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          {config.email_enabled && <p className="mt-1 text-xs text-ink-400">{t('auth.emailWhy')}</p>}
        </div>
        <div>
          <label className="label mb-1 block">{t('common.password')}</label>
          <input className="input" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <p className={`mt-1 text-xs ${form.password.length > 0 && form.password.length < 10 ? 'text-bad' : 'text-ink-400'}`}>{t('auth.passwordHint')}</p>
        </div>
        {error && <div role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</div>}
        <button type="submit" disabled={!canSubmit} className="btn-primary w-full">
          <UserPlus className="h-4 w-4" />
          {busy ? t('auth.creating') : t('auth.createAccount')}
        </button>
        <div className="pt-1 text-center text-sm text-ink-500">
          {t('auth.haveAccount')} <Link to="/login" className="font-medium text-accent-600 hover:underline">{t('login.submit')}</Link>
        </div>
      </form>
    </AuthShell>
  );
}
