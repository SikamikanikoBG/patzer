import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Copy, Check, Ban, Trash2, X, AlertCircle } from 'lucide-react';
import { api } from '../../api';
import { humanizeError } from '../../lib/errors';
import { copyText } from '../../lib/clipboard';
import { LANGUAGES, type Language } from '../../lib/languages';

type Audience = 'kid' | 'beginner' | 'intermediate' | 'advanced';
type InviteStatus = 'active' | 'revoked' | 'expired' | 'used_up';

interface Invite {
  id: number; code: string; link: string; note: string | null;
  max_uses: number | null; uses: number; expires_at: string | null;
  language: Language | null; audience: Audience | null;
  created_at: string; revoked_at: string | null;
  status: InviteStatus; used_by: string[];
}

const QUERY_KEY = ['admin', 'invites'];
const AUDIENCES: readonly Audience[] = ['kid', 'beginner', 'intermediate', 'advanced'];
const MAX_USES_CHOICES = ['1', '5', '10', '25', '100', 'unlimited'] as const;
const EXPIRY_CHOICES = ['1', '7', '30', '90', 'never'] as const;

const STATUS_BADGE: Record<InviteStatus, string> = {
  active: 'bg-accent-100 text-accent-700',
  used_up: 'bg-ink-100 text-ink-600 dark:bg-ink-700 dark:text-ink-200',
  expired: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  revoked: 'bg-bad/10 text-bad',
};

