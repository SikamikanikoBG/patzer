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

type LlmModule = typeof import('../src/coach/llm.js');
type Router = { request: (path: string, init?: RequestInit) => Response | Promise<Response> };

interface Seen { method: string; path: string; auth?: string; body?: Record<string, unknown> }

interface Fake { url: string; seen: Seen[]; server: Server }

const MODEL = { ollama: 'gemma3:1b', vllm: 'Qwen3-8B', deepseek: 'deepseek-chat', lmstudio: 'qwen2.5-7b-instruct' } as const;

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
    for (const part of ['Develop ', 'your ', 'knight.']) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`);
    }
    res.end('data: [DONE]\n\n');
    return;
  }
  json(res, 200, { choices: [{ message: { content: jsonMode ? '{"summary":"ok"}' : 'OK' } }] });
}

async function startFake(kind: 'ollama' | 'vllm' | 'deepseek' | 'lmstudio'): Promise<Fake> {
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
          for (const part of ['Develop ', 'your ', 'knight.']) res.write(JSON.stringify({ message: { content: part }, done: false }) + '\n');
          res.end(JSON.stringify({ message: { content: '' }, done: true }) + '\n');
          return;
        }
        return json(res, 200, { message: { content: body?.format === 'json' ? '{"summary":"ok"}' : 'OK' } });
      }
    }

    if (kind === 'vllm') {
      if (req.method === 'GET' && path === '/v1/models') return json(res, 200, { object: 'list', data: [{ id: MODEL.vllm }] });
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
const fakes = {} as Record<'ollama' | 'vllm' | 'deepseek' | 'lmstudio', Fake>;

// Every spelling of the same server a user might paste into Admin → System.
function spellings(base: string): string[] {
  return [base, `${base}/`, `${base}/v1`, `${base}/v1/`];
}

function useProvider(p: 'ollama' | 'vllm' | 'deepseek' | 'lmstudio', url: string): void {
  setSetting('llm_provider', p);
  setSetting(`${p}_url`, url);
  setSetting(`${p}_model`, MODEL[p]);
}

beforeAll(async () => {
  fakes.ollama = await startFake('ollama');
  fakes.vllm = await startFake('vllm');
  fakes.lmstudio = await startFake('lmstudio');
  fakes.deepseek = await startFake('deepseek');
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
    setSetting('ollama_model', MODEL.ollama);
    setSetting('vllm_model', MODEL.vllm);
    setSetting('lmstudio_model', MODEL.lmstudio);
    setSetting('llm_provider', 'vllm');
    expect([llm.llmUrl(), llm.llmModel()]).toEqual([fakes.vllm.url, MODEL.vllm]);
    setSetting('llm_provider', 'lmstudio');
    expect([llm.llmUrl(), llm.llmModel()]).toEqual([fakes.lmstudio.url, MODEL.lmstudio]);
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

  it('"Test ALL models" works for Ollama and DeepSeek', async () => {
    const o = await post('/test/ollama-models', { url: fakes.ollama.url, provider: 'ollama' });
    expect(o.body).toMatchObject({ ok: true, results: [{ model: MODEL.ollama, ok: true }] });
    const d = await post('/test/ollama-models', { url: fakes.deepseek.url, provider: 'deepseek' });
    expect(d.body).toMatchObject({ ok: true, results: [{ model: MODEL.deepseek, ok: true }] });
  });
});
