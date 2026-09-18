import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, normalizeLanguage, type Language } from '../lib/languages';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, AlertCircle, ChevronRight, ChevronLeft, Sparkles, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../api';
import { useAuth } from '../state/auth';
import { LogoMark } from '../components/Logo';

export default function Setup() {
  const { t, i18n } = useTranslation();
  const { refresh } = useAuth();
  const nav = useNavigate();

  const [step, setStep] = useState<1 | 2>(1);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [language, setLanguage] = useState<Language>(normalizeLanguage(i18n.language));
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [ollamaModel, setOllamaModel] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [testError, setTestError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function testOllama() {
    setTestStatus('testing'); setTestError(''); setModels([]);
    try {
      const res = await fetch('/api/setup/test-ollama', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'patzer' },
        body: JSON.stringify({ url: ollamaUrl }),
      });
      const data = await res.json();
      if (data.ok) {
        const names = (data.models ?? []).map((m: { name: string }) => m.name);
        setModels(names);
        if (names.length && !ollamaModel) setOllamaModel(names[0]);
        setTestStatus('ok');
      } else {
        setTestStatus('fail'); setTestError(data.error ?? 'unknown');
      }
    } catch (err) {
      setTestStatus('fail'); setTestError((err as Error).message);
    }
  }

  async function submit() {
    setBusy(true); setError('');
    try {
      await api.post('/api/setup/init', {
        username, password, display_name: displayName || username, language,
        ollama_url: ollamaUrl || '', ollama_model: ollamaModel || '',
      });
      await i18n.changeLanguage(language);
      await refresh();
      nav('/');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-cream px-4 py-10 dark:bg-ink-900">
      <div className="pointer-events-none absolute -left-40 -top-40 h-[480px] w-[480px] rounded-full bg-amber-200/30 blur-3xl dark:bg-amber-700/10" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 h-[480px] w-[480px] rounded-full bg-emerald-200/30 blur-3xl dark:bg-emerald-700/10" />

      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-xl"
      >
        <div className="mb-6 flex flex-col items-center text-center">
          <LogoMark size={64} className="mb-3" />
          <h1 className="text-3xl font-bold tracking-tight">{t('setup.title')}</h1>
          <p className="page-sub">{t('setup.subtitle')}</p>
        </div>

        <div className="card overflow-hidden p-6 shadow-lift sm:p-8">
          {/* Stepper */}
          <ol className="mb-6 flex items-center justify-center gap-2">
            <Dot active={step === 1} done={step > 1}>1</Dot>
            <div className="h-px w-12 bg-ink-200 dark:bg-ink-700" />
            <Dot active={step === 2}>2</Dot>
          </ol>

          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div key="s1" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }} className="space-y-4">
                <h2 className="text-lg font-semibold">{t('setup.step1')}</h2>
                <div>
                  <label className="label mb-1 block">{t('common.language')}</label>
                  <div className="flex gap-2">
                    {LANGUAGES.map((l) => (
                      <LangBtn key={l.code} current={language} value={l.code} onClick={() => { setLanguage(l.code); void i18n.changeLanguage(l.code); }}>{t(l.nameKey)}</LangBtn>
                    ))}
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label mb-1 block">{t('common.username')}</label>
                    <input className="input" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
                  </div>
                  <div>
                    <label className="label mb-1 block">{t('common.displayName')}</label>
                    <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={username} />
                  </div>
                </div>
                <div>
                  <label className="label mb-1 block">{t('common.password')}</label>
                  <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                  <p className="mt-1 text-xs text-ink-400">{t('setup.passwordHint')}</p>
                </div>
                <button onClick={() => setStep(2)} disabled={!username || password.length < 10} className="btn-primary w-full">
                  Next <ChevronRight className="h-4 w-4" />
                </button>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div key="s2" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} className="space-y-4">
                <h2 className="text-lg font-semibold">{t('setup.step2')}</h2>
                <p className="text-sm text-ink-500">{t('setup.ollamaSkip')}</p>
                <div>
                  <label className="label mb-1 block">{t('setup.ollamaUrl')}</label>
                  <div className="flex gap-2">
                    <input className="input" value={ollamaUrl} onChange={(e) => setOllamaUrl(e.target.value)} placeholder="http://localhost:11434" />
                    <button onClick={testOllama} className="btn-secondary text-sm" disabled={!ollamaUrl || testStatus === 'testing'}>
                      {testStatus === 'testing' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Test'}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-ink-400">{t('setup.ollamaUrlHelp')}</p>
                </div>
                {testStatus === 'ok' && (
                  <div className="flex items-center gap-1 text-sm text-accent-600">
                    <CheckCircle2 className="h-4 w-4" /> {t('setup.ollamaConnected', { count: models.length })}
                  </div>
                )}
                {testStatus === 'fail' && (
                  <div className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">
                    <AlertCircle className="mr-1 inline h-4 w-4" /> {t('setup.ollamaFailed', { error: testError })}
                  </div>
                )}
                {models.length > 0 && (
                  <div>
                    <label className="label mb-1 block">{t('setup.ollamaModel')}</label>
                    <select className="input" value={ollamaModel} onChange={(e) => setOllamaModel(e.target.value)}>
                      {models.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                )}
                {error && <div className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</div>}
                <div className="flex gap-2">
                  <button onClick={() => setStep(1)} className="btn-ghost flex-1"><ChevronLeft className="h-4 w-4" /> {t('common.back')}</button>
                  <button onClick={submit} disabled={busy} className="btn-primary flex-[2]">
                    <Sparkles className="h-4 w-4" />
                    {busy ? t('setup.creating') : t('setup.finish')}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}

function Dot({ active, done, children }: { active?: boolean; done?: boolean; children: React.ReactNode }) {
  return (
    <span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors
      ${active ? 'bg-ink-900 text-cream dark:bg-cream dark:text-ink-900' :
        done ? 'bg-accent-500 text-white' : 'bg-ink-200 text-ink-500 dark:bg-ink-700 dark:text-ink-300'}`}>
      {done ? <CheckCircle2 className="h-4 w-4" /> : children}
    </span>
  );
}

function LangBtn({ current, value, onClick, children }: { current: string; value: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`btn flex-1 ${current === value ? 'btn-primary' : 'btn-secondary'}`}>{children}</button>
  );
}
