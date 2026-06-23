import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, AlertCircle, Loader2, Mail, MailCheck } from 'lucide-react';
import { api } from '../api';
import AuthShell from '../components/AuthShell';

// Two modes in one page:
//  • with ?token=...  → confirm the email immediately (link clicked from inbox)
//  • without a token  → "resend verification" form (reached from the login
//    page when an account is still unverified)
export default function VerifyEmail() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [state, setState] = useState<'verifying' | 'ok' | 'fail'>('verifying');

  useEffect(() => {
    if (!token) return;
    let alive = true;
    api.post('/api/auth/verify', { token })
      .then(() => { if (alive) setState('ok'); })
      .catch(() => { if (alive) setState('fail'); });
    return () => { alive = false; };
  }, [token]);

  if (token) {
    return (
      <AuthShell title={t('auth.verifyTitle')}>
        {state === 'verifying' && (
          <div className="flex flex-col items-center gap-3 py-4 text-ink-500">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm">{t('auth.verifying')}</p>
          </div>
        )}
        {state === 'ok' && (
          <>
            <div className="flex flex-col items-center gap-3 py-2 text-center">
              <CheckCircle2 className="h-10 w-10 text-accent-600" />
              <p className="text-sm text-ink-600 dark:text-ink-300">{t('auth.verifyOk')}</p>
            </div>
            <Link to="/login" className="btn-primary w-full justify-center">{t('login.submit')}</Link>
          </>
        )}
        {state === 'fail' && (
          <>
            <div className="flex flex-col items-center gap-3 py-2 text-center">
              <AlertCircle className="h-10 w-10 text-bad" />
              <p className="text-sm text-ink-600 dark:text-ink-300">{t('auth.verifyFail')}</p>
            </div>
            <Link to="/verify-email" className="btn-secondary w-full justify-center">{t('auth.resendVerification')}</Link>
          </>
        )}
      </AuthShell>
    );
  }

  return <ResendForm />;
}

function ResendForm() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    try {
      // Generic confirmation regardless of result (no account enumeration).
      await api.post('/api/auth/resend-verification', { email: email.trim() });
    } catch { /* still show the generic confirmation */ }
    setSent(true); setBusy(false);
  }

  if (sent) {
    return (
      <AuthShell title={t('auth.resendSentTitle')}>
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <MailCheck className="h-10 w-10 text-accent-600" />
          <p className="text-sm text-ink-600 dark:text-ink-300">{t('auth.resendSentBody')}</p>
        </div>
        <Link to="/login" className="btn-secondary w-full justify-center">{t('auth.backToLogin')}</Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t('auth.resendTitle')} subtitle={t('auth.resendSubtitle')}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label mb-1 block">{t('common.email')}</label>
          <input className="input" type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <button type="submit" disabled={!valid || busy} className="btn-primary w-full">
          <Mail className="h-4 w-4" />
          {busy ? t('auth.sending') : t('auth.resendVerification')}
        </button>
        <div className="pt-1 text-center text-sm">
          <Link to="/login" className="text-ink-500 hover:underline">{t('auth.backToLogin')}</Link>
        </div>
      </form>
    </AuthShell>
  );
}
