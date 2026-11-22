import { getSetting } from '../db.js';

export type LlmProvider = 'ollama' | 'vllm' | 'deepseek' | 'lmstudio' | 'gemini';

// Reasoning models (Qwen3 and friends) emit a chain-of-thought that isn't
// part of `content` but does eat into `max_tokens`, so a tight budget leaves
// nothing for the actual answer — same failure mode as Ollama's `think`
// field, addressed the same way. `chat_template_kwargs` is vLLM's pass-through
// to the tokenizer's chat template; non-thinking models/templates ignore it.
const VLLM_NO_THINK = { chat_template_kwargs: { enable_thinking: false } };

// Google AI Studio (Gemini) takes `reasoning_effort` on its OpenAI-compatible
// endpoint to control reasoning on thinking models. "none" turns thinking off
// where that is supported (Gemini 2.5 Flash and friends), so hidden reasoning
// doesn't eat into the coach's tight max_tokens budget. Gemini 2.5 Pro and the
// 3.x / 4.x families cannot turn it off at all — Google rejects 'none' there
// with HTTP 400 — so for those we ask for the lowest level Google accepts and
// widen the budget instead (see GEMINI_THINKING_RESERVE).
const GEMINI_LOWEST_EFFORT = 'low';

// Thinking tokens count against `max_tokens` on Gemini, and the coach's budget
// (220 live, 1500 for a review) is sized for the answer alone. Whenever
// reasoning is actually on — because the admin asked for it, or because the
// model cannot turn it off — add room for it; without this the model spends the
// whole budget thinking and streams back nothing. This only lifts a cap, so a
// non-thinking answer is still as short as the prompt asks for.
const GEMINI_THINKING_RESERVE = 1024;

// Models that answered HTTP 400 to `reasoning_effort` itself (rather than to
// the value). Remembered for the process lifetime so one rejection doesn't cost
// every later coach call a second request.
const geminiNoReasoningParam = new Set<string>();

// Google's own wording when it refuses a reasoning level/field, as opposed to a
// genuinely bad request (unknown model, malformed body, safety).
const REASONING_REJECTED = /reasoning|thinking|thought|invalid argument/i;

const VALID_REASONING_EFFORTS = new Set(['none', 'low', 'medium', 'high']);

export function geminiReasoningEffort(): string {
  const env = process.env.GEMINI_REASONING_EFFORT;
  if (env && VALID_REASONING_EFFORTS.has(env)) return env;
  const db = getSetting('gemini_reasoning_effort');
  if (db && VALID_REASONING_EFFORTS.has(db)) return db;
  return 'none';
}

export function isAlwaysThinkingModel(model?: string): boolean {
  if (!model) return false;
  const m = model.toLowerCase();
  return /gemini-(?:[3-9]|2\.5-pro|(?:flash|pro)(?:-lite)?-latest|omni)/.test(m);
}

/** The level Gemini will actually be asked for: 'none' only where the model can
 *  honour it. */
export function geminiEffectiveEffort(effort = geminiReasoningEffort(), model?: string): string {
  const eff = VALID_REASONING_EFFORTS.has(effort) ? effort : 'none';
  if (eff === 'none' && isAlwaysThinkingModel(model)) return GEMINI_LOWEST_EFFORT;
  return eff;
}

export function geminiThinkingParams(effort = geminiReasoningEffort(), model?: string): Record<string, unknown> {
  return { reasoning_effort: geminiEffectiveEffort(effort, model) };
}

/** Token budget for a Gemini call: the answer budget, plus headroom for hidden
 *  reasoning whenever reasoning is on. */
export function geminiMaxTokens(maxTokens: number, effort = geminiReasoningEffort(), model?: string): number {
  if (model && geminiNoReasoningParam.has(model)) return maxTokens + GEMINI_THINKING_RESERVE;
  return geminiEffectiveEffort(effort, model) === 'none' ? maxTokens : maxTokens + GEMINI_THINKING_RESERVE;
}

/** Put the Gemini-only fields on an OpenAI-shaped request body: the reasoning
 *  level, and the matching token budget. Skipped for a model we already know
 *  rejects the field. */
