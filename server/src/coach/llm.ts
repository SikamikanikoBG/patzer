import { getSetting } from '../db.js';

export type LlmProvider = 'ollama' | 'vllm';

// Reasoning models (Qwen3 and friends) emit a chain-of-thought that isn't
// part of `content` but does eat into `max_tokens`, so a tight budget leaves
// nothing for the actual answer — same failure mode as Ollama's `think`
// field, addressed the same way. `chat_template_kwargs` is vLLM's pass-through
// to the tokenizer's chat template; non-thinking models/templates ignore it.
const VLLM_NO_THINK = { chat_template_kwargs: { enable_thinking: false } };

export interface LlmModel { name: string; size: number; details?: { parameter_size?: string } }

export function llmProvider(): LlmProvider {
  return getSetting('llm_provider') === 'vllm' ? 'vllm' : 'ollama';
}

// Ollama and vLLM are configured independently (own URL + model each), so
// switching the provider toggle doesn't clobber whichever one you aren't
// currently using — e.g. an Ollama box for quick local models and a vLLM
// server for a bigger one, configured once each.
export function llmUrl(): string | null {
  const url = llmProvider() === 'vllm' ? getSetting('vllm_url') : getSetting('ollama_url');
  return url ? url.replace(/\/$/, '') : null;
}

export function llmModel(): string {
  if (llmProvider() === 'vllm') return getSetting('vllm_model') || '';
  return getSetting('ollama_model') || 'gemma3:1b';
}

/** Comma-separated CSV of fallback models, tried in order on 404 / model-not-found. */
export function llmFallbackModels(): string[] {
  const csv = getSetting('ollama_fallback_models') ?? '';
  return csv.split(',').map((s) => s.trim()).filter(Boolean);
}

