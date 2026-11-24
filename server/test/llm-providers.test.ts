import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Regression suite for the coach's LLM client, run against three fake servers
// over real HTTP. Each fake serves only the routes its real counterpart has,
// so a request to the wrong path fails the same way it would in production:
//
//   Ollama    — /api/tags, /api/chat
//   vLLM      — /v1/models, /v1/chat/completions  (bare server URL + /v1)
//   LM Studio — /v1/models, /v1/chat/completions  (bare server URL + /v1)
//   DeepSeek  — /models, /chat/completions        (URL is the API root, Bearer key)
//
// Written after 7.15.0 sent vLLM's model list to /models: "Test" failed on
// every existing vLLM setup, and adding /v1 to the URL as a workaround broke
// chat instead (/v1/v1/chat/completions). No test covered the routes, so CI
// stayed green. Every provider × every entry point × every URL spelling a
// user might type is pinned here.

const dir = mkdtempSync(join(tmpdir(), 'patzer-llm-'));
process.env.DB_PATH = join(dir, 'llm.db');
const DEEPSEEK_KEY = 'sk-test-123';
const GEMINI_KEY = 'AIza-test-gemini-key';

type LlmModule = typeof import('../src/coach/llm.js');
type Router = { request: (path: string, init?: RequestInit) => Response | Promise<Response> };

interface Seen { method: string; path: string; auth?: string; body?: Record<string, unknown> }

interface Fake { url: string; seen: Seen[]; server: Server }

const MODEL = { ollama: 'gemma3:1b', vllm: 'Qwen3-8B', deepseek: 'deepseek-chat', lmstudio: 'qwen2.5-7b-instruct', gemini: 'gemini-2.5-flash' } as const;

function readBody(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (!raw) return resolve(undefined);
      try { resolve(JSON.parse(raw) as Record<string, unknown>); } catch { resolve(undefined); }
    });
  });
}

// Knobs the Gemini tests turn: what /models answers with, and a forced reply
// from /chat/completions (to stand in for Google's 400s and 429s).
let vllmModels: Array<{ id: string }> = [{ id: MODEL.vllm }];
let geminiCatalog: string[] = [];
let geminiChatReply: ((body: Record<string, unknown> | undefined) => { status: number; payload: unknown } | null) | null = null;

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// An OpenAI-compatible chat answer: SSE when streaming, a JSON body otherwise,
// JSON content in json_object mode.
function openAiChat(res: ServerResponse, body: Record<string, unknown> | undefined): void {
  const jsonMode = (body?.response_format as { type?: string } | undefined)?.type === 'json_object';
  if (body?.stream) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    // Real servers slip in keep-alives and half-written frames; those lines are
    // skipped, which is not the same as skipping a failure from our own handler.
    res.write('data: not json\n\n');
    for (const part of ['Develop ', 'your ', 'knight.']) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`);
    }
    res.end('data: [DONE]\n\n');
    return;
  }
  json(res, 200, { choices: [{ message: { content: jsonMode ? '{"summary":"ok"}' : 'OK' } }] });
}

async function startFake(kind: 'ollama' | 'vllm' | 'deepseek' | 'lmstudio' | 'gemini'): Promise<Fake> {
  const seen: Seen[] = [];
  const server = createServer(async (req, res) => {
    const body = await readBody(req);
    const path = (req.url ?? '').split('?')[0]!;
    seen.push({ method: req.method ?? '', path, auth: req.headers.authorization, body });

    if (kind === 'ollama') {
      if (req.method === 'GET' && path === '/api/tags') return json(res, 200, { models: [{ name: MODEL.ollama, size: 1 }] });
      if (req.method === 'POST' && path === '/api/chat') {
        if (body?.stream) {
          res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
          res.write('not json\n');
          for (const part of ['Develop ', 'your ', 'knight.']) res.write(JSON.stringify({ message: { content: part }, done: false }) + '\n');
          res.end(JSON.stringify({ message: { content: '' }, done: true }) + '\n');
          return;
        }
        return json(res, 200, { message: { content: body?.format === 'json' ? '{"summary":"ok"}' : 'OK' } });
      }
    }

    if (kind === 'vllm') {
      if (req.method === 'GET' && path === '/v1/models') return json(res, 200, { object: 'list', data: vllmModels });
      if (req.method === 'POST' && path === '/v1/chat/completions') return openAiChat(res, body);
    }

    if (kind === 'lmstudio') {
      if (req.method === 'GET' && path === '/v1/models') return json(res, 200, { object: 'list', data: [{ id: MODEL.lmstudio }] });
      if (req.method === 'POST' && path === '/v1/chat/completions') return openAiChat(res, body);
    }

    if (kind === 'deepseek') {
      if (req.headers.authorization !== `Bearer ${DEEPSEEK_KEY}`) return json(res, 401, { error: { message: 'Authentication Fails' } });
      if (req.method === 'GET' && path === '/models') return json(res, 200, { object: 'list', data: [{ id: MODEL.deepseek }] });
      if (req.method === 'POST' && path === '/chat/completions') return openAiChat(res, body);
    }

    if (kind === 'gemini') {
      if (req.headers.authorization !== `Bearer ${GEMINI_KEY}`) return json(res, 401, { error: { message: 'API key not valid' } });
      if (req.method === 'GET' && path === '/models') {
        return json(res, 200, { object: 'list', data: geminiCatalog.map((id) => ({ id: `models/${id}` })) });
      }
      if (req.method === 'POST' && path === '/chat/completions') {
        const forced = geminiChatReply?.(body);
        if (forced) return json(res, forced.status, forced.payload);
        return openAiChat(res, body);
      }
    }

    json(res, 404, { detail: 'Not Found' });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, seen, server };
}

let llm: LlmModule;
let setSetting: (k: string, v: string) => void;
let admin: Router;
let adminCookie: string;
const fakes = {} as Record<'ollama' | 'vllm' | 'deepseek' | 'lmstudio' | 'gemini', Fake>;

// Every spelling of the same server a user might paste into Admin → System.
function spellings(base: string): string[] {
  return [base, `${base}/`, `${base}/v1`, `${base}/v1/`];
}

function useProvider(p: 'ollama' | 'vllm' | 'deepseek' | 'lmstudio' | 'gemini', url: string): void {
  setSetting('llm_provider', p);
  setSetting(`${p}_url`, url);
  setSetting(`${p}_model`, MODEL[p]);
}

beforeAll(async () => {
  fakes.ollama = await startFake('ollama');
  fakes.vllm = await startFake('vllm');
  fakes.lmstudio = await startFake('lmstudio');
  fakes.deepseek = await startFake('deepseek');
  fakes.gemini = await startFake('gemini');
  const dbm = await import('../src/db.js');
  setSetting = dbm.setSetting;
  llm = await import('../src/coach/llm.js');
  admin = (await import('../src/routes/admin.js')).default;
  const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');
  dbm.db.prepare(`INSERT INTO users (id, username, password_hash, role) VALUES (1, 'boss', 'x', 'admin')`).run();
  dbm.db.prepare(`INSERT INTO profiles (user_id, display_name) VALUES (1, 'Boss')`).run();
  adminCookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(1))}`;
});

