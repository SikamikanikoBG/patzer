import { getSetting } from '../db.js';

export interface OllamaModel { name: string; size: number; details?: { parameter_size?: string } }

export function ollamaUrl(): string | null {
  const url = getSetting('ollama_url');
  return url ? url.replace(/\/$/, '') : null;
}

export function ollamaModel(): string {
  return getSetting('ollama_model') || 'gemma3:1b';
}

/** Comma-separated CSV of fallback models, tried in order on 404 / model-not-found. */
export function ollamaFallbackModels(): string[] {
  const csv = getSetting('ollama_fallback_models') ?? '';
  return csv.split(',').map((s) => s.trim()).filter(Boolean);
}

// Module-level: which models we've already verified are pulled this server
// lifetime. Avoids hitting `/api/tags` on every call.
const verifiedModels = new Set<string>();
// p95 latency ring buffer for the admin /system surface.
const latencyRing: number[] = [];
const LATENCY_RING_MAX = 50;
function recordLatency(ms: number): void {
  latencyRing.push(ms);
  if (latencyRing.length > LATENCY_RING_MAX) latencyRing.shift();
}
export function ollamaStats(): { count: number; p95Ms: number | null; lastError: string | null; lastModelUsed: string | null } {
  const sorted = [...latencyRing].sort((a, b) => a - b);
  const p95Idx = Math.floor(sorted.length * 0.95);
  return {
    count: sorted.length,
    p95Ms: sorted.length ? Math.round(sorted[Math.min(p95Idx, sorted.length - 1)]!) : null,
    lastError,
    lastModelUsed,
  };
}
let lastError: string | null = null;
let lastModelUsed: string | null = null;

export async function testOllama(url: string): Promise<{ ok: true; models: OllamaModel[] } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/api/tags`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = (await res.json()) as { models?: OllamaModel[] };
    return { ok: true, models: data.models ?? [] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Check whether a given model is available on the configured Ollama host.
 *  Caches positive results so repeated calls are cheap. Returns false on any
 *  error (caller falls back to next model). */
export async function ensureModel(model: string): Promise<boolean> {
  if (verifiedModels.has(model)) return true;
  const url = ollamaUrl();
  if (!url) return false;
  try {
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return false;
    const data = (await res.json()) as { models?: { name: string }[] };
    const ok = (data.models ?? []).some((m) => m.name === model || m.name.split(':')[0] === model.split(':')[0]);
    if (ok) verifiedModels.add(model);
    return ok;
  } catch {
    return false;
  }
}

/** Resolve which model to use, walking the fallback chain. Returns the first
 *  model that's actually pulled; falls back to the configured default if none
 *  of the fallback list is present (the call will then fail loudly on 404,
 *  which is the right surface — admin needs to know to pull a model). */
export async function resolveModel(preferred?: string): Promise<string> {
  const want = preferred ?? ollamaModel();
  if (await ensureModel(want)) return want;
  for (const m of ollamaFallbackModels()) {
    if (await ensureModel(m)) return m;
  }
  return want;
}

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

// Streams response chunks. Calls `onChunk` per token batch.
// Hard timeout (default 120s) and idle timeout (default 30s) ensure silent
// failures (model loading forever, network hung) become loud errors.
export async function chatStream(
  messages: ChatMessage[],
  onChunk: (text: string) => void,
  opts: { model?: string; temperature?: number; topP?: number; numPredict?: number; signal?: AbortSignal; hardTimeoutMs?: number; idleTimeoutMs?: number; fallback?: boolean } = {},
): Promise<void> {
  const url = ollamaUrl();
  if (!url) throw new Error('ollama_not_configured');
  const model = (opts.fallback === false) ? (opts.model ?? ollamaModel()) : await resolveModel(opts.model);
  lastModelUsed = model;
  const _started = Date.now();
  const hardMs = opts.hardTimeoutMs ?? 120_000;
  const idleMs = opts.idleTimeoutMs ?? 30_000;

  const ac = new AbortController();
  const onAbort = () => ac.abort();
  opts.signal?.addEventListener('abort', onAbort);
  const hardTimer = setTimeout(() => ac.abort(new Error('ollama_hard_timeout')), hardMs);
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  function bumpIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => ac.abort(new Error('ollama_idle_timeout')), idleMs);
  }
  bumpIdle();

  try {
    const res = await fetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        // Reasoning models (gemma4, gpt-oss, …) emit a chain-of-thought into
        // `message.thinking` and only put the final answer into
        // `message.content`. With a tight num_predict that CoT eats the whole
        // budget and the user sees an empty stream. The coach is a faithful
        // FACTS renderer, not an analyst — disable reasoning everywhere.
        // Non-reasoning models silently ignore this flag.
        think: false,
        // num_predict caps the worst-case token blast — coach sentences rarely
        // need more than ~220 tokens. top_p keeps the model from venturing into
        // rare-token rambles when temperature is already low.
        options: {
          temperature: opts.temperature ?? 0.3,
          top_p: opts.topP ?? 0.9,
          num_predict: opts.numPredict ?? 220,
        },
      }),
      signal: ac.signal,
    });
    if (!res.ok || !res.body) throw new Error(`ollama_http_${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bumpIdle();
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const obj = JSON.parse(line) as { message?: { content?: string }; done?: boolean; error?: string };
          if (obj.error) throw new Error(`ollama_${obj.error}`);
          const text = obj.message?.content;
          if (text) onChunk(text);
        } catch (err) {
          if ((err as Error).message?.startsWith('ollama_')) throw err;
          // ignore malformed JSON lines
        }
      }
    }
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    clearTimeout(hardTimer);
    if (idleTimer) clearTimeout(idleTimer);
    opts.signal?.removeEventListener('abort', onAbort);
    recordLatency(Date.now() - _started);
  }
}

