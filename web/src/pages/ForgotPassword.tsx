import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Mail, MailCheck } from 'lucide-react';
import { api } from '../api';
import { humanizeError } from '../lib/errors';
import AuthShell from '../components/AuthShell';

export default function ForgotPassword() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true); setError('');
    try {
      // Server always answers 200 (no account enumeration); we mirror that by
      // showing the same confirmation regardless of whether the email exists.
      await api.post('/api/auth/forgot', { email: email.trim() });
      setSent(true);
    } catch (err) {
      setError(humanizeError(err, t));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <AuthShell title={t('auth.forgotSentTitle')}>
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <MailCheck className="h-10 w-10 text-accent-600" />
          <p className="text-sm text-ink-600 dark:text-ink-300">{t('auth.forgotSentBody')}</p>
        </div>
        <Link to="/login" className="btn-secondary w-full justify-center">{t('auth.backToLogin')}</Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t('auth.forgotTitle')} subtitle={t('auth.forgotSubtitle')}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label mb-1 block">{t('common.email')}</label>
          <input className="input" type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {error && <div role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</div>}
        <button type="submit" disabled={!valid || busy} className="btn-primary w-full">
          <Mail className="h-4 w-4" />
          {busy ? t('auth.sending') : t('auth.sendResetLink')}
        </button>
        <div className="pt-1 text-center text-sm">
          <Link to="/login" className="text-ink-500 hover:underline">{t('auth.backToLogin')}</Link>
        </div>
      </form>
    </AuthShell>
  );
}