afterAll(async () => {
  for (const f of Object.values(fakes)) await new Promise((r) => f.server.close(r));
  try { (await import('../src/db.js')).db.close(); } catch { /* ignore */ }
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  for (const f of Object.values(fakes)) f.seen.length = 0;
  process.env.DEEPSEEK_API_KEY = DEEPSEEK_KEY;
  process.env.GEMINI_API_KEY = GEMINI_KEY;
  vllmModels = [{ id: MODEL.vllm }];
  geminiCatalog = [MODEL.gemini];
  geminiChatReply = null;
});

const paths = (f: Fake) => f.seen.map((s) => `${s.method} ${s.path}`);

describe('openAiRoot', () => {
  it('puts vLLM under /v1 however the URL is written, and never twice', () => {
    for (const u of spellings('http://gpu:8000')) expect(llm.openAiRoot(u, 'vllm'), u).toBe('http://gpu:8000/v1');
    expect(llm.openAiRoot('http://gpu:8000/v1//', 'vllm')).toBe('http://gpu:8000/v1');
  });

  it('puts LM Studio under /v1 however the URL is written, and never twice', () => {
    for (const u of spellings('http://localhost:1234')) expect(llm.openAiRoot(u, 'lmstudio'), u).toBe('http://localhost:1234/v1');
    expect(llm.openAiRoot('http://localhost:1234/v1//', 'lmstudio')).toBe('http://localhost:1234/v1');
  });

  it('keeps a path prefix in front of vLLM (reverse proxy)', () => {
    expect(llm.openAiRoot('https://box.lan/llm', 'vllm')).toBe('https://box.lan/llm/v1');
    expect(llm.openAiRoot('https://box.lan/llm/v1', 'vllm')).toBe('https://box.lan/llm/v1');
  });

  it('keeps a path prefix in front of LM Studio (reverse proxy)', () => {
    expect(llm.openAiRoot('https://box.lan/lmstudio', 'lmstudio')).toBe('https://box.lan/lmstudio/v1');
    expect(llm.openAiRoot('https://box.lan/lmstudio/v1', 'lmstudio')).toBe('https://box.lan/lmstudio/v1');
  });

  it('leaves the DeepSeek root as typed', () => {
    expect(llm.openAiRoot('https://api.deepseek.com', 'deepseek')).toBe('https://api.deepseek.com');
    expect(llm.openAiRoot('https://api.deepseek.com/', 'deepseek')).toBe('https://api.deepseek.com');
    expect(llm.openAiRoot('https://api.deepseek.com/v1', 'deepseek')).toBe('https://api.deepseek.com/v1');
  });

  it('leaves the Gemini root as typed', () => {
    expect(llm.openAiRoot('https://generativelanguage.googleapis.com/v1beta/openai', 'gemini')).toBe('https://generativelanguage.googleapis.com/v1beta/openai');
    expect(llm.openAiRoot('https://generativelanguage.googleapis.com/v1beta/openai/', 'gemini')).toBe('https://generativelanguage.googleapis.com/v1beta/openai');
  });
});

