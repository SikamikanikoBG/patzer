import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil, X } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../state/auth';
import { humanizeError } from '../../lib/errors';

interface UserRow {
  id: number; username: string; role: 'admin' | 'user'; created_at: string;
  display_name: string; avatar_emoji: string; language: 'en' | 'bg'; audience: string;
  email: string | null; email_verified: number;
}

export default function AdminUsers() {
  const { t } = useTranslation();
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const { data } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => api.get<{ users: UserRow[] }>('/api/admin/users'),
  });

  const del = useMutation({
    mutationFn: (id: number) => api.del(`/api/admin/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t('admin.users')}</h1>
        <button onClick={() => setShowCreate(true)} className="btn-primary text-sm">
          <Plus className="h-4 w-4" /> {t('admin.newUser')}
        </button>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-xs uppercase tracking-wide text-ink-500 dark:bg-ink-900">
            <tr>
              <th className="px-4 py-2 text-left">User</th>
              <th className="px-4 py-2 text-left">{t('admin.role')}</th>
              <th className="px-4 py-2 text-left">{t('common.language')}</th>
              <th className="px-4 py-2 text-left">{t('admin.audience')}</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {(data?.users ?? []).map((u) => (
              <tr key={u.id} className="border-t border-ink-100 dark:border-ink-800">
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{u.avatar_emoji}</span>
                    <div>
                      <div className="font-medium">{u.display_name}</div>
                      <div className="text-xs text-ink-500">@{u.username}</div>
                      {u.email && (
                        <div className="text-xs text-ink-400">
                          {u.email}
                          {!u.email_verified && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">{t('admin.unverified')}</span>}
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-2">
                  <span className={`badge ${u.role === 'admin' ? 'bg-accent-100 text-accent-700' : 'bg-ink-100 text-ink-600 dark:bg-ink-700 dark:text-ink-200'}`}>
                    {t(u.role === 'admin' ? 'admin.roleAdmin' : 'admin.roleUser')}
                  </span>
                </td>
                <td className="px-4 py-2 uppercase text-xs">{u.language}</td>
                <td className="px-4 py-2 capitalize">{u.audience}</td>
                <td className="px-4 py-2 text-right">
                  {me?.id !== u.id && (
                    <button
                      onClick={() => { if (confirm(t('admin.deleteConfirm', { name: u.display_name }))) del.mutate(u.id); }}
                      className="btn-ghost p-1.5 text-bad"><Trash2 className="h-4 w-4" /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} onCreated={() => qc.invalidateQueries({ queryKey: ['admin', 'users'] })} />}
    </div>
  );
}

function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    username: '', password: '', display_name: '', email: '',
    role: 'user' as 'user' | 'admin',
    language: 'en' as 'en' | 'bg',
    audience: 'beginner' as 'kid' | 'beginner' | 'intermediate' | 'advanced',
    coach_behavior: 'on_demand' as 'silent' | 'on_demand' | 'always_on_pedagogical',
    avatar_emoji: '♟', tts_enabled: false,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Mirror the server schema (admin.ts createUserSchema) so the form can't
  // submit a payload that will only bounce as `invalid_input`. The previous
  // gate allowed 6-char passwords while the server demanded 10 — that exact
  // mismatch was the "invalid_input but which idk" bug.
  const usernameOk = form.username.trim().length >= 2;
  const passwordOk = form.password.length >= 10;
  const displayOk = form.display_name.trim().length >= 1;
  const canSubmit = usernameOk && passwordOk && displayOk && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true); setErr('');
    try {
      await api.post('/api/admin/users', form);
      onCreated(); onClose();
    } catch (e) { setErr(humanizeError(e, t)); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="card w-full max-w-md p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t('admin.newUser')}</h2>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="h-4 w-4" /></button>
        </div>
        <div className="grid gap-3">
          <input className="input" placeholder={t('common.username')} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          <div>
            <input className="input" type="password" placeholder={t('common.password')} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <p className={`mt-1 text-xs ${form.password.length > 0 && !passwordOk ? 'text-bad' : 'text-ink-400'}`}>{t('auth.passwordHint')}</p>
          </div>
          <input className="input" placeholder={t('common.displayName')} value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
          <input className="input" type="email" placeholder={`${t('common.email')} ${t('common.optional')}`} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as never })}>
              <option value="user">{t('admin.roleUser')}</option>
              <option value="admin">{t('admin.roleAdmin')}</option>
            </select>
            <select className="input" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value as never })}>
              <option value="en">{t('common.english')}</option>
              <option value="bg">{t('common.bulgarian')}</option>
            </select>
            <select className="input" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value as never })}>
              <option value="kid">{t('settings.audienceLevel.kid')}</option>
              <option value="beginner">{t('settings.audienceLevel.beginner')}</option>
              <option value="intermediate">{t('settings.audienceLevel.intermediate')}</option>
              <option value="advanced">{t('settings.audienceLevel.advanced')}</option>
            </select>
            <select className="input" value={form.coach_behavior} onChange={(e) => setForm({ ...form, coach_behavior: e.target.value as never })}>
              <option value="silent">{t('coach.behavior.silent')}</option>
              <option value="on_demand">{t('coach.behavior.on_demand')}</option>
              <option value="always_on_pedagogical">{t('coach.behavior.always_on_pedagogical')}</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.tts_enabled} onChange={(e) => setForm({ ...form, tts_enabled: e.target.checked })} />
            {t('settings.ttsEnable')}
          </label>
          {err && <div className="text-sm text-bad">{err}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="btn-ghost">{t('common.cancel')}</button>
            <button onClick={submit} disabled={!canSubmit} className="btn-primary">
              {t('admin.createUser')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