// Non-streaming JSON-mode call. Used for batched game review where we need
// structured output (per-move comments + summary) in one response. Ollama's
// `format: "json"` constrains the model to valid JSON; we still parse defensively.
export async function chatJson<T = unknown>(
  messages: ChatMessage[],
  opts: { model?: string; temperature?: number; numPredict?: number; signal?: AbortSignal; timeoutMs?: number; fallback?: boolean } = {},
): Promise<T> {
  const url = ollamaUrl();
  if (!url) throw new Error('ollama_not_configured');
  const model = (opts.fallback === false) ? (opts.model ?? ollamaModel()) : await resolveModel(opts.model);
  lastModelUsed = model;
  const _started = Date.now();
  const timeoutMs = opts.timeoutMs ?? 180_000;

  const ac = new AbortController();
  const onAbort = () => ac.abort();
  opts.signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => ac.abort(new Error('ollama_hard_timeout')), timeoutMs);
  try {
    const res = await fetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        format: 'json',
        // Same reasoning-model defence as chatStream — see the comment there.
        think: false,
        options: {
          temperature: opts.temperature ?? 0.2,
          num_predict: opts.numPredict ?? 1500,
        },
      }),
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`ollama_http_${res.status}`);
    const data = await res.json() as { message?: { content?: string }; error?: string };
    if (data.error) throw new Error(`ollama_${data.error}`);
    const raw = data.message?.content ?? '';
    // Some models still wrap JSON in fences despite format:"json". Strip them.
    const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try {
      return JSON.parse(cleaned) as T;
    } catch (err) {
      throw new Error(`ollama_bad_json: ${(err as Error).message}: ${cleaned.slice(0, 200)}`);
    }
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
    recordLatency(Date.now() - _started);
  }
}

/** chatJson with a single retry on bad-JSON. The retry adds a "your previous
 *  reply was not valid JSON" addendum, which small models respond to well. */
export async function chatJsonRetry<T = unknown>(
  messages: ChatMessage[],
  opts: { model?: string; temperature?: number; numPredict?: number; signal?: AbortSignal; timeoutMs?: number; fallback?: boolean } = {},
): Promise<T> {
  try {
    return await chatJson<T>(messages, opts);
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (!msg.startsWith('ollama_bad_json')) throw err;
    const retried: ChatMessage[] = [
      ...messages,
      { role: 'user', content: 'Your previous reply was not valid JSON. Reply ONLY with the JSON object, no surrounding text.' },
    ];
    return chatJson<T>(retried, opts);
  }
}

// Quick smoke test of a single model — sends a tiny prompt and reports timing.
export async function testModel(url: string, model: string, timeoutMs = 30_000): Promise<{ ok: boolean; latencyMs: number; sample?: string; error?: string }> {
  const start = Date.now();
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with exactly the word OK and nothing else.' }],
        stream: false,
        options: { temperature: 0.1 },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - start;
    if (!res.ok) return { ok: false, latencyMs, error: `HTTP ${res.status}` };
    const data = await res.json() as { message?: { content?: string }; error?: string };
    if (data.error) return { ok: false, latencyMs, error: data.error };
    const sample = (data.message?.content ?? '').trim().slice(0, 80);
    return { ok: !!sample, latencyMs, sample };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: (err as Error).message };
  }
}