// Module-level: which models we've already verified are pulled/served this
// server lifetime. Avoids hitting the models endpoint on every call.
const verifiedModels = new Set<string>();
// p95 latency ring buffer for the admin /system surface.
const latencyRing: number[] = [];
const LATENCY_RING_MAX = 50;
function recordLatency(ms: number): void {
  latencyRing.push(ms);
  if (latencyRing.length > LATENCY_RING_MAX) latencyRing.shift();
}
export function llmStats(): { count: number; p95Ms: number | null; lastError: string | null; lastModelUsed: string | null } {
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

/** List models available on the configured host, normalized across providers.
 *  Ollama exposes its native `/api/tags`; vLLM's OpenAI-compatible server
 *  exposes `/v1/models` (one entry per `--served-model-name`, usually just
 *  the one model that instance is running). */
export async function testConnection(url: string, provider: LlmProvider = llmProvider()): Promise<{ ok: true; models: LlmModel[] } | { ok: false; error: string }> {
  const base = url.replace(/\/$/, '');
  try {
    if (provider === 'vllm') {
      const res = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const data = (await res.json()) as { data?: { id: string }[] };
      return { ok: true, models: (data.data ?? []).map((m) => ({ name: m.id, size: 0 })) };
    }
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = (await res.json()) as { models?: LlmModel[] };
    return { ok: true, models: data.models ?? [] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Check whether a given model is available on the configured host. Caches
 *  positive results so repeated calls are cheap. Returns false on any error
 *  (caller falls back to next model). */
export async function ensureModel(model: string): Promise<boolean> {
  if (verifiedModels.has(model)) return true;
  const url = llmUrl();
  if (!url) return false;
  const res = await testConnection(url);
  if (!res.ok) return false;
  const ok = res.models.some((m) => m.name === model || m.name.split(':')[0] === model.split(':')[0]);
  if (ok) verifiedModels.add(model);
  return ok;
}

/** Resolve which model to use, walking the fallback chain. Returns the first
 *  model that's actually present; falls back to the configured default if
 *  none of the fallback list is present (the call will then fail loudly,
 *  which is the right surface — admin needs to know to pull/serve a model). */
export async function resolveModel(preferred?: string): Promise<string> {
  const want = preferred ?? llmModel();
  if (await ensureModel(want)) return want;
  for (const m of llmFallbackModels()) {
    if (await ensureModel(m)) return m;
  }
  return want;
}

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

interface ChatOpts {
  model?: string; temperature?: number; topP?: number; numPredict?: number;
  signal?: AbortSignal; hardTimeoutMs?: number; idleTimeoutMs?: number; fallback?: boolean;
}

// Streams response chunks. Calls `onChunk` per token batch.
// Hard timeout (default 120s) and idle timeout (default 30s) ensure silent
// failures (model loading forever, network hung) become loud errors.
export async function chatStream(messages: ChatMessage[], onChunk: (text: string) => void, opts: ChatOpts = {}): Promise<void> {
  const url = llmUrl();
  if (!url) throw new Error('llm_not_configured');
  const provider = llmProvider();
  const model = (opts.fallback === false) ? (opts.model ?? llmModel()) : await resolveModel(opts.model);
  lastModelUsed = model;
  const _started = Date.now();
  const hardMs = opts.hardTimeoutMs ?? 120_000;
  const idleMs = opts.idleTimeoutMs ?? 30_000;

  const ac = new AbortController();
  const onAbort = () => ac.abort();
  opts.signal?.addEventListener('abort', onAbort);
  const hardTimer = setTimeout(() => ac.abort(new Error('llm_hard_timeout')), hardMs);
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  function bumpIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => ac.abort(new Error('llm_idle_timeout')), idleMs);
  }
  bumpIdle();

  try {
    if (provider === 'vllm') {
      const res = await fetch(`${url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model, messages, stream: true,
          temperature: opts.temperature ?? 0.3,
          top_p: opts.topP ?? 0.9,
          max_tokens: opts.numPredict ?? 220,
          ...VLLM_NO_THINK,
        }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) throw new Error(`llm_http_${res.status}`);
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
          if (!line || !line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const obj = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[]; error?: { message?: string } };
            if (obj.error) throw new Error(`llm_${obj.error.message ?? 'error'}`);
            const text = obj.choices?.[0]?.delta?.content;
            if (text) onChunk(text);
          } catch (err) {
            if ((err as Error).message?.startsWith('llm_')) throw err;
            // ignore malformed JSON lines
          }
        }
      }
    } else {
      const res = await fetch(`${url}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model, messages, stream: true,
          // Reasoning models (gemma4, gpt-oss, …) emit a chain-of-thought into
          // `message.thinking` and only put the final answer into
          // `message.content`. With a tight num_predict that CoT eats the whole
          // budget and the user sees an empty stream. The coach is a faithful
          // FACTS renderer, not an analyst — disable reasoning everywhere.
          // Non-reasoning models silently ignore this flag.
          think: false,
          options: {
            temperature: opts.temperature ?? 0.3,
            top_p: opts.topP ?? 0.9,
            num_predict: opts.numPredict ?? 220,
          },
        }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) throw new Error(`llm_http_${res.status}`);
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
            if (obj.error) throw new Error(`llm_${obj.error}`);
            const text = obj.message?.content;
            if (text) onChunk(text);
          } catch (err) {
            if ((err as Error).message?.startsWith('llm_')) throw err;
            // ignore malformed JSON lines
          }
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
// `format: "json"` and vLLM's OpenAI-compatible `response_format:
// {type:"json_object"}` both constrain the model to valid JSON; we still
// parse defensively.
export async function chatJson<T = unknown>(
  messages: ChatMessage[],
  opts: { model?: string; temperature?: number; numPredict?: number; signal?: AbortSignal; timeoutMs?: number; fallback?: boolean } = {},
): Promise<T> {
  const url = llmUrl();
  if (!url) throw new Error('llm_not_configured');
  const provider = llmProvider();
  const model = (opts.fallback === false) ? (opts.model ?? llmModel()) : await resolveModel(opts.model);
  lastModelUsed = model;
  const _started = Date.now();
  const timeoutMs = opts.timeoutMs ?? 180_000;

  const ac = new AbortController();
  const onAbort = () => ac.abort();
  opts.signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => ac.abort(new Error('llm_hard_timeout')), timeoutMs);
  try {
    let raw: string;
    if (provider === 'vllm') {
      const res = await fetch(`${url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model, messages, stream: false,
          response_format: { type: 'json_object' },
          temperature: opts.temperature ?? 0.2,
          max_tokens: opts.numPredict ?? 1500,
          ...VLLM_NO_THINK,
        }),
        signal: ac.signal,
      });
      if (!res.ok) throw new Error(`llm_http_${res.status}`);
      const data = await res.json() as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
      if (data.error) throw new Error(`llm_${data.error.message ?? 'error'}`);
      raw = data.choices?.[0]?.message?.content ?? '';
    } else {
      const res = await fetch(`${url}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model, messages, stream: false,
          format: 'json',
          think: false,
          options: {
            temperature: opts.temperature ?? 0.2,
            num_predict: opts.numPredict ?? 1500,
          },
        }),
        signal: ac.signal,
      });
      if (!res.ok) throw new Error(`llm_http_${res.status}`);
      const data = await res.json() as { message?: { content?: string }; error?: string };
      if (data.error) throw new Error(`llm_${data.error}`);
      raw = data.message?.content ?? '';
    }
    // Some models still wrap JSON in fences despite the json-mode request. Strip them.
    const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try {
      return JSON.parse(cleaned) as T;
    } catch (err) {
      throw new Error(`llm_bad_json: ${(err as Error).message}: ${cleaned.slice(0, 200)}`);
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
    if (!msg.startsWith('llm_bad_json')) throw err;
    const retried: ChatMessage[] = [
      ...messages,
      { role: 'user', content: 'Your previous reply was not valid JSON. Reply ONLY with the JSON object, no surrounding text.' },
    ];
    return chatJson<T>(retried, opts);
  }
}

// Quick smoke test of a single model — sends a tiny prompt and reports timing.
export async function testModel(url: string, model: string, timeoutMs = 30_000, provider: LlmProvider = llmProvider()): Promise<{ ok: boolean; latencyMs: number; sample?: string; error?: string }> {
  const base = url.replace(/\/$/, '');
  const start = Date.now();
  try {
    if (provider === 'vllm') {
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Reply with exactly the word OK and nothing else.' }],
          stream: false,
          temperature: 0.1,
          ...VLLM_NO_THINK,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const latencyMs = Date.now() - start;
      if (!res.ok) return { ok: false, latencyMs, error: `HTTP ${res.status}` };
      const data = await res.json() as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
      if (data.error) return { ok: false, latencyMs, error: data.error.message };
      const sample = (data.choices?.[0]?.message?.content ?? '').trim().slice(0, 80);
      return { ok: !!sample, latencyMs, sample };
    }
    const res = await fetch(`${base}/api/chat`, {
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