function applyGeminiThinking(body: Record<string, unknown>, model: string, effort = geminiReasoningEffort()): void {
  if (geminiNoReasoningParam.has(model)) {
    if (typeof body.max_tokens === 'number') body.max_tokens = geminiMaxTokens(body.max_tokens, effort, model);
    return;
  }
  Object.assign(body, geminiThinkingParams(effort, model));
  if (typeof body.max_tokens === 'number') body.max_tokens = geminiMaxTokens(body.max_tokens, effort, model);
}

/** Read an error body without caring what shape it is or whether it is there. */
async function readApiError(res: Response): Promise<string | null> {
  try { return parseApiError(await res.json()); } catch { return null; }
}

/** The one place that handles "Gemini rejected `reasoning_effort`": read the
 *  error once, and only when it is about reasoning send the request again
 *  without the field. Returns the response the caller should go on with, plus
 *  the error detail to report if that response is still a failure (its body has
 *  already been read by then). */
async function geminiReasoningRetry(
  res: Response,
  body: Record<string, unknown>,
  send: (b: Record<string, unknown>) => Promise<Response>,
): Promise<{ res: Response; detail: string | null }> {
  if (res.ok || res.status !== 400 || !('reasoning_effort' in body)) return { res, detail: null };
  const detail = await readApiError(res);
  if (!detail || !REASONING_REJECTED.test(detail)) return { res, detail };
  const retryBody = { ...body };
  delete retryBody.reasoning_effort;
  if (typeof retryBody.max_tokens === 'number') {
    const model = typeof body.model === 'string' ? body.model : undefined;
    if (geminiEffectiveEffort(geminiReasoningEffort(), model) === 'none') {
      retryBody.max_tokens = (retryBody.max_tokens as number) + GEMINI_THINKING_RESERVE;
    }
  }
  const retry = await send(retryBody);
  if (retry.ok) {
    if (typeof body.model === 'string') geminiNoReasoningParam.add(body.model);
    return { res: retry, detail: null };
  }
  // The second failure is the one worth reporting — the first only told us the
  // reasoning field was unwelcome.
  return { res: retry, detail: (await readApiError(retry)) ?? detail };
}