// Invite-only signup (#26): the invite list and the "new invite" dialog on
// Admin → Users.
export default function InvitesSection() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const { data } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api.get<{ invites: Invite[]; signup_mode: 'open' | 'invite' | 'closed' }>('/api/admin/invites'),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: QUERY_KEY });

  const revoke = useMutation({
    mutationFn: (id: number) => api.post(`/api/admin/invites/${id}/revoke`),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/api/admin/invites/${id}`),
    // The users list names the invite each account came from.
    onSuccess: () => { void refresh(); void qc.invalidateQueries({ queryKey: ['admin', 'users'] }); },
  });

  const date = (iso: string) => new Date(iso).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' });
  const invites = data?.invites ?? [];

  return (
    <section className="mt-10">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">{t('admin.invites')}</h2>
          <p className="text-sm text-ink-500">{t('admin.invitesIntro')}</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary text-sm">
          <Plus className="h-4 w-4" /> {t('admin.newInvite')}
        </button>
      </div>

      {data?.signup_mode === 'closed' && (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-300/50 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {t('admin.invitesClosedWarning')}{' '}
            <Link to="/admin/system" className="font-medium underline">{t('admin.system')}</Link>
          </span>
        </div>
      )}
      {data?.signup_mode === 'open' && <p className="mb-3 text-xs text-ink-400">{t('admin.invitesOpenHint')}</p>}

      <div className="card divide-y divide-ink-100 dark:divide-ink-800">
        {invites.length === 0 && <p className="px-4 py-6 text-center text-sm text-ink-400">{t('admin.noInvites')}</p>}
        {invites.map((inv) => (
          <div key={inv.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
            <div className={`min-w-0 flex-1 ${inv.status === 'active' ? '' : 'opacity-70'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold tracking-wider">{inv.code}</span>
                <span className={`badge ${STATUS_BADGE[inv.status]}`}>{t(`admin.inviteStatus.${inv.status}`)}</span>
              </div>
              {inv.note && <div className="mt-0.5 text-sm">{inv.note}</div>}
              <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-ink-500">
                <span>
                  {inv.max_uses === null
                    ? t('admin.inviteUsesUnlimited', { uses: inv.uses })
                    : t('admin.inviteUses', { uses: inv.uses, max: inv.max_uses })}
                </span>
                <span>
                  {!inv.expires_at
                    ? t('admin.inviteNoExpiry')
                    : t(inv.status === 'expired' ? 'admin.inviteExpiredOn' : 'admin.inviteExpiresOn', { date: date(inv.expires_at) })}
                </span>
                {inv.language && <span>{LANGUAGES.find((l) => l.code === inv.language)?.native ?? inv.language}</span>}
                {inv.audience && <span>{t(`settings.audienceLevel.${inv.audience}`)}</span>}
              </div>
              {inv.used_by.length > 0 && (
                <div className="mt-0.5 text-xs text-ink-400">
                  {t('admin.inviteUsedBy', { names: inv.used_by.map((n) => `@${n}`).join(', ') })}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1">
              {inv.status === 'active' ? (
                <>
                  <CopyButton text={inv.link} label={t('admin.copyLink')} />
                  <button
                    onClick={() => { if (confirm(t('admin.revokeInviteConfirm'))) revoke.mutate(inv.id); }}
                    className="btn-ghost p-1.5 text-bad" title={t('admin.revokeInvite')} aria-label={t('admin.revokeInvite')}>
                    <Ban className="h-4 w-4" />
                  </button>
                </>
              ) : (
                <button onClick={() => remove.mutate(inv.id)} className="btn-ghost p-1.5 text-ink-500"
                  title={t('admin.deleteInvite')} aria-label={t('admin.deleteInvite')}>
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {showCreate && <CreateInviteModal onClose={() => setShowCreate(false)} onCreated={refresh} />}
    </section>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  async function copy() {
    if (!(await copyText(text))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button type="button" onClick={() => void copy()} className="btn-secondary whitespace-nowrap text-xs">
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? t('common.copied') : label}
    </button>
  );
}

function CreateInviteModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    note: '',
    max_uses: '1' as (typeof MAX_USES_CHOICES)[number],
    expires_in_days: '7' as (typeof EXPIRY_CHOICES)[number],
    language: '' as Language | '',
    audience: '' as Audience | '',
  });
  const [created, setCreated] = useState<Invite | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    setBusy(true); setErr('');
    try {
      const r = await api.post<{ invite: Invite }>('/api/admin/invites', {
        note: form.note,
        max_uses: form.max_uses === 'unlimited' ? null : Number(form.max_uses),
        expires_in_days: form.expires_in_days === 'never' ? null : Number(form.expires_in_days),
        language: form.language || null,
        audience: form.audience || null,
      });
      setCreated(r.invite);
      onCreated();
    } catch (e) { setErr(humanizeError(e, t)); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="card max-h-full w-full max-w-md overflow-y-auto p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{created ? t('admin.inviteCreatedTitle') : t('admin.newInvite')}</h2>
          <button onClick={onClose} className="btn-ghost p-1.5" aria-label={t('common.close')}><X className="h-4 w-4" /></button>
        </div>

        {created ? (
          <div className="grid gap-4">
            <p className="text-sm text-ink-500">{t('admin.inviteCreatedBody')}</p>
            <div>
              <label className="label mb-1 block" htmlFor="invite-link">{t('admin.inviteLink')}</label>
              <div className="flex gap-2">
                <input id="invite-link" className="input font-mono text-xs" readOnly value={created.link} onFocus={(e) => e.target.select()} />
                <CopyButton text={created.link} label={t('common.copy')} />
              </div>
            </div>
            <div>
              <label className="label mb-1 block">{t('auth.inviteCode')}</label>
              <div className="flex items-center gap-2">
                <span className="flex-1 font-mono text-lg font-semibold tracking-wider">{created.code}</span>
                <CopyButton text={created.code} label={t('common.copy')} />
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <button onClick={onClose} className="btn-primary">{t('common.close')}</button>
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            <div>
              <label className="label mb-1 block" htmlFor="invite-note">{t('admin.inviteNote')}</label>
              <input id="invite-note" className="input" maxLength={80} placeholder={t('admin.inviteNotePlaceholder')} value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="label mb-1 block" htmlFor="invite-max-uses">{t('admin.inviteMaxUses')}</label>
                <select id="invite-max-uses" className="input" value={form.max_uses} onChange={(e) => setForm({ ...form, max_uses: e.target.value as never })}>
                  {MAX_USES_CHOICES.map((v) => (
                    <option key={v} value={v}>{v === 'unlimited' ? t('admin.inviteUnlimited') : t('admin.inviteAccounts', { count: Number(v) })}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label mb-1 block" htmlFor="invite-expires">{t('admin.inviteExpires')}</label>
                <select id="invite-expires" className="input" value={form.expires_in_days} onChange={(e) => setForm({ ...form, expires_in_days: e.target.value as never })}>
                  {EXPIRY_CHOICES.map((v) => (
                    <option key={v} value={v}>{v === 'never' ? t('admin.inviteNever') : t('admin.inviteDays', { count: Number(v) })}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label mb-1 block" htmlFor="invite-language">{t('common.language')}</label>
                <select id="invite-language" className="input" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value as Language | '' })}>
                  <option value="">{t('admin.invitePresetNone')}</option>
                  {LANGUAGES.map((l) => <option key={l.code} value={l.code} lang={l.code}>{l.native}</option>)}
                </select>
              </div>
              <div>
                <label className="label mb-1 block" htmlFor="invite-audience">{t('admin.audience')}</label>
                <select id="invite-audience" className="input" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value as Audience | '' })}>
                  <option value="">{t('admin.invitePresetNone')}</option>
                  {AUDIENCES.map((a) => <option key={a} value={a}>{t(`settings.audienceLevel.${a}`)}</option>)}
                </select>
              </div>
            </div>
            <p className="text-xs text-ink-400">{t('admin.invitePresetHint')}</p>
            {err && <div className="text-sm text-bad">{err}</div>}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={onClose} className="btn-ghost">{t('common.cancel')}</button>
              <button onClick={() => void submit()} disabled={busy} className="btn-primary">{t('admin.createInvite')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
