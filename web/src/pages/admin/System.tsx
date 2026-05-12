import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, AlertCircle, Save, Sparkles, Cpu, Loader2, FlaskConical } from 'lucide-react';
import { api } from '../../api';

interface SysSettings {
  ollama_url: string | null;
  ollama_model: string | null;
  stockfish_path: string | null;
  last_model_used?: string | null;
  last_error?: string | null;
  p95_ms?: number | null;
  call_count?: number;
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

  function loadSettings() {
    return api.get<SysSettings>('/api/admin/system').then((d) => {
      setS({ ollama_url: d.ollama_url ?? '', ollama_model: d.ollama_model ?? '', stockfish_path: d.stockfish_path ?? '' });
      setRuntime({
        last_model_used: d.last_model_used ?? null,
        last_error: d.last_error ?? null,
        p95_ms: d.p95_ms ?? null,
        call_count: d.call_count ?? 0,
      });
      setHydrated(true);
    });
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

      <div className="sticky bottom-4 z-10 flex justify-end">
        <button onClick={save} className="btn-primary shadow-lg shadow-ink-900/10">
          <Save className="h-4 w-4" /> {saved ? t('settings.saved') : t('common.save')}
        </button>
      </div>
    </div>
  );
}