describe('vLLM', () => {
  for (const spell of ['', '/', '/v1', '/v1/']) {
    describe(`URL written as <server>${spell}`, () => {
      const url = () => fakes.vllm.url + spell;

      it('lists models from /v1/models', async () => {
        const r = await llm.testConnection(url(), 'vllm');
        expect(r).toEqual({ ok: true, models: [{ name: MODEL.vllm, size: 0 }] });
        expect(paths(fakes.vllm)).toEqual(['GET /v1/models']);
      });

      it('tests a model on /v1/chat/completions, thinking off, no auth header', async () => {
        const r = await llm.testModel(url(), MODEL.vllm, 5000, 'vllm');
        expect(r.ok).toBe(true);
        expect(r.sample).toBe('OK');
        expect(paths(fakes.vllm)).toEqual(['POST /v1/chat/completions']);
        const req = fakes.vllm.seen[0]!;
        expect(req.auth).toBeUndefined();
        expect(req.body?.model).toBe(MODEL.vllm);
        expect(req.body?.chat_template_kwargs).toEqual({ enable_thinking: false });
      });

      it('streams the coach from /v1/chat/completions', async () => {
        useProvider('vllm', url());
        let text = '';
        await llm.chatStream([{ role: 'user', content: 'hi' }], (t) => { text += t; });
        expect(text).toBe('Develop your knight.');
        expect(paths(fakes.vllm).filter((p) => p.startsWith('POST'))).toEqual(['POST /v1/chat/completions']);
        expect(fakes.vllm.seen.find((s) => s.method === 'POST')!.body?.stream).toBe(true);
      });

      it('writes JSON reviews through /v1/chat/completions', async () => {
        useProvider('vllm', url());
        const out = await llm.chatJson<{ summary: string }>([{ role: 'user', content: 'review' }]);
        expect(out).toEqual({ summary: 'ok' });
        const post = fakes.vllm.seen.find((s) => s.method === 'POST')!;
        expect(post.path).toBe('/v1/chat/completions');
        expect(post.body?.response_format).toEqual({ type: 'json_object' });
      });
    });
  }

  it('keeps models/ prefix when vLLM serves a model started under that path', async () => {
    vllmModels = [{ id: 'models/foo' }];
    const r = await llm.testConnection(fakes.vllm.url, 'vllm');
    expect(r).toEqual({ ok: true, models: [{ name: 'models/foo', size: 0 }] });

    useProvider('vllm', fakes.vllm.url);
    setSetting('vllm_model', 'models/foo');
    expect(await llm.ensureModel('models/foo')).toBe(true);

    const testRes = await llm.testModel(fakes.vllm.url, 'models/foo', 5000, 'vllm');
    expect(testRes.ok).toBe(true);
    const postReq = fakes.vllm.seen.find((s) => s.method === 'POST')!;
    expect(postReq.body?.model).toBe('models/foo');

    let text = '';
    await llm.chatStream([{ role: 'user', content: 'hi' }], (t) => { text += t; });
    expect(text).toBe('Develop your knight.');
    const streamReq = fakes.vllm.seen.filter((s) => s.method === 'POST')[1]!;
    expect(streamReq.body?.model).toBe('models/foo');
  });

  it('reports a wrong server instead of pretending', async () => {
    const r = await llm.testConnection(fakes.ollama.url, 'vllm');
    expect(r).toEqual({ ok: false, error: 'HTTP 404' });
  });
});

describe('LM Studio', () => {
  for (const spell of ['', '/', '/v1', '/v1/']) {
    describe(`URL written as <server>${spell}`, () => {
      const url = () => fakes.lmstudio.url + spell;

      it('lists models from /v1/models', async () => {
        const r = await llm.testConnection(url(), 'lmstudio');
        expect(r).toEqual({ ok: true, models: [{ name: MODEL.lmstudio, size: 0 }] });
        expect(paths(fakes.lmstudio)).toEqual(['GET /v1/models']);
      });

      it('tests a model on /v1/chat/completions without vLLM-only fields or auth header', async () => {
        const r = await llm.testModel(url(), MODEL.lmstudio, 5000, 'lmstudio');
        expect(r.ok).toBe(true);
        expect(r.sample).toBe('OK');
        expect(paths(fakes.lmstudio)).toEqual(['POST /v1/chat/completions']);
        const req = fakes.lmstudio.seen[0]!;
        expect(req.auth).toBeUndefined();
        expect(req.body?.model).toBe(MODEL.lmstudio);
        expect(req.body?.chat_template_kwargs).toBeUndefined();
      });

      it('streams the coach from /v1/chat/completions', async () => {
        useProvider('lmstudio', url());
        let text = '';
        await llm.chatStream([{ role: 'user', content: 'hi' }], (t) => { text += t; });
        expect(text).toBe('Develop your knight.');
        expect(paths(fakes.lmstudio).filter((p) => p.startsWith('POST'))).toEqual(['POST /v1/chat/completions']);
        expect(fakes.lmstudio.seen.find((s) => s.method === 'POST')!.body?.stream).toBe(true);
      });

      it('writes JSON reviews through /v1/chat/completions', async () => {
        useProvider('lmstudio', url());
        const out = await llm.chatJson<{ summary: string }>([{ role: 'user', content: 'review' }]);
        expect(out).toEqual({ summary: 'ok' });
        const post = fakes.lmstudio.seen.find((s) => s.method === 'POST')!;
        expect(post.path).toBe('/v1/chat/completions');
        expect(post.body?.response_format).toEqual({ type: 'json_object' });
      });
    });
  }

  it('reports a wrong server instead of pretending', async () => {
    const r = await llm.testConnection(fakes.ollama.url, 'lmstudio');
    expect(r).toEqual({ ok: false, error: 'HTTP 404' });
  });

  it('is not configured without a URL', () => {
    useProvider('lmstudio', '');
    expect(llm.llmConfigured()).toBe(false);
  });
});