// Filter to chat/completion-capable models for the coach. Google AI Studio's /models endpoint
// returns the entire model catalog (~65 entries including embeddings, imagen, veo, TTS, transcribe,
// real-time WebSocket live models, and deprecated models) which throw HTTP 404/400 if sent to /chat/completions.
// Everything that isn't a Gemini or Gemma model (imagen, veo, lyria, genie, …) is already out on
// the prefix check; these are the non-chat members of those two families.
export function isGeminiChatModel(name: string): boolean {
  const norm = name.replace(/^models\//, '').toLowerCase();
  if (!norm.startsWith('gemini-') && !norm.startsWith('gemma-')) return false;
  const nonChatKeywords = [
    'embedding',
    '-tts',
    '-transcribe',
    '-image',
    'vision',
    'aqa',
    'robotics',
    'banana',
    'native-audio',
    '-live',
    'decision',
    'computer-use',
  ];
  return !nonChatKeywords.some((kw) => norm.includes(kw));
}

// Google AI Studio's OpenAI endpoint wraps error responses either in an array
// `[{ error: { message } }]` or an object `{ error: { message } }`, while some
// vLLM / LM Studio builds answer with a bare string (`{ error: "…" }`) or with
// a code and no message at all. Every one of those has to come back as *some*
// string: a caller that reads `null` here treats the reply as a successful
// empty answer and retries the whole prompt instead of failing loudly.
export function parseApiError(data: unknown): string | null {
  if (!data) return null;
  const node = Array.isArray(data) ? data[0] : data;
  if (!node || typeof node !== 'object' || !('error' in node)) return null;
  const err = (node as { error?: unknown }).error;
  if (!err) return null;
  if (typeof err === 'string') return err;
  if (typeof err !== 'object') return String(err);
  const { message, code, status, type } = err as { message?: unknown; code?: unknown; status?: unknown; type?: unknown };
  if (typeof message === 'string' && message) return message;
  for (const alt of [status, code, type]) {
    if (typeof alt === 'string' && alt) return alt;
    if (typeof alt === 'number') return String(alt);
  }
  return 'error';
}

// DeepSeek is a hosted OpenAI-compatible API. It's the "cloud LLM" option
// alongside local Ollama / self-hosted vLLM. Unlike the local providers, its
// URL has a sensible default and the API key is the real "configured" signal.
const DEEPSEEK_BASE = 'https://api.deepseek.com';

// Google AI Studio (Gemini) provides an official OpenAI-compatible endpoint.
// Like DeepSeek, its URL defaults to the official endpoint and the API key
// from https://aistudio.google.com/ is the real "configured" signal.
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';

export interface LlmModel { name: string; size: number; details?: { parameter_size?: string } }

export function llmProvider(): LlmProvider {
  const p = getSetting('llm_provider');
  if (p === 'vllm') return 'vllm';
  if (p === 'deepseek') return 'deepseek';
  if (p === 'lmstudio') return 'lmstudio';
  if (p === 'gemini') return 'gemini';
  return 'ollama';
}

// DeepSeek API key — env wins (Docker secrets), DB setting as fallback. Never
// returned to the client; the admin surface only reports whether one is set.
export function deepseekApiKey(): string | null {
  return process.env.DEEPSEEK_API_KEY || getSetting('deepseek_api_key') || null;
}

// Google AI Studio (Gemini) API key — env wins (Docker secrets), DB setting as fallback.
// Never returned to the client; the admin surface only reports whether one is set.
export function geminiApiKey(): string | null {
  return process.env.GEMINI_API_KEY || getSetting('gemini_api_key') || null;
}

// Ollama, vLLM, LM Studio, DeepSeek and Gemini are configured independently (own URL + model
// each), so switching the provider toggle doesn't clobber whichever one you
// aren't currently using — e.g. an Ollama box for quick local models, a vLLM
// server for a bigger one, LM Studio for local desktop inference, DeepSeek
// or Google Gemini for a cloud model, configured once each.
export function llmUrl(): string | null {
  const p = llmProvider();
  const url = p === 'vllm' ? getSetting('vllm_url')
    : p === 'deepseek' ? (getSetting('deepseek_url') || DEEPSEEK_BASE)
    : p === 'gemini' ? (getSetting('gemini_url') || GEMINI_BASE)
    : p === 'lmstudio' ? getSetting('lmstudio_url')
    : getSetting('ollama_url');
  return url ? url.replace(/\/$/, '') : null;
}

// Whether the currently-selected LLM is actually usable. For DeepSeek and Gemini the URL
// always resolves to a default, so the API key is what makes it "configured";
// the other providers are configured once they have a URL.
export function llmConfigured(): boolean {
  if (llmProvider() === 'deepseek') return !!deepseekApiKey();
  if (llmProvider() === 'gemini') return !!geminiApiKey();
  return !!llmUrl();
}

export function llmModel(): string {
  const p = llmProvider();
  if (p === 'vllm') return getSetting('vllm_model') || '';
  if (p === 'deepseek') return getSetting('deepseek_model') || 'deepseek-chat';
  // The newest stable Flash; gemini-3.5-flash is deprecated and routed to 3.6,
  // and this default is what a fresh Gemini setup runs on until the admin picks
  // a model from the list.
  if (p === 'gemini') return getSetting('gemini_model') || 'gemini-3.8-flash';
  if (p === 'lmstudio') return getSetting('lmstudio_model') || '';
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

// OpenAI-compatible providers (vLLM, LM Studio, DeepSeek, Gemini) speak the same dialect; these
// helpers centralize the two places they differ — where the API root is and
// the auth header (DeepSeek and Gemini need a Bearer key, vLLM/LM Studio are usually unauthenticated).
//
// The vLLM / LM Studio URL is the bare server (`http://host:8000` or `http://localhost:1234`)
// and its routes live under `/v1` — for models *and* chat. 7.15.0 dropped the `/v1` from the model
// list, which broke "Test" on every existing vLLM setup, and adding `/v1` to
// the URL as a workaround then broke chat (`/v1/v1/…`). A URL that already
// ends in `/v1` is accepted, since that is how OpenAI base URLs are usually
// written. DeepSeek and Gemini URLs are already the API root. server/test/llm-providers
// pins every route.
type OpenAiLike = 'vllm' | 'deepseek' | 'lmstudio' | 'gemini';
export function openAiRoot(url: string, provider: OpenAiLike): string {
  const base = url.replace(/\/+$/, '');
  return (provider === 'vllm' || provider === 'lmstudio') ? `${base.replace(/\/v1$/, '')}/v1` : base;
}
function openAiEndpoint(base: string, provider: OpenAiLike, path: 'models' | 'chat/completions' = 'chat/completions'): string {
  return `${openAiRoot(base, provider)}/${path}`;
}
function openAiHeaders(provider: OpenAiLike, apiKey?: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = apiKey || (provider === 'gemini' ? geminiApiKey() : provider === 'deepseek' ? deepseekApiKey() : null);
  if (key) h.Authorization = `Bearer ${key}`;
  return h;
}

/** List models available on the configured host, normalized across providers.
 *  Ollama exposes its native `/api/tags`; vLLM (`/v1/models`), LM Studio
 *  (`/v1/models`), DeepSeek (`/models`) and Gemini (`/models`) expose the OpenAI-compatible list
 *  (one entry per served model). */
export async function testConnection(url: string, provider: LlmProvider = llmProvider(), apiKey?: string): Promise<{ ok: true; models: LlmModel[] } | { ok: false; error: string }> {
  const base = url.replace(/\/$/, '');
  try {
    if (provider === 'vllm' || provider === 'deepseek' || provider === 'lmstudio' || provider === 'gemini') {
      const key = apiKey || (provider === 'gemini' ? geminiApiKey() : provider === 'deepseek' ? deepseekApiKey() : null);
      if (provider === 'deepseek' && !key) return { ok: false, error: 'deepseek_api_key_missing' };
      if (provider === 'gemini' && !key) return { ok: false, error: 'gemini_api_key_missing' };
      const res = await fetch(openAiEndpoint(base, provider, 'models'), {
        headers: (provider === 'deepseek' || provider === 'gemini') ? { Authorization: `Bearer ${key ?? ''}` } : undefined,
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const detail = parseApiError(await res.json());
          if (detail) msg = `${msg}: ${detail}`;
        } catch {}
        return { ok: false, error: msg };
      }
      const data = (await res.json()) as { data?: { id: string }[] };
      let rawModels = (data.data ?? []).map((m) => ({
        name: provider === 'gemini' ? m.id.replace(/^models\//, '') : m.id,
        size: 0,
      }));
      if (provider === 'gemini') {
        const chatOnly = rawModels.filter((m) => isGeminiChatModel(m.name));
        if (chatOnly.length > 0) rawModels = chatOnly;
      }
      return { ok: true, models: rawModels };
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
  const provider = llmProvider();
  const res = await testConnection(url, provider);
  if (!res.ok) return false;
  // testConnection already normalizes the names it returns for Gemini;
  // only strip the prefix when talking to Gemini.
  const want = provider === 'gemini' ? model.replace(/^models\//, '') : model;
  const ok = res.models.some((m) => m.name === want || m.name.split(':')[0] === want.split(':')[0]);
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
export async function chatStream(messages: ChatMessage[], onChunk: (text: string) => void | Promise<void>, opts: ChatOpts = {}): Promise<void> {
  if (!llmConfigured()) throw new Error('llm_not_configured');
  const url = llmUrl()!;
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
    if (provider === 'vllm' || provider === 'deepseek' || provider === 'lmstudio' || provider === 'gemini') {
      const body: Record<string, unknown> = {
        model, messages, stream: true,
        temperature: opts.temperature ?? 0.3,
        top_p: opts.topP ?? 0.9,
        max_tokens: opts.numPredict ?? 220,
      };
      if (provider === 'vllm') Object.assign(body, VLLM_NO_THINK);
      if (provider === 'gemini') applyGeminiThinking(body, model);
      const send = (b: Record<string, unknown>) => fetch(openAiEndpoint(url, provider), {
        method: 'POST',
        headers: openAiHeaders(provider),
        body: JSON.stringify(b),
        signal: ac.signal,
      });
      let res = await send(body);
      let detail: string | null = null;
      if (provider === 'gemini') ({ res, detail } = await geminiReasoningRetry(res, body, send));
      if (!res.ok || !res.body) {
        const msg = detail ?? await readApiError(res);
        throw new Error(msg ? `llm_${msg}` : `llm_http_${res.status}`);
      }
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
          // Only the parse is allowed to fail quietly. `onChunk` does real I/O
          // (the SSE write to the browser), and swallowing its rejection meant a
          // client that had gone away left the model generating — and billing —
          // until the hard timeout.
          let obj: { choices?: { delta?: { content?: string } }[]; error?: unknown };
          try {
            obj = JSON.parse(payload) as typeof obj;
          } catch {
            continue; // malformed JSON line
          }
          const err = parseApiError(obj);
          if (err) throw new Error(`llm_${err}`);
          const text = obj.choices?.[0]?.delta?.content;
          if (text) await onChunk(text);
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
          // As above: a bad line is skipped, an `onChunk` rejection is not.
          let obj: { message?: { content?: string }; done?: boolean; error?: string };
          try {
            obj = JSON.parse(line) as typeof obj;
          } catch {
            continue; // malformed JSON line
          }
          if (obj.error) throw new Error(`llm_${obj.error}`);
          const text = obj.message?.content;
          if (text) await onChunk(text);
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
// `format: "json"` and the OpenAI-compatible `response_format:
// {type:"json_object"}` both constrain the model to valid JSON; we still
// parse defensively.
export async function chatJson<T = unknown>(
  messages: ChatMessage[],
  opts: { model?: string; temperature?: number; numPredict?: number; signal?: AbortSignal; timeoutMs?: number; fallback?: boolean } = {},
): Promise<T> {
  if (!llmConfigured()) throw new Error('llm_not_configured');
  const url = llmUrl()!;
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
    if (provider === 'vllm' || provider === 'deepseek' || provider === 'lmstudio' || provider === 'gemini') {
      const body: Record<string, unknown> = {
        model, messages, stream: false,
        response_format: { type: 'json_object' },
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.numPredict ?? 1500,
      };
      if (provider === 'vllm') Object.assign(body, VLLM_NO_THINK);
      if (provider === 'gemini') applyGeminiThinking(body, model);
      const send = (b: Record<string, unknown>) => fetch(openAiEndpoint(url, provider), {
        method: 'POST',
        headers: openAiHeaders(provider),
        body: JSON.stringify(b),
        signal: ac.signal,
      });
      let res = await send(body);
      let detail: string | null = null;
      if (provider === 'gemini') ({ res, detail } = await geminiReasoningRetry(res, body, send));
      if (!res.ok) {
        const msg = detail ?? await readApiError(res);
        throw new Error(msg ? `llm_${msg}` : `llm_http_${res.status}`);
      }
      const data = await res.json();
      const apiErr = parseApiError(data);
      if (apiErr) throw new Error(`llm_${apiErr}`);
      raw = (data as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content ?? '';
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
export async function testModel(url: string, model: string, timeoutMs = 30_000, provider: LlmProvider = llmProvider(), apiKey?: string, reasoningEffort?: string): Promise<{ ok: boolean; latencyMs: number; sample?: string; error?: string }> {
  const base = url.replace(/\/$/, '');
  const start = Date.now();
  try {
    if (provider === 'vllm' || provider === 'deepseek' || provider === 'lmstudio' || provider === 'gemini') {
      const body: Record<string, unknown> = {
        model,
        messages: [{ role: 'user', content: 'Reply with exactly the word OK and nothing else.' }],
        stream: false,
        temperature: 0.1,
      };
      if (provider === 'vllm') Object.assign(body, VLLM_NO_THINK);
      // No max_tokens here on purpose: the smoke test asks for one word, and a
      // cap would be spent on thinking before the model got to say it.
      if (provider === 'gemini') applyGeminiThinking(body, model, reasoningEffort);
      const send = (b: Record<string, unknown>) => fetch(openAiEndpoint(base, provider), {
        method: 'POST',
        headers: openAiHeaders(provider, apiKey),
        body: JSON.stringify(b),
        signal: AbortSignal.timeout(timeoutMs),
      });
      let res = await send(body);
      let detail: string | null = null;
      if (provider === 'gemini') ({ res, detail } = await geminiReasoningRetry(res, body, send));
      const latencyMs = Date.now() - start;
      if (!res.ok) {
        const msg = detail ?? await readApiError(res);
        return { ok: false, latencyMs, error: msg ? `HTTP ${res.status}: ${msg}` : `HTTP ${res.status}` };
      }
      const data = await res.json();
      const apiErr = parseApiError(data);
      if (apiErr) return { ok: false, latencyMs, error: apiErr };
      const sample = ((data as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content ?? '').trim().slice(0, 80);
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
