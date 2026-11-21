import { useCallback, useEffect, useState } from 'react';
import { Activity, ArrowUpRight, CheckCircle2, CircleHelp, CirclePause, Cloud, Copy, KeyRound, Link2, Loader2, Play, RefreshCw, Save, ShieldCheck, Square, TerminalSquare, Unplug, XCircle } from 'lucide-react';
import { api } from '../../api';

type Status = {
  available: boolean; tunnelClientInstalled: boolean; localMcpCredentialsSaved: boolean;
  tunnelId: string | null; runtimeKeySaved: boolean; configured: boolean;
  serviceInstalled: boolean; autoStart: boolean; serviceState: string;
  tunnelHealthy: boolean; connected: boolean; checkedAt: string;
};

const field = 'input w-full font-mono text-sm';
const btn = 'inline-flex items-center justify-center gap-2 rounded-lg border border-ink-200 px-4 py-2 text-sm font-semibold transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-ink-600 dark:hover:bg-ink-800';
function StateLabel({ ok, pending, children }: { ok: boolean; pending?: boolean; children: React.ReactNode }) {
  return <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${ok ? 'text-emerald-600 dark:text-emerald-400' : pending ? 'text-amber-600' : 'text-ink-500'}`}>
    {ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}{children}
  </span>;
}

export default function McpConnection() {
  const [status, setStatus] = useState<Status | null>(null);
  const [tunnelId, setTunnelId] = useState('');
  const [runtimeKey, setRuntimeKey] = useState('');
  const [password, setPassword] = useState('');
  const [autoStart, setAutoStart] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [test, setTest] = useState<{ok: boolean; message: string} | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await api.get<Status>('/api/admin/mcp/status');
      setStatus(next);
      if (!loaded) {
        setTunnelId(next.tunnelId || '');
        setAutoStart(next.autoStart || !next.serviceInstalled);
        setLoaded(true);
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load MCP status.'); }
  }, [loaded]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function action(task: () => Promise<unknown>, success: string) {
    setBusy(true); setError(''); setNotice('');
    try { await task(); setNotice(success); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'The request failed.'); }
    finally { setBusy(false); }
  }

  async function save() {
    await action(async () => {
      const result = await api.post<Status>('/api/admin/mcp/setup', {
        tunnelId: tunnelId.trim(),
        ...(runtimeKey ? { runtimeKey: runtimeKey.trim() } : {}),
        ...(password ? { patzerPassword: password } : {}),
        autoStart,
      });
      setRuntimeKey(''); setPassword(''); setStatus(result);
    }, 'Saved securely. Tunnel service started; status will update automatically.');
  }

  const running = status?.serviceState === 'active';
  const live = !!status?.connected;
  const canSave = !!status?.available && !!status.tunnelClientInstalled && /^tunnel_[0-9a-f]{32}$/.test(tunnelId.trim()) && (status.runtimeKeySaved || runtimeKey.trim().length >= 12) && (status.localMcpCredentialsSaved || password.length >= 10);
  const phase = !status?.configured ? 1 : !live ? 2 : 3;

  return <div className="mx-auto max-w-4xl space-y-6 pb-24">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-amber-600"><Link2 size={15} /> Integrations</div>
        <h1 className="page-h1 mt-1">ChatGPT & MCP connection</h1>
        <p className="page-sub">Connect Patzer to ChatGPT once. The tunnel starts automatically after login.</p>
      </div>
      <button className={btn} disabled={busy} onClick={() => void refresh()}><RefreshCw size={15} /> Refresh status</button>
    </header>

    <section className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`rounded-xl p-3 ${live ? 'bg-emerald-500/10 text-emerald-600' : running ? 'bg-amber-500/10 text-amber-600' : 'bg-ink-100 text-ink-500 dark:bg-ink-800'}`}>
            {live ? <Activity size={24} /> : <Unplug size={24} />}
          </div>
          <div>
            <h2 className="font-semibold">{live ? 'Tunnel connected' : running ? 'Starting / reconnecting' : status?.configured ? 'Tunnel offline' : 'Not configured yet'}</h2>
            <p className="text-sm text-ink-500">{live ? 'OpenAI tunnel reports ready after a control-plane poll.' : running ? 'Service running; waiting for OpenAI to accept the connection.' : status?.configured ? 'Saved configuration is available. Start the tunnel below.' : 'Finish the one-time connection wizard.'}</p>
          </div>
        </div>
        {status && <span className="text-xs text-ink-400">Live refresh every 5 sec · {new Date(status.checkedAt).toLocaleTimeString()}</span>}
      </div>
      <div className="mt-5 grid gap-3 border-t border-ink-200 pt-4 text-sm dark:border-ink-700 sm:grid-cols-2">
        <div className="flex items-center justify-between gap-3"><span>Patzer MCP credentials</span><StateLabel ok={!!status?.localMcpCredentialsSaved}>{status?.localMcpCredentialsSaved ? 'Saved' : 'Missing'}</StateLabel></div>
        <div className="flex items-center justify-between gap-3"><span>OpenAI API key</span><StateLabel ok={!!status?.runtimeKeySaved}>{status?.runtimeKeySaved ? 'Saved privately' : 'Missing'}</StateLabel></div>
        <div className="flex items-center justify-between gap-3"><span>Local tunnel client</span><StateLabel ok={!!status?.tunnelClientInstalled}>{status?.tunnelClientInstalled ? 'Installed' : 'Not found'}</StateLabel></div>
        <div className="flex items-center justify-between gap-3"><span>Auto-start at login</span><StateLabel ok={!!status?.autoStart}>{status?.autoStart ? 'Enabled' : 'Disabled'}</StateLabel></div>
        <div className="flex items-center justify-between gap-3"><span>System service</span><StateLabel ok={!!running}>{status?.serviceState || 'Unknown'}</StateLabel></div>
        <div className="flex items-center justify-between gap-3"><span>OpenAI tunnel readiness</span><StateLabel ok={live}>{live ? 'Ready' : 'Not connected'}</StateLabel></div>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <button className={btn} disabled={!status?.configured || busy || running} onClick={() => void action(() => api.post('/api/admin/mcp/start', {}), 'Tunnel start requested.')}><Play size={16} /> Start tunnel</button>
        <button className={btn} disabled={!running || busy} onClick={() => void action(() => api.post('/api/admin/mcp/stop', {}), 'Tunnel stopped.')}><Square size={15} /> Stop tunnel</button>
        <button className={btn} disabled={busy || !status?.localMcpCredentialsSaved} onClick={() => void action(async () => { const result = await api.post<{ok: boolean; message: string}>('/api/admin/mcp/test-local', {}); setTest(result); if (!result.ok) throw Error(result.message); }, 'Local MCP login and game discovery passed.')}><ShieldCheck size={16} /> Test Patzer MCP</button>
      </div>
      {test && <p className={`mt-3 text-sm ${test.ok ? 'text-emerald-600' : 'text-amber-600'}`}>{test.message}</p>}
    </section>

    <div className="flex gap-2 text-xs font-semibold sm:text-sm">
      {['Configure', 'Connect', 'Use in ChatGPT'].map((label, i) => <div key={label} className={`flex-1 rounded-lg px-3 py-2 text-center ${phase === i+1 ? 'bg-amber-500 text-ink-900' : 'bg-ink-100 text-ink-500 dark:bg-ink-800'}`}>{i + 1}. {label}</div>)}
    </div>

    {!status?.available && status && <div className="rounded-lg border border-amber-500/40 p-4 text-sm text-amber-700 dark:text-amber-400">For security, connection setup is supported only when Patzer runs on <code>127.0.0.1</code>. Set <code>HOST=127.0.0.1</code> and restart Patzer before using this page.</div>}
    <section className="card p-5 sm:p-6">
      <div className="mb-4 flex items-center gap-2"><KeyRound className="text-amber-500" size={20} /><h2 className="text-lg font-semibold">One-time connection wizard</h2></div>
      <div className="space-y-5">
        <div>
          <label className="label mb-1 block">1. Secure MCP tunnel ID</label>
          <input className={field} spellCheck={false} autoComplete="off" value={tunnelId} onChange={(e) => setTunnelId(e.target.value)} placeholder="tunnel_..." />
          <p className="mt-1 text-xs text-ink-500">Create a tunnel in <a className="underline" href="https://platform.openai.com/settings/organization/tunnels" target="_blank" rel="noreferrer">OpenAI Platform <ArrowUpRight size={12} className="inline" /></a>. Reuse your existing ID if already connected.</p>
        </div>
        <div>
          <label className="label mb-1 block">2. OpenAI Platform runtime API key {status?.runtimeKeySaved && <span className="text-emerald-600">— already saved; leave blank to keep it</span>}</label>
          <input className={field} type="password" autoComplete="new-password" spellCheck={false} value={runtimeKey} onChange={(e) => setRuntimeKey(e.target.value)} placeholder={status?.runtimeKeySaved ? 'Saved securely (unchanged)' : 'Paste your runtime key here once'} />
          <p className="mt-1 text-xs text-ink-500">Create a key with Tunnels Read + Use at <a className="underline" href="https://platform.openai.com/settings/organization/api-keys" target="_blank" rel="noreferrer">OpenAI Platform API keys <ArrowUpRight size={12} className="inline" /></a>. This is not your ChatGPT login.</p>
        </div>
        {!status?.localMcpCredentialsSaved && <div>
          <label className="label mb-1 block">3. Your Patzer login password</label>
          <input className={field} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your Patzer password" />
          <p className="mt-1 text-xs text-ink-500">Only required if the local MCP bridge was never connected. Your password is saved privately on this computer.</p>
        </div>}
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-ink-200 p-3 dark:border-ink-700">
          <input className="mt-1" type="checkbox" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} />
          <span><strong className="block text-sm">Connect automatically when I log in</strong><span className="block text-xs text-ink-500">Starts a persistent systemd user service and reconnects on failures. No terminal or Chat On Steroids is needed.</span></span>
        </label>
        <button className={`${btn} w-full border-amber-500 bg-amber-500 text-ink-950 hover:bg-amber-400`} disabled={!canSave || busy} onClick={() => void save()}>
          {busy ? <Loader2 className="animate-spin" size={17} /> : <Save size={17} />}
          {status?.configured ? 'Update & reconnect' : 'Save & connect'}
        </button>
      </div>
    </section>

    <section className="card p-5 sm:p-6">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold"><Cloud size={20} /> Finish in ChatGPT</h2>
      <p className="text-sm text-ink-500">Once this page reports <strong>Tunnel connected</strong>, open your personal ChatGPT account, add your custom MCP integration using the same tunnel ID, and select no additional MCP authentication. If you already added it, you don't need to add it again.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <a className={btn} href="https://chatgpt.com/plugins" target="_blank" rel="noreferrer"><ArrowUpRight size={16} /> ChatGPT Plugins</a>
        <button className={btn} disabled={!tunnelId} onClick={() => void navigator.clipboard.writeText(tunnelId)}><Copy size={16} /> Copy tunnel ID</button>
      </div>
      <div className="mt-4 flex items-start gap-2 rounded-lg bg-ink-100 p-3 text-xs text-ink-600 dark:bg-ink-800 dark:text-ink-300">
        <CircleHelp size={16} className="shrink-0" /><span>Patzer can verify the local MCP service and the tunnel's connection to OpenAI. It cannot verify whether your personal ChatGPT account has installed or selected the plugin. Test it by asking ChatGPT to list your latest Patzer games.</span>
      </div>
    </section>
    <section className="flex flex-wrap gap-4 text-xs text-ink-500"><span className="inline-flex items-center gap-1"><ShieldCheck size={14} /> Admin-only, localhost only</span><span className="inline-flex items-center gap-1"><KeyRound size={14} /> Keys never returned by the API</span><span className="inline-flex items-center gap-1"><TerminalSquare size={14} /> No manual startup required</span><span className="inline-flex items-center gap-1"><CirclePause size={14} /> Stop anytime</span></section>
    {error && <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-600">{error}</div>}
    {notice && <div role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600">{notice}</div>}
  </div>;
}