describe('DeepSeek', () => {
  it('lists models from /models with the Bearer key', async () => {
    const r = await llm.testConnection(fakes.deepseek.url, 'deepseek');
    expect(r).toEqual({ ok: true, models: [{ name: MODEL.deepseek, size: 0 }] });
    expect(paths(fakes.deepseek)).toEqual(['GET /models']);
    expect(fakes.deepseek.seen[0]!.auth).toBe(`Bearer ${DEEPSEEK_KEY}`);
  });

  it('refuses to test without a key, and never calls out', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    setSetting('deepseek_api_key', '');
    const r = await llm.testConnection(fakes.deepseek.url, 'deepseek');
    expect(r).toEqual({ ok: false, error: 'deepseek_api_key_missing' });
    expect(fakes.deepseek.seen).toHaveLength(0);
  });

  it('falls back to the key saved in settings when the env var is unset', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    setSetting('deepseek_api_key', DEEPSEEK_KEY);
    const r = await llm.testConnection(fakes.deepseek.url, 'deepseek');
    expect(r.ok).toBe(true);
    setSetting('deepseek_api_key', '');
  });

  it('tests a model on /chat/completions without vLLM-only fields', async () => {
    const r = await llm.testModel(`${fakes.deepseek.url}/`, MODEL.deepseek, 5000, 'deepseek');
    expect(r).toMatchObject({ ok: true, sample: 'OK' });
    const req = fakes.deepseek.seen[0]!;
    expect(`${req.method} ${req.path}`).toBe('POST /chat/completions');
    expect(req.auth).toBe(`Bearer ${DEEPSEEK_KEY}`);
    expect(req.body).not.toHaveProperty('chat_template_kwargs');
  });

  it('streams the coach and writes JSON reviews', async () => {
    useProvider('deepseek', fakes.deepseek.url);
    let text = '';
    await llm.chatStream([{ role: 'user', content: 'hi' }], (t) => { text += t; });
    expect(text).toBe('Develop your knight.');
    expect(await llm.chatJson([{ role: 'user', content: 'review' }])).toEqual({ summary: 'ok' });
    expect(paths(fakes.deepseek).filter((p) => p.startsWith('POST'))).toEqual(['POST /chat/completions', 'POST /chat/completions']);
  });

  it('counts as configured only with a key', () => {
    useProvider('deepseek', '');
    expect(llm.llmConfigured()).toBe(true);
    expect(llm.llmUrl()).toBe('https://api.deepseek.com');
    delete process.env.DEEPSEEK_API_KEY;
    expect(llm.llmConfigured()).toBe(false);
  });
});

