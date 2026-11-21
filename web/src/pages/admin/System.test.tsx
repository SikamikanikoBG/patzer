// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, put } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock('../../api', () => ({ api: { get, post, put, patch: put, del: vi.fn() } }));

import i18n from '../../i18n';
import AdminSystem from './System';

beforeAll(async () => { await i18n.changeLanguage('de'); });
beforeEach(() => {
  vi.clearAllMocks();
  get.mockImplementation(async (path: string) => path === '/api/admin/system'
    ? { llm_provider: 'ollama', ollama_url: 'http://192.168.1.126:11434', ollama_model: 'mistral:7b' }
    : {});
  post.mockImplementation(async (path: string) => path === '/api/admin/test/ollama'
    ? { ok: true, models: [{ name: 'gpt-oss:20b' }] }
    : { ok: true });
});
afterEach(cleanup);

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><AdminSystem /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Admin → System → model', () => {
  it('shows a saved model the server does not have, and lets you pick the one it has', async () => {
    // The bug: the select showed gpt-oss:20b while mistral:7b stayed saved, and
    // with one option there was no change event — Save kept the missing model.
    renderPage();
    const select = await screen.findByDisplayValue('mistral:7b (auf diesem Server nicht vorhanden)') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'gpt-oss:20b' } });
    expect(select.value).toBe('gpt-oss:20b');
  });

  it('switches to LM Studio provider tab with correct placeholders', async () => {
    renderPage();
    const tab = await screen.findByRole('button', { name: 'LM Studio' });
    fireEvent.click(tab);
    expect(await screen.findByPlaceholderText('http://localhost:1234')).toBeDefined();
    expect(screen.getByText('LM Studio-URL')).toBeDefined();
    expect(screen.getByText('LM Studio-Modell')).toBeDefined();
  });
});
