import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { KeyRound, CheckCircle2 } from 'lucide-react';
import { api } from '../api';
import { humanizeError } from '../lib/errors';
import AuthShell from '../components/AuthShell';

export default function ResetPassword() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const lengthOk = password.length >= 10;
  const matchOk = password === confirm;
  const canSubmit = !!token && lengthOk && matchOk && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true); setError('');
    try {
      await api.post('/api/auth/reset', { token, password });
      setDone(true);
    } catch (err) {
      setError(humanizeError(err, t));
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <AuthShell title={t('auth.resetTitle')}>
        <p className="text-sm text-bad">{t('auth.errInvalidOrExpired')}</p>
        <Link to="/forgot-password" className="btn-secondary w-full justify-center">{t('auth.requestNewLink')}</Link>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell title={t('auth.resetDoneTitle')}>
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <CheckCircle2 className="h-10 w-10 text-accent-600" />
          <p className="text-sm text-ink-600 dark:text-ink-300">{t('auth.resetDoneBody')}</p>
        </div>
        <Link to="/login" className="btn-primary w-full justify-center">{t('login.submit')}</Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t('auth.resetTitle')} subtitle={t('auth.resetSubtitle')}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label mb-1 block">{t('auth.newPassword')}</label>
          <input className="input" type="password" autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className={`mt-1 text-xs ${password.length > 0 && !lengthOk ? 'text-bad' : 'text-ink-400'}`}>{t('auth.passwordHint')}</p>
        </div>
        <div>
          <label className="label mb-1 block">{t('auth.confirmPassword')}</label>
          <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          {confirm.length > 0 && !matchOk && <p className="mt-1 text-xs text-bad">{t('auth.passwordsNoMatch')}</p>}
        </div>
        {error && <div role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</div>}
        <button type="submit" disabled={!canSubmit} className="btn-primary w-full">
          <KeyRound className="h-4 w-4" />
          {busy ? t('auth.saving') : t('auth.setNewPassword')}
        </button>
      </form>
    </AuthShell>
  );
}