describe('Gemini', () => {
  it('lists models from /models with the Bearer key and strips models/ prefix', async () => {
    const r = await llm.testConnection(fakes.gemini.url, 'gemini');
    expect(r).toEqual({ ok: true, models: [{ name: MODEL.gemini, size: 0 }] });
    expect(paths(fakes.gemini)).toEqual(['GET /models']);
    expect(fakes.gemini.seen[0]!.auth).toBe(`Bearer ${GEMINI_KEY}`);
  });

  it('refuses to test without a key, and never calls out', async () => {
    delete process.env.GEMINI_API_KEY;
    setSetting('gemini_api_key', '');
    const r = await llm.testConnection(fakes.gemini.url, 'gemini');
    expect(r).toEqual({ ok: false, error: 'gemini_api_key_missing' });
    expect(fakes.gemini.seen).toHaveLength(0);
  });

  it('accepts an explicit apiKey parameter when no env var or setting is set', async () => {
    delete process.env.GEMINI_API_KEY;
    setSetting('gemini_api_key', '');
    const r = await llm.testConnection(fakes.gemini.url, 'gemini', GEMINI_KEY);
    expect(r.ok).toBe(true);
  });

  it('falls back to the key saved in settings when the env var is unset', async () => {
    delete process.env.GEMINI_API_KEY;
    setSetting('gemini_api_key', GEMINI_KEY);
    const r = await llm.testConnection(fakes.gemini.url, 'gemini');
    expect(r.ok).toBe(true);
    setSetting('gemini_api_key', '');
  });

  it('tests a model on /chat/completions with reasoning_effort none and without vLLM-only fields', async () => {
    const r = await llm.testModel(`${fakes.gemini.url}/`, MODEL.gemini, 5000, 'gemini');
    expect(r).toMatchObject({ ok: true, sample: 'OK' });
    const req = fakes.gemini.seen[0]!;
    expect(`${req.method} ${req.path}`).toBe('POST /chat/completions');
    expect(req.auth).toBe(`Bearer ${GEMINI_KEY}`);
    expect(req.body).not.toHaveProperty('chat_template_kwargs');
    expect(req.body).toMatchObject({ reasoning_effort: 'none' });
  });

  it('streams the coach and writes JSON reviews with reasoning_effort none', async () => {
    useProvider('gemini', fakes.gemini.url);
    const order: number[] = [];
    let text = '';
    await llm.chatStream([{ role: 'user', content: 'hi' }], async (t) => {
      order.push(1);
      await new Promise((resolve) => setTimeout(resolve, 5));
      text += t;
      order.push(2);
    });
    expect(text).toBe('Develop your knight.');
    expect(order).toEqual([1, 2, 1, 2, 1, 2]);
    const postReqs = fakes.gemini.seen.filter((s) => s.method === 'POST');
    expect(postReqs[0]?.body).toMatchObject({ reasoning_effort: 'none' });
    expect(await llm.chatJson([{ role: 'user', content: 'review' }])).toEqual({ summary: 'ok' });
    const postReqsAfter = fakes.gemini.seen.filter((s) => s.method === 'POST');
    expect(postReqsAfter[1]?.body).toMatchObject({ reasoning_effort: 'none' });
    expect(paths(fakes.gemini).filter((p) => p.startsWith('POST'))).toEqual(['POST /chat/completions', 'POST /chat/completions']);
  });

  it('respects custom reasoning_effort from setting or environment variable', async () => {
    setSetting('gemini_reasoning_effort', 'low');
    useProvider('gemini', fakes.gemini.url);
    await llm.chatStream([{ role: 'user', content: 'hi' }], () => {});
    const postReq = fakes.gemini.seen.find((s) => s.method === 'POST');
    expect(postReq?.body).toMatchObject({ reasoning_effort: 'low' });
    setSetting('gemini_reasoning_effort', '');
  });

  it('allows explicit reasoningEffort in testModel', async () => {
    await llm.testModel(`${fakes.gemini.url}/`, MODEL.gemini, 5000, 'gemini', GEMINI_KEY, 'high');
    const req = fakes.gemini.seen[0]!;
    expect(req.body).toMatchObject({ reasoning_effort: 'high' });
  });

  it('maps reasoning_effort none to low for always-thinking models like gemini-3.8-flash', async () => {
    expect(llm.isAlwaysThinkingModel('gemini-3.8-flash')).toBe(true);
    expect(llm.isAlwaysThinkingModel('gemini-3.5-flash')).toBe(true);
    expect(llm.isAlwaysThinkingModel('gemini-4-hydrogen')).toBe(true);
    expect(llm.isAlwaysThinkingModel('gemini-2.5-pro')).toBe(true);
    expect(llm.isAlwaysThinkingModel('gemini-flash-lite-latest')).toBe(true);
    expect(llm.isAlwaysThinkingModel('gemini-flash-latest')).toBe(true);
    expect(llm.isAlwaysThinkingModel('gemini-pro-latest')).toBe(true);
    expect(llm.isAlwaysThinkingModel('gemini-omni-1.2-flash')).toBe(true);
    expect(llm.isAlwaysThinkingModel('gemini-2.5-flash')).toBe(false);
    expect(llm.isAlwaysThinkingModel('gemini-2.0-flash')).toBe(false);

    expect(llm.geminiThinkingParams('none', 'gemini-3.8-flash')).toEqual({ reasoning_effort: 'low' });
    expect(llm.geminiThinkingParams('none', 'gemini-flash-lite-latest')).toEqual({ reasoning_effort: 'low' });
    expect(llm.geminiMaxTokens(220, 'none', 'gemini-flash-lite-latest')).toBe(1244);
    expect(llm.geminiThinkingParams('none', 'gemini-2.5-flash')).toEqual({ reasoning_effort: 'none' });
    expect(llm.geminiThinkingParams('high', 'gemini-3.8-flash')).toEqual({ reasoning_effort: 'high' });

    await llm.testModel(`${fakes.gemini.url}/`, 'gemini-3.8-flash', 5000, 'gemini', GEMINI_KEY, 'none');
    const req = fakes.gemini.seen[0]!;
    expect(req.body).toMatchObject({ model: 'gemini-3.8-flash', reasoning_effort: 'low' });
  });

  it('filters non-chat models like embeddings, imagen, veo, tts and transcribe', () => {
    expect(llm.isGeminiChatModel('gemini-3.8-flash')).toBe(true);
    expect(llm.isGeminiChatModel('gemini-2.5-flash')).toBe(true);
    expect(llm.isGeminiChatModel('gemini-2.0-flash')).toBe(true);
    expect(llm.isGeminiChatModel('gemini-4-argon')).toBe(true);
    expect(llm.isGeminiChatModel('gemma-2-9b-it')).toBe(true);

    expect(llm.isGeminiChatModel('text-embedding-004')).toBe(false);
    expect(llm.isGeminiChatModel('gemini-embedding-001')).toBe(false);
    expect(llm.isGeminiChatModel('imagen-3.0-generate-002')).toBe(false);
    expect(llm.isGeminiChatModel('gemini-3.1-flash-image')).toBe(false);
    expect(llm.isGeminiChatModel('veo-2.0-generate-001')).toBe(false);
    expect(llm.isGeminiChatModel('gemini-3.8-flash-tts')).toBe(false);
    expect(llm.isGeminiChatModel('gemini-3.5-transcribe')).toBe(false);
    expect(llm.isGeminiChatModel('gemini-pro-vision')).toBe(false);
    expect(llm.isGeminiChatModel('gemini-3.8-live')).toBe(false);
    expect(llm.isGeminiChatModel('antigravity-preview-latest')).toBe(false);
    expect(llm.isGeminiChatModel('deep-research-preview-04-2026')).toBe(false);
    expect(llm.isGeminiChatModel('genie-4')).toBe(false);
    expect(llm.isGeminiChatModel('gemini-decision-1')).toBe(false);
  });

  it('parses error messages from both object and array API responses', () => {
    expect(llm.parseApiError({ error: { message: 'Quota exceeded' } })).toBe('Quota exceeded');
    expect(llm.parseApiError([{ error: { message: 'High demand' } }])).toBe('High demand');
    expect(llm.parseApiError(null)).toBeNull();
    expect(llm.parseApiError({})).toBeNull();
  });

  it('defaults to the newest stable Flash model', () => {
    useProvider('gemini', fakes.gemini.url);
    setSetting('gemini_model', '');
    // gemini-3.5-flash is deprecated and routed to 3.6, so it is not the one to
    // fall back to; this default is what a fresh setup actually calls.
    expect(llm.llmModel()).toBe('gemini-3.8-flash');
    setSetting('gemini_model', MODEL.gemini);
  });

  it('keeps the whole budget for the answer when thinking is off', async () => {
    useProvider('gemini', fakes.gemini.url);
    await llm.chatStream([{ role: 'user', content: 'hi' }], () => {});
    expect(fakes.gemini.seen.find((r) => r.method === 'POST')?.body)
      .toMatchObject({ reasoning_effort: 'none', max_tokens: 220 });
  });

  it('widens the budget for a model that cannot turn thinking off', async () => {
    // Thinking tokens come out of max_tokens, so asking for 'low' on a 220-token
    // budget would spend it before the model said anything.
    expect(llm.geminiMaxTokens(220, 'none', 'gemini-2.5-flash')).toBe(220);
    expect(llm.geminiMaxTokens(220, 'none', 'gemini-3.8-flash')).toBe(1244);
    expect(llm.geminiMaxTokens(220, 'high', 'gemini-2.5-flash')).toBe(1244);
    expect(llm.geminiMaxTokens(1500, 'medium', 'gemini-2.5-flash')).toBe(2524);

    geminiCatalog = [MODEL.gemini, 'gemini-3.8-flash'];
    useProvider('gemini', fakes.gemini.url);
    setSetting('gemini_model', 'gemini-3.8-flash');
    await llm.chatStream([{ role: 'user', content: 'hi' }], () => {});
    expect(fakes.gemini.seen.find((r) => r.method === 'POST')?.body)
      .toMatchObject({ model: 'gemini-3.8-flash', reasoning_effort: 'low', max_tokens: 1244 });
    setSetting('gemini_model', MODEL.gemini);
  });

  it('drops reasoning_effort when the model refuses the field, and remembers it', async () => {
    geminiCatalog = [MODEL.gemini, 'gemini-2.5-flash-norsn'];
    useProvider('gemini', fakes.gemini.url);
    setSetting('gemini_model', 'gemini-2.5-flash-norsn');
    geminiChatReply = (body) => (body && 'reasoning_effort' in body)
      // Google answers this one as an array-wrapped error.
      ? { status: 400, payload: [{ error: { message: 'Reasoning effort is not supported for this model' } }] }
      : null;
    let text = '';
    await llm.chatStream([{ role: 'user', content: 'hi' }], (t) => { text += t; });
    expect(text).toBe('Develop your knight.');
    const posts = fakes.gemini.seen.filter((r) => r.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[1]!.body).not.toHaveProperty('reasoning_effort');
    expect(posts[1]!.body?.max_tokens).toBe(1244);

    // A second call pays for one request, not two, and keeps the reserve.
    fakes.gemini.seen.length = 0;
    await llm.chatStream([{ role: 'user', content: 'hi' }], () => {});
    const again = fakes.gemini.seen.filter((r) => r.method === 'POST');
    expect(again).toHaveLength(1);
    expect(again[0]!.body).not.toHaveProperty('reasoning_effort');
    expect(again[0]!.body?.max_tokens).toBe(1244);
    setSetting('gemini_model', MODEL.gemini);
  });

  it('drops reasoning_effort when Google rejects it with "Request contains an invalid argument."', async () => {
    geminiCatalog = [MODEL.gemini, 'gemini-2.5-flash-invalidarg'];
    useProvider('gemini', fakes.gemini.url);
    setSetting('gemini_model', 'gemini-2.5-flash-invalidarg');
    geminiChatReply = (body) => (body && 'reasoning_effort' in body)
      ? { status: 400, payload: [{ error: { message: 'Request contains an invalid argument.' } }] }
      : null;
    let text = '';
    await llm.chatStream([{ role: 'user', content: 'hi' }], (t) => { text += t; });
    expect(text).toBe('Develop your knight.');
    const posts = fakes.gemini.seen.filter((r) => r.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[1]!.body).not.toHaveProperty('reasoning_effort');
    setSetting('gemini_model', MODEL.gemini);
  });

  it('does not retry a 400 that has nothing to do with reasoning', async () => {
    useProvider('gemini', fakes.gemini.url);
    geminiChatReply = () => ({ status: 400, payload: { error: { message: 'Unknown name "foo"' } } });
    await expect(llm.chatStream([{ role: 'user', content: 'hi' }], () => {}))
      .rejects.toThrow('llm_Unknown name "foo"');
    expect(fakes.gemini.seen.filter((r) => r.method === 'POST')).toHaveLength(1);
  });

  it('reports the second failure when dropping reasoning_effort does not help', async () => {
    geminiCatalog = [MODEL.gemini, 'gemini-2.5-flash-grumpy'];
    useProvider('gemini', fakes.gemini.url);
    setSetting('gemini_model', 'gemini-2.5-flash-grumpy');
    geminiChatReply = (body) => (body && 'reasoning_effort' in body)
      ? { status: 400, payload: { error: { message: 'thinking cannot be configured here' } } }
      : { status: 429, payload: { error: { message: 'Quota exceeded' } } };
    // The first message only said the field was unwelcome; the quota is the news.
    await expect(llm.chatStream([{ role: 'user', content: 'hi' }], () => {}))
      .rejects.toThrow('llm_Quota exceeded');
    setSetting('gemini_model', MODEL.gemini);
  });

  it('fails loudly on an error reply that carries no message', async () => {
    expect(llm.parseApiError({ error: 'rate limited' })).toBe('rate limited');
    expect(llm.parseApiError({ error: { code: 429 } })).toBe('429');
    expect(llm.parseApiError({ error: { status: 'RESOURCE_EXHAUSTED' } })).toBe('RESOURCE_EXHAUSTED');
    expect(llm.parseApiError({ error: {} })).toBe('error');
    expect(llm.parseApiError({ choices: [] })).toBeNull();

    // Read as a successful empty answer, this used to become llm_bad_json — and
    // chatJsonRetry then re-sent the whole review prompt.
    useProvider('gemini', fakes.gemini.url);
    geminiChatReply = () => ({ status: 200, payload: { error: 'overloaded' } });
    await expect(llm.chatJson([{ role: 'user', content: 'review' }])).rejects.toThrow('llm_overloaded');
  });

  it('falls back to none for an unknown GEMINI_REASONING_EFFORT level', () => {
    process.env.GEMINI_REASONING_EFFORT = 'invalid_typo';
    expect(llm.geminiReasoningEffort()).toBe('none');
    delete process.env.GEMINI_REASONING_EFFORT;
  });

  it('counts as configured only with a key', () => {
    useProvider('gemini', '');
    expect(llm.llmConfigured()).toBe(true);
    expect(llm.llmUrl()).toBe('https://generativelanguage.googleapis.com/v1beta/openai');
    delete process.env.GEMINI_API_KEY;
    expect(llm.llmConfigured()).toBe(false);
  });
});

