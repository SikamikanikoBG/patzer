import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { UserPlus, MailCheck, CheckCircle2, AlertCircle } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../state/auth';
import { useAuthConfig } from '../lib/useAuthConfig';
import { humanizeError } from '../lib/errors';
import AuthShell from '../components/AuthShell';
import { isLanguage, normalizeLanguage } from '../lib/languages';

type InviteProblem = 'invalid' | 'revoked' | 'expired' | 'used_up';
type InviteCheck = { state: 'checking' } | { state: 'valid' } | { state: 'invalid'; reason: InviteProblem };

const INVITE_PROBLEM_KEYS: Record<InviteProblem, string> = {
  invalid: 'auth.errInviteInvalid',
  revoked: 'auth.errInviteRevoked',
  expired: 'auth.errInviteExpired',
  used_up: 'auth.errInviteUsedUp',
};

// Same rule as normalizeInviteCode() on the server: case, dashes and spaces
// don't matter.
const normalizeCode = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
const CODE_LENGTH = 12;

export default function Signup() {
  const { t, i18n } = useTranslation();
  const { refresh } = useAuth();
  const { config, loaded } = useAuthConfig();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const linkCode = params.get('invite') ?? '';

  const [form, setForm] = useState({ username: '', password: '', display_name: '', email: '' });
  const [invite, setInvite] = useState(linkCode);
  const [check, setCheck] = useState<InviteCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false); // verification-required state

  const inviteOnly = config.signup_mode === 'invite';
  // With open signup the field only appears for someone who came via a link.
  const showInvite = inviteOnly || !!linkCode;
  const code = normalizeCode(invite);

  // Check the code as soon as it is complete — straight away when it came in
  // the link — so a dead invite is reported before anyone fills in the form.
  useEffect(() => {
    if (code.length !== CODE_LENGTH) { setCheck(null); return; }
    let alive = true;
    setCheck({ state: 'checking' });
    api.get<{ valid: boolean; reason?: InviteProblem; language?: string | null }>(`/api/auth/invite?code=${code}`)
      .then((r) => {
        if (!alive) return;
        if (!r.valid) { setCheck({ state: 'invalid', reason: r.reason ?? 'invalid' }); return; }
        setCheck({ state: 'valid' });
        // The account will be created in the invite's language; show the
        // page in it too, so a Spanish class link reads Spanish from here on.
        if (isLanguage(r.language) && normalizeLanguage(i18n.language) !== r.language) void i18n.changeLanguage(r.language);
      })
      // The server checks again on submit; a failed probe just shows nothing.
      .catch(() => { if (alive) setCheck(null); });
    return () => { alive = false; };
  }, [code, i18n]);

  const inviteOk = !inviteOnly || (code.length === CODE_LENGTH && check?.state !== 'invalid');

  const emailLooksValid = !form.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
  const canSubmit =
    form.username.trim().length >= 2 &&
    form.password.length >= 10 &&
    form.display_name.trim().length >= 1 &&
    emailLooksValid &&
    inviteOk &&
    !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true); setError('');
    try {
      const res = await api.post<{ user?: unknown; verification_required?: boolean }>('/api/auth/register', {
        ...form,
        language: normalizeLanguage(i18n.language),
        // With open signup a dead invite is dropped rather than blocking a
        // signup that needs no invite at all.
        ...(inviteOnly || check?.state === 'valid' ? { invite: code } : {}),
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
    <AuthShell title={t('auth.signupTitle')} subtitle={inviteOnly ? t('auth.signupSubtitleInvite') : t('auth.signupSubtitle')}>
      <form onSubmit={submit} className="space-y-3">
        {showInvite && (
          <div>
            <label className="label mb-1 block" htmlFor="invite-code">{t('auth.inviteCode')}</label>
            <input
              id="invite-code" className="input font-mono uppercase tracking-wider" autoComplete="off" spellCheck={false}
              placeholder="ABCD-EFGH-JKLM" autoFocus={!linkCode} value={invite} onChange={(e) => setInvite(e.target.value)}
            />
            {check?.state === 'checking' && <p className="mt-1 text-xs text-ink-400">{t('auth.inviteChecking')}</p>}
            {check?.state === 'valid' && (
              <p className="mt-1 flex items-center gap-1 text-xs text-accent-600">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> {t('auth.inviteValid')}
              </p>
            )}
            {check?.state === 'invalid' && (
              <p role="alert" className="mt-1 flex items-start gap-1 text-xs text-bad">
                <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
                <span>{inviteOnly ? t(INVITE_PROBLEM_KEYS[check.reason]) : t('auth.inviteOpenFallback')}</span>
              </p>
            )}
          </div>
        )}
        <div>
          <label className="label mb-1 block">{t('common.username')}</label>
          <input className="input" autoComplete="username" autoFocus={!showInvite || !!linkCode} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
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
