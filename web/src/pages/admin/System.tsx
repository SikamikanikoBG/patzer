import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, AlertCircle, Save, Sparkles, Cpu, Loader2, FlaskConical, Mail, UserPlus, Send } from 'lucide-react';
import { api } from '../../api';

interface SysSettings {
  ollama_url: string | null;
  ollama_model: string | null;
  stockfish_path: string | null;
  last_model_used?: string | null;
  last_error?: string | null;
  p95_ms?: number | null;
  call_count?: number;
  // signup + email (v7.7.0)
  allow_signup?: boolean;
  require_email_verification?: boolean;
  notify_admin_on_signup?: boolean;
  public_base_url?: string;
  smtp_host?: string;
  smtp_port?: string | number;
  smtp_secure?: boolean;
  smtp_user?: string;
  smtp_from?: string;
  smtp_pass_set?: boolean;
  smtp_env_override?: boolean;
  email_enabled?: boolean;
}

interface MailState {
  allow_signup: boolean;
  require_email_verification: boolean;
  notify_admin_on_signup: boolean;
  public_base_url: string;
  smtp_host: string;
  smtp_port: string;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_from: string;
}

export default function AdminSystem() {
  const { t } = useTranslation();
  const [s, setS] = useState<SysSettings>({ ollama_url: '', ollama_model: '', stockfish_path: '' });
  const [runtime, setRuntime] = useState<{ last_model_used: string | null; last_error: string | null; p95_ms: number | null; call_count: number } | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [stockfishStatus, setStockfishStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [allTesting, setAllTesting] = useState(false);
  const [allResults, setAllResults] = useState<Array<{ model: string; ok: boolean; latencyMs: number; sample?: string; error?: string }> | null>(null);

  // Signup + email (v7.7.0)
  const [mail, setMail] = useState<MailState>({
    allow_signup: true, require_email_verification: false, notify_admin_on_signup: true,
    public_base_url: '', smtp_host: '', smtp_port: '', smtp_secure: false, smtp_user: '', smtp_from: '',
  });
  const [smtpPass, setSmtpPass] = useState('');
  const [smtpPassSet, setSmtpPassSet] = useState(false);
  const [smtpEnvOverride, setSmtpEnvOverride] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [mailSaved, setMailSaved] = useState(false);
  const [mailBusy, setMailBusy] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testStatus, setTestStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [testing, setTesting] = useState(false);

  function loadSettings() {
    return api.get<SysSettings>('/api/admin/system').then((d) => {
      setS({ ollama_url: d.ollama_url ?? '', ollama_model: d.ollama_model ?? '', stockfish_path: d.stockfish_path ?? '' });
      setRuntime({
        last_model_used: d.last_model_used ?? null,
        last_error: d.last_error ?? null,
        p95_ms: d.p95_ms ?? null,
        call_count: d.call_count ?? 0,
      });
      setMail({
        allow_signup: d.allow_signup ?? true,
        require_email_verification: d.require_email_verification ?? false,
        notify_admin_on_signup: d.notify_admin_on_signup ?? true,
        public_base_url: d.public_base_url ?? '',
        smtp_host: d.smtp_host ?? '',
        smtp_port: d.smtp_port != null ? String(d.smtp_port) : '',
        smtp_secure: d.smtp_secure ?? false,
        smtp_user: d.smtp_user ?? '',
        smtp_from: d.smtp_from ?? '',
      });
      setSmtpPassSet(!!d.smtp_pass_set);
      setSmtpEnvOverride(!!d.smtp_env_override);
      setEmailEnabled(!!d.email_enabled);
      setSmtpPass('');
      setHydrated(true);
    });
  }

  async function saveMail() {
    setMailBusy(true);
    try {
      await api.patch('/api/admin/system', {
        allow_signup: mail.allow_signup,
        require_email_verification: mail.require_email_verification,
        notify_admin_on_signup: mail.notify_admin_on_signup,
        public_base_url: mail.public_base_url,
        smtp_host: mail.smtp_host,
        smtp_user: mail.smtp_user,
        smtp_from: mail.smtp_from,
        smtp_secure: mail.smtp_secure,
        smtp_port: mail.smtp_port === '' ? '' : Number(mail.smtp_port),
        // Only send the password when the admin typed a new one — empty leaves
        // the stored secret untouched.
        ...(smtpPass ? { smtp_pass: smtpPass } : {}),
      });
      setMailSaved(true); setTimeout(() => setMailSaved(false), 1500);
      await loadSettings();
    } finally { setMailBusy(false); }
  }

  async function sendTestEmail() {
    setTesting(true); setTestStatus(null);
    try {
      const r = await api.post<{ ok: boolean; error?: string }>('/api/admin/test/email', { to: testTo });
      setTestStatus({ ok: r.ok, msg: r.ok ? t('admin.testEmailSent') : (r.error ?? 'failed') });
    } catch (e) {
      setTestStatus({ ok: false, msg: (e as Error).message });
    } finally { setTesting(false); }
  }

  useEffect(() => { void loadSettings(); }, []);

  // Auto-load models on first load (and whenever the user pastes a different URL).
  useEffect(() => {
    if (!hydrated) return;
    if (s.ollama_url) void fetchModels(s.ollama_url, /* silent */ true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, s.ollama_url]);

  async function fetchModels(url: string, silent = false) {
    if (!url) return;
    setLoadingModels(true);
    if (!silent) setOllamaStatus(null);
    try {
      const r = await api.post<{ ok: boolean; models?: { name: string }[]; error?: string }>('/api/admin/test/ollama', { url });
      if (r.ok) {
        const ns = (r.models ?? []).map((m) => m.name).sort();
        setModels(ns);
        setOllamaStatus({ ok: true, msg: `${ns.length} model${ns.length === 1 ? '' : 's'} found` });
        if (!s.ollama_model && ns[0]) setS((cur) => ({ ...cur, ollama_model: ns[0]! }));
      } else {
        setModels([]);
        setOllamaStatus({ ok: false, msg: r.error ?? 'connection failed' });
      }
    } catch (e) {
      setModels([]);
      setOllamaStatus({ ok: false, msg: (e as Error).message });
    } finally {
      setLoadingModels(false);
    }
  }

  async function testStockfish() {
    setStockfishStatus(null);
    const r = await api.post<{ ok: boolean; name?: string; error?: string }>('/api/admin/test/stockfish', { path: s.stockfish_path });
    setStockfishStatus({ ok: r.ok, msg: r.ok ? (r.name ?? 'ok') : (r.error ?? 'failed') });
  }

  async function save() {
    await api.patch('/api/admin/system', s);
    setSaved(true); setTimeout(() => setSaved(false), 1500);
  }

  async function testAllModels() {
    if (!s.ollama_url) return;
    setAllTesting(true); setAllResults(null);
    try {
      const r = await api.post<{ ok: boolean; results?: Array<{ model: string; ok: boolean; latencyMs: number; sample?: string; error?: string }>; error?: string }>(
        '/api/admin/test/ollama-models', { url: s.ollama_url }
      );
      if (r.ok && r.results) setAllResults(r.results);
      else setAllResults([{ model: 'all', ok: false, latencyMs: 0, error: r.error ?? 'failed' }]);
    } finally { setAllTesting(false); }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-20">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">{t('admin.system')}</h1>
        <p className="mt-1 text-sm text-ink-500">{t('admin.system_intro')}</p>
      </header>

      <section className="card overflow-hidden">
        <div className="flex items-center gap-3 border-b border-ink-100 bg-ink-50/60 px-5 py-3 dark:border-ink-700 dark:bg-ink-900/40">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-500/15 text-accent-600">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h2 className="font-semibold">{t('admin.ollamaConfig')}</h2>
            <p className="text-xs text-ink-500">Local LLM for the AI Coach. Models are auto-discovered from /api/tags.</p>
          </div>
        </div>
        <div className="space-y-4 p-5">
          <div>
            <label className="label mb-1 block">{t('admin.ollamaUrl')}</label>
            <div className="flex gap-2">
              <input className="input" value={s.ollama_url ?? ''} onChange={(e) => setS({ ...s, ollama_url: e.target.value })} placeholder="http://localhost:11434" />
              <button onClick={() => fetchModels(s.ollama_url ?? '')} className="btn-secondary text-sm" disabled={!s.ollama_url || loadingModels}>
                {loadingModels ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Test'}
              </button>
            </div>
            {ollamaStatus && (
              <div className={`mt-2 flex items-center gap-1 text-sm ${ollamaStatus.ok ? 'text-accent-600' : 'text-bad'}`}>
                {ollamaStatus.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                {ollamaStatus.msg}
              </div>
            )}
          </div>
          <div>
            <label className="label mb-1 block">{t('admin.ollamaModel')}</label>
            <button onClick={testAllModels} disabled={!s.ollama_url || allTesting} className="btn-secondary text-xs">
            {allTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
            Test ALL models
          </button>
          {allResults && (
            <div className="overflow-hidden rounded-xl border border-ink-200 dark:border-ink-700">
              <table className="w-full text-xs">
                <thead className="bg-ink-50 text-[11px] uppercase tracking-wider text-ink-500 dark:bg-ink-900">
                  <tr>
                    <th className="px-3 py-2 text-left">Model</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-right">Latency</th>
                    <th className="px-3 py-2 text-left">Sample / error</th>
                  </tr>
                </thead>
                <tbody>
                  {allResults.map((r) => (
                    <tr key={r.model} className="border-t border-ink-100 dark:border-ink-800">
                      <td className="px-3 py-2 font-mono">{r.model}</td>
                      <td className="px-3 py-2">
                        {r.ok ? <span className="inline-flex items-center gap-1 text-accent-600"><CheckCircle2 className="h-3 w-3" />OK</span>
                          : <span className="inline-flex items-center gap-1 text-bad"><AlertCircle className="h-3 w-3" />FAIL</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-ink-500">{r.latencyMs}ms</td>
                      <td className="px-3 py-2 truncate text-ink-500" title={r.sample ?? r.error ?? ''}>{r.sample ?? r.error ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {loadingModels ? (
              <div className="flex h-10 items-center gap-2 rounded-xl bg-ink-100 px-3 text-sm text-ink-500 dark:bg-ink-800">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading models from Ollama…
              </div>
            ) : models.length > 0 ? (
              <select className="input" value={s.ollama_model ?? ''} onChange={(e) => setS({ ...s, ollama_model: e.target.value })}>
                {models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : (
              <div className="space-y-1">
                <input className="input" value={s.ollama_model ?? ''} onChange={(e) => setS({ ...s, ollama_model: e.target.value })} placeholder="gemma3:27b" />
                <p className="text-xs text-ink-400">No models loaded — set the URL above and click Test, or type a model name manually.</p>
              </div>
            )}
          </div>
          {/* Runtime panel — shows the model the coach actually called last, so
              admins can verify the saved setting is being honored. Updates only
              after at least one coach call has fired since server boot. */}
          {runtime && (
            <div className="rounded-xl border border-ink-200 bg-ink-50/50 p-3 text-xs dark:border-ink-700 dark:bg-ink-900/30">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-semibold uppercase tracking-wide text-ink-500">Runtime</span>
                <button onClick={() => void loadSettings()} className="text-ink-500 hover:text-ink-700 dark:hover:text-ink-200">refresh</button>
              </div>
              <div className="grid grid-cols-[7rem_1fr] gap-y-1">
                <span className="text-ink-500">Last model used</span>
                <span className="font-mono">{runtime.last_model_used ?? <span className="text-ink-400">— no coach call yet —</span>}</span>
                <span className="text-ink-500">Coach calls</span>
                <span className="font-mono">{runtime.call_count} {runtime.p95_ms != null && <span className="text-ink-400">(p95 {runtime.p95_ms}ms)</span>}</span>
                {runtime.last_error && (<>
                  <span className="text-ink-500">Last error</span>
                  <span className="font-mono text-bad">{runtime.last_error}</span>
                </>)}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="flex items-center gap-3 border-b border-ink-100 bg-ink-50/60 px-5 py-3 dark:border-ink-700 dark:bg-ink-900/40">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600">
            <Cpu className="h-4 w-4" />
          </div>
          <div>
            <h2 className="font-semibold">{t('admin.stockfishConfig')}</h2>
            <p className="text-xs text-ink-500">Native chess engine for analysis and bot play.</p>
          </div>
        </div>
        <div className="space-y-4 p-5">
          <div>
            <label className="label mb-1 block">{t('admin.stockfishPath')}</label>
            <div className="flex gap-2">
              <input className="input" value={s.stockfish_path ?? ''} onChange={(e) => setS({ ...s, stockfish_path: e.target.value })} placeholder="(auto-detect)" />
              <button onClick={testStockfish} className="btn-secondary text-sm">Test</button>
            </div>
            <p className="mt-1 text-xs text-ink-400">{t('admin.stockfishPathHelp')}</p>
            {stockfishStatus && (
              <div className={`mt-2 flex items-center gap-1 text-sm ${stockfishStatus.ok ? 'text-accent-600' : 'text-bad'}`}>
                {stockfishStatus.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                {t('admin.engineFound', { name: stockfishStatus.msg })}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ---- Signup ---- */}
      <section className="card overflow-hidden">
        <div className="flex items-center gap-3 border-b border-ink-100 bg-ink-50/60 px-5 py-3 dark:border-ink-700 dark:bg-ink-900/40">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600">
            <UserPlus className="h-4 w-4" />
          </div>
          <div>
            <h2 className="font-semibold">{t('admin.signupConfig')}</h2>
            <p className="text-xs text-ink-500">{t('admin.signupConfigIntro')}</p>
          </div>
        </div>
        <div className="space-y-4 p-5">
          <ToggleRow checked={mail.allow_signup} onChange={(v) => setMail({ ...mail, allow_signup: v })}
            label={t('admin.allowSignup')} hint={t('admin.allowSignupHint')} />
          <ToggleRow checked={mail.require_email_verification} onChange={(v) => setMail({ ...mail, require_email_verification: v })}
            label={t('admin.requireVerification')} hint={emailEnabled ? t('admin.requireVerificationHint') : t('admin.requireVerificationNeedsSmtp')}
            disabled={!emailEnabled} />
          <ToggleRow checked={mail.notify_admin_on_signup} onChange={(v) => setMail({ ...mail, notify_admin_on_signup: v })}
            label={t('admin.notifyAdmins')} hint={t('admin.notifyAdminsHint')} disabled={!emailEnabled} />
          <div>
            <label className="label mb-1 block">{t('admin.publicBaseUrl')}</label>
            <input className="input" value={mail.public_base_url} onChange={(e) => setMail({ ...mail, public_base_url: e.target.value })} placeholder="http://ardi:8800" />
            <p className="mt-1 text-xs text-ink-400">{t('admin.publicBaseUrlHint')}</p>
          </div>
        </div>
      </section>

      {/* ---- SMTP / email ---- */}
      <section className="card overflow-hidden">
        <div className="flex items-center gap-3 border-b border-ink-100 bg-ink-50/60 px-5 py-3 dark:border-ink-700 dark:bg-ink-900/40">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/15 text-sky-600">
            <Mail className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <h2 className="font-semibold">{t('admin.smtpConfig')}</h2>
            <p className="text-xs text-ink-500">{t('admin.smtpConfigIntro')}</p>
          </div>
          <span className={`badge ${emailEnabled ? 'bg-accent-100 text-accent-700' : 'bg-ink-100 text-ink-500 dark:bg-ink-700 dark:text-ink-300'}`}>
            {emailEnabled ? t('admin.smtpOn') : t('admin.smtpOff')}
          </span>
        </div>
        <div className="space-y-4 p-5">
          {smtpEnvOverride && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-300/50 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-300">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {t('admin.smtpEnvOverride')}
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label className="label mb-1 block">{t('admin.smtpHost')}</label>
              <input className="input" value={mail.smtp_host} onChange={(e) => setMail({ ...mail, smtp_host: e.target.value })} placeholder="smtp.gmail.com" />
            </div>
            <div>
              <label className="label mb-1 block">{t('admin.smtpPort')}</label>
              <input className="input" inputMode="numeric" value={mail.smtp_port} onChange={(e) => setMail({ ...mail, smtp_port: e.target.value.replace(/[^0-9]/g, '') })} placeholder="587" />
            </div>
          </div>
          <ToggleRow checked={mail.smtp_secure} onChange={(v) => setMail({ ...mail, smtp_secure: v })}
            label={t('admin.smtpSecure')} hint={t('admin.smtpSecureHint')} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label mb-1 block">{t('admin.smtpUser')}</label>
              <input className="input" autoComplete="off" value={mail.smtp_user} onChange={(e) => setMail({ ...mail, smtp_user: e.target.value })} />
            </div>
            <div>
              <label className="label mb-1 block">{t('admin.smtpPass')}</label>
              <input className="input" type="password" autoComplete="new-password" value={smtpPass}
                onChange={(e) => setSmtpPass(e.target.value)} placeholder={smtpPassSet ? '••••••••' : ''} />
              {smtpPassSet && !smtpPass && <p className="mt-1 text-xs text-ink-400">{t('admin.smtpPassKept')}</p>}
            </div>
          </div>
          <div>
            <label className="label mb-1 block">{t('admin.smtpFrom')}</label>
            <input className="input" value={mail.smtp_from} onChange={(e) => setMail({ ...mail, smtp_from: e.target.value })} placeholder="Patzer <chess@example.com>" />
          </div>

          <div className="flex justify-end">
            <button onClick={saveMail} disabled={mailBusy} className="btn-primary">
              <Save className="h-4 w-4" /> {mailSaved ? t('settings.saved') : t('admin.saveEmailSettings')}
            </button>
          </div>

          {/* Send-test row — uses the SAVED config, so prompt to save first. */}
          <div className="rounded-xl border border-ink-200 bg-ink-50/50 p-3 dark:border-ink-700 dark:bg-ink-900/30">
            <label className="label mb-1 block">{t('admin.sendTestEmail')}</label>
            <div className="flex gap-2">
              <input className="input" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" />
              <button onClick={sendTestEmail} disabled={testing || !testTo} className="btn-secondary text-sm whitespace-nowrap">
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {t('admin.send')}
              </button>
            </div>
            <p className="mt-1 text-xs text-ink-400">{t('admin.sendTestEmailHint')}</p>
            {testStatus && (
              <div className={`mt-2 flex items-center gap-1 text-sm ${testStatus.ok ? 'text-accent-600' : 'text-bad'}`}>
                {testStatus.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />} {testStatus.msg}
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="sticky bottom-4 z-10 flex justify-end">
        <button onClick={save} className="btn-primary shadow-lg shadow-ink-900/10">
          <Save className="h-4 w-4" /> {saved ? t('settings.saved') : t('common.save')}
        </button>
      </div>
    </div>
  );
}

function ToggleRow({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={`flex items-start justify-between gap-3 ${disabled ? 'opacity-50' : ''}`}>
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-ink-400">{hint}</div>}
      </div>
      <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