// The coach writes each chunk to the browser as it arrives (an SSE write, which
// can fail). Swallowing that rejection as a "malformed line" left the model
// generating — and billing — for a client that had already gone away.
describe('a failing onChunk', () => {
  it('stops the stream instead of being read as a bad line', async () => {
    useProvider('gemini', fakes.gemini.url);
    await expect(llm.chatStream([{ role: 'user', content: 'hi' }], () => { throw new Error('client gone'); }))
      .rejects.toThrow('client gone');

    useProvider('ollama', fakes.ollama.url);
    await expect(llm.chatStream([{ role: 'user', content: 'hi' }], async () => { throw new Error('client gone'); }))
      .rejects.toThrow('client gone');
  });

  it('still skips a line that is not JSON', async () => {
    useProvider('ollama', fakes.ollama.url);
    let text = '';
    await llm.chatStream([{ role: 'user', content: 'hi' }], (t) => { text += t; });
    expect(text).toBe('Develop your knight.');
  });
});

describe('Ollama', () => {
  for (const spell of ['', '/']) {
    it(`lists, tests, streams and reviews on its native routes (<server>${spell})`, async () => {
      const url = fakes.ollama.url + spell;
      expect(await llm.testConnection(url, 'ollama')).toEqual({ ok: true, models: [{ name: MODEL.ollama, size: 1 }] });
      expect(await llm.testModel(url, MODEL.ollama, 5000, 'ollama')).toMatchObject({ ok: true, sample: 'OK' });
      useProvider('ollama', url);
      let text = '';
      await llm.chatStream([{ role: 'user', content: 'hi' }], (t) => { text += t; });
      expect(text).toBe('Develop your knight.');
      expect(await llm.chatJson([{ role: 'user', content: 'review' }])).toEqual({ summary: 'ok' });
      expect(new Set(paths(fakes.ollama))).toEqual(new Set(['GET /api/tags', 'POST /api/chat']));
      expect(fakes.ollama.seen.every((s) => s.auth === undefined)).toBe(true);
    });
  }

  it('is not configured without a URL', () => {
    useProvider('ollama', '');
    expect(llm.llmConfigured()).toBe(false);
  });
});

