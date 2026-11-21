import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectionHint } from '../src/coach/connectionHint.js';

// The setup routes open the real database on import, so point it at a
// throwaway file first.
const dir = mkdtempSync(join(tmpdir(), 'patzer-hint-'));
process.env.DB_PATH = join(dir, 'hint.db');

type SetupModule = typeof import('../src/routes/setup.js');
let setup: SetupModule;

beforeAll(async () => {
  setup = await import('../src/routes/setup.js');
});

afterAll(async () => {
  const { db } = await import('../src/db.js');
  try { db.close(); } catch { /* ignore */ }
  rmSync(dir, { recursive: true, force: true });
});

describe('connectionHint', () => {
  it('explains localhost inside a container', () => {
    expect(connectionHint('http://localhost:11434', 'fetch failed', true)).toBe('docker_localhost');
    expect(connectionHint('http://127.0.0.1:11434', 'fetch failed', true)).toBe('docker_localhost');
    expect(connectionHint('http://[::1]:11434', 'fetch failed', true)).toBe('docker_localhost');
  });

  it('gives the general hint for other hosts, or outside a container', () => {
    expect(connectionHint('http://192.168.1.20:11434', 'fetch failed', true)).toBe('unreachable');
    expect(connectionHint('http://host.docker.internal:11434', 'fetch failed', true)).toBe('unreachable');
    expect(connectionHint('http://localhost:11434', 'fetch failed', false)).toBe('unreachable');
  });

  it('counts a timeout as no answer', () => {
    expect(connectionHint('http://192.168.1.20:11434', 'The operation was aborted due to timeout', false)).toBe('unreachable');
  });

  it('gives LM Studio-specific hints when provider is lmstudio', () => {
    expect(connectionHint('http://localhost:1234', 'fetch failed', true, 'lmstudio')).toBe('lmstudio_docker_localhost');
    expect(connectionHint('http://127.0.0.1:1234', 'fetch failed', true, 'lmstudio')).toBe('lmstudio_docker_localhost');
    expect(connectionHint('http://192.168.1.20:1234', 'fetch failed', true, 'lmstudio')).toBe('lmstudio_unreachable');
    expect(connectionHint('http://localhost:1234', 'fetch failed', false, 'lmstudio')).toBe('lmstudio_unreachable');
  });

  it('stays quiet when something did answer', () => {
    expect(connectionHint('http://localhost:11434', 'HTTP 404', true)).toBeUndefined();
    expect(connectionHint('http://localhost:11434', 'Unexpected token \'<\', "<!doctype "... is not valid JSON', true)).toBeUndefined();
    expect(connectionHint('https://api.deepseek.com', 'deepseek_api_key_missing', false)).toBeUndefined();
  });
});

describe('setup Ollama URL check', () => {
  it('accepts host.docker.internal, as the README recommends', () => {
    expect(setup.isPrivateOllamaUrl('http://host.docker.internal:11434')).toBe(true);
    expect(setup.isPrivateOllamaUrl('http://192.168.1.20:11434')).toBe(true);
  });

  it('still rejects public and metadata hosts', () => {
    expect(setup.isPrivateOllamaUrl('http://169.254.169.254/')).toBe(false);
    expect(setup.isPrivateOllamaUrl('http://example.com:11434')).toBe(false);
    expect(setup.isPrivateOllamaUrl('http://host.docker.internal.example.com')).toBe(false);
  });

  it('returns a hint when nothing answers', async () => {
    const res = await setup.default.request('/test-ollama', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://127.0.0.1:1' }),
    });
    const body = await res.json() as { ok: boolean; error: string; hint?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('unreachable');
    expect(['docker_localhost', 'unreachable']).toContain(body.hint);
  });
});