describe('switching providers keeps each one\'s settings', () => {
  it('reads the URL and model of the selected provider only', () => {
    setSetting('ollama_url', fakes.ollama.url);
    setSetting('vllm_url', `${fakes.vllm.url}/`);
    setSetting('lmstudio_url', `${fakes.lmstudio.url}/`);
    setSetting('gemini_url', `${fakes.gemini.url}/`);
    setSetting('ollama_model', MODEL.ollama);
    setSetting('vllm_model', MODEL.vllm);
    setSetting('lmstudio_model', MODEL.lmstudio);
    setSetting('gemini_model', MODEL.gemini);
    setSetting('llm_provider', 'vllm');
    expect([llm.llmUrl(), llm.llmModel()]).toEqual([fakes.vllm.url, MODEL.vllm]);
    setSetting('llm_provider', 'lmstudio');
    expect([llm.llmUrl(), llm.llmModel()]).toEqual([fakes.lmstudio.url, MODEL.lmstudio]);
    setSetting('llm_provider', 'gemini');
    expect([llm.llmUrl(), llm.llmModel()]).toEqual([fakes.gemini.url, MODEL.gemini]);
    setSetting('llm_provider', 'ollama');
    expect([llm.llmUrl(), llm.llmModel()]).toEqual([fakes.ollama.url, MODEL.ollama]);
  });
});

// The buttons in Admin → System, through the real admin router.
describe('Admin → System test buttons', () => {
  async function post(path: string, body: unknown) {
    const res = await admin.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  }

  for (const spell of ['', '/v1']) {
    it(`"Test" and "Test ALL models" work for vLLM (<server>${spell})`, async () => {
      const url = fakes.vllm.url + spell;
      const t = await post('/test/ollama', { url, provider: 'vllm' });
      expect(t.body).toMatchObject({ ok: true, models: [{ name: MODEL.vllm }] });
      const all = await post('/test/ollama-models', { url, provider: 'vllm' });
      expect(all.body).toMatchObject({ ok: true, results: [{ model: MODEL.vllm, ok: true, sample: 'OK' }] });
      expect(paths(fakes.vllm)).toEqual(['GET /v1/models', 'GET /v1/models', 'POST /v1/chat/completions']);
    });

    it(`"Test" and "Test ALL models" work for LM Studio (<server>${spell})`, async () => {
      const url = fakes.lmstudio.url + spell;
      const t = await post('/test/ollama', { url, provider: 'lmstudio' });
      expect(t.body).toMatchObject({ ok: true, models: [{ name: MODEL.lmstudio }] });
      const all = await post('/test/ollama-models', { url, provider: 'lmstudio' });
      expect(all.body).toMatchObject({ ok: true, results: [{ model: MODEL.lmstudio, ok: true, sample: 'OK' }] });
      expect(paths(fakes.lmstudio)).toEqual(['GET /v1/models', 'GET /v1/models', 'POST /v1/chat/completions']);
    });
  }

  it('"Test ALL models" works for Ollama, DeepSeek and Gemini', async () => {
    const o = await post('/test/ollama-models', { url: fakes.ollama.url, provider: 'ollama' });
    expect(o.body).toMatchObject({ ok: true, results: [{ model: MODEL.ollama, ok: true }] });
    const d = await post('/test/ollama-models', { url: fakes.deepseek.url, provider: 'deepseek' });
    expect(d.body).toMatchObject({ ok: true, results: [{ model: MODEL.deepseek, ok: true }] });
    const g = await post('/test/ollama-models', { url: fakes.gemini.url, provider: 'gemini' });
    expect(g.body).toMatchObject({ ok: true, results: [{ model: MODEL.gemini, ok: true }] });
  });

  it('"Test ALL models" tests every chat model the host serves', async () => {
    // It says ALL, so it tests all of them — the UI warns about the cost of a
    // hosted catalogue before asking for this.
    geminiCatalog = ['gemini-2.5-flash', 'gemini-3.8-flash', 'gemini-3.6-flash',
      'gemini-2.0-flash', 'gemma-3-27b-it', 'gemini-3.7-flash', 'text-embedding-004'];
    const r = await post('/test/ollama-models', { url: fakes.gemini.url, provider: 'gemini' });
    const body = r.body as { ok: boolean; results: { model: string; ok: boolean }[] };
    expect(body.ok).toBe(true);
    // Every one but the embedding model, which is not a chat model.
    expect(body.results.map((x) => x.model)).toEqual(geminiCatalog.slice(0, 6));
    expect(body.results.every((x) => x.ok)).toBe(true);
  });

  it('rejects a reasoning_effort that is not one of the four levels', async () => {
    const r = await post('/test/ollama-models', { url: fakes.gemini.url, provider: 'gemini', reasoning_effort: 'turbo' });
    expect(r.body).toMatchObject({ ok: true });
    // Dropped rather than passed on for Google to 400 on.
    expect(fakes.gemini.seen.find((x) => x.method === 'POST')?.body).toMatchObject({ reasoning_effort: 'none' });
  });

  it('falls back to none when GEMINI_REASONING_EFFORT env var or argument is invalid', () => {
    process.env.GEMINI_REASONING_EFFORT = 'turbo';
    expect(llm.geminiReasoningEffort()).toBe('none');
    expect(llm.geminiEffectiveEffort('invalid_level')).toBe('none');
    expect(llm.geminiEffectiveEffort('invalid_level', 'gemini-3.8-flash')).toBe('low');
    delete process.env.GEMINI_REASONING_EFFORT;
  });

  it('does not store gemini_reasoning_effort while the env var supplies it', async () => {
    setSetting('gemini_reasoning_effort', '');
    process.env.GEMINI_REASONING_EFFORT = 'high';
    const patchRes = await admin.request('/system', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ gemini_reasoning_effort: 'medium' }),
    });
    expect(patchRes.status).toBe(200);
    expect(await (await admin.request('/system', { headers: { Cookie: adminCookie } })).json())
      .toMatchObject({ gemini_reasoning_effort: 'high', gemini_reasoning_effort_env_override: true });
    // The read-only field's value must not have been written behind it.
    delete process.env.GEMINI_REASONING_EFFORT;
    expect(await (await admin.request('/system', { headers: { Cookie: adminCookie } })).json())
      .toMatchObject({ gemini_reasoning_effort: 'none' });
  });

  it('supports passing api_key in request body without saving first', async () => {
    delete process.env.GEMINI_API_KEY;
    setSetting('gemini_api_key', '');
    const missing = await post('/test/ollama', { url: fakes.gemini.url, provider: 'gemini' });
    expect(missing.body).toMatchObject({ ok: false, error: 'gemini_api_key_missing' });

    const withKey = await post('/test/ollama', { url: fakes.gemini.url, provider: 'gemini', api_key: GEMINI_KEY });
    expect(withKey.body).toMatchObject({ ok: true, models: [{ name: MODEL.gemini }] });

    const allWithKey = await post('/test/ollama-models', { url: fakes.gemini.url, provider: 'gemini', api_key: GEMINI_KEY });
    expect(allWithKey.body).toMatchObject({ ok: true, results: [{ model: MODEL.gemini, ok: true }] });
  });

  it('saves and returns gemini_reasoning_effort via admin settings', async () => {
    const patchRes = await admin.request('/system', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ gemini_reasoning_effort: 'medium' }),
    });
    expect(patchRes.status).toBe(200);
    const getRes = await admin.request('/system', { headers: { Cookie: adminCookie } });
    expect(await getRes.json()).toMatchObject({ gemini_reasoning_effort: 'medium' });
    await admin.request('/system', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ gemini_reasoning_effort: 'none' }),
    });
  });
});
