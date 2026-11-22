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

  it('switches to Google Gemini provider tab with correct placeholders and AI Studio link', async () => {
    renderPage();
    const tab = await screen.findByRole('button', { name: 'Google Gemini' });
    fireEvent.click(tab);
    expect(await screen.findByPlaceholderText('https://generativelanguage.googleapis.com/v1beta/openai')).toBeDefined();
    expect(screen.getByText('Google Gemini-URL (optional)')).toBeDefined();
    expect(screen.getByText('Gemini-Modell')).toBeDefined();
    expect(screen.getByText('Google AI Studio-API-Schlüssel')).toBeDefined();
    const link = screen.getByRole('link', { name: /Google AI Studio/ });
    expect(link.getAttribute('href')).toBe('https://aistudio.google.com/');
  });

  it('passes typed Gemini API key to test connection endpoint', async () => {
    renderPage();
    const tab = await screen.findByRole('button', { name: 'Google Gemini' });
    fireEvent.click(tab);

    const keyInput = await screen.findByPlaceholderText('AIza…');
    fireEvent.change(keyInput, { target: { value: 'AIzaSyTestKey123' } });

    const testButtons = screen.getAllByRole('button', { name: 'Testen' });
    // First test button is next to URL input
    fireEvent.click(testButtons[0]!);

    expect(post).toHaveBeenCalledWith(
      '/api/admin/test/ollama',
      expect.objectContaining({
        provider: 'gemini',
        api_key: 'AIzaSyTestKey123',
      }),
    );
  });

  it('shows localized error message when Gemini API key is missing', async () => {
    post.mockImplementation(async (path: string) => path === '/api/admin/test/ollama'
      ? { ok: false, error: 'gemini_api_key_missing' }
      : { ok: true });

    renderPage();
    const tab = await screen.findByRole('button', { name: 'Google Gemini' });
    fireEvent.click(tab);

    const testButtons = screen.getAllByRole('button', { name: 'Testen' });
    fireEvent.click(testButtons[0]!);

    expect(await screen.findByText('Google Gemini-API-Schlüssel ist erforderlich. Gib deinen Schlüssel ein oder speichere ihn zuerst.')).toBeDefined();
  });

  it('lists Gemini models with no URL typed, and picks one', async () => {
    // Gemini's URL field is normally left blank (meaning Google's endpoint), and
    // gating the auto-load on the raw field left the list — and the model
    // auto-pick — empty until Test was clicked by hand.
    post.mockImplementation(async (path: string) => path === '/api/admin/test/ollama'
      ? { ok: true, models: [{ name: 'gemini-2.0-flash' }, { name: 'gemini-3.8-flash' }] }
      : { ok: true });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Google Gemini' }));
    expect(await screen.findByDisplayValue('gemini-3.8-flash')).toBeDefined();
    expect(post).toHaveBeenCalledWith(
      '/api/admin/test/ollama',
      expect.objectContaining({ provider: 'gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai' }),
    );
  });

  it('falls back to the first model in list if the default model is not present', async () => {
    post.mockImplementation(async (path: string) => path === '/api/admin/test/ollama'
      ? { ok: true, models: [{ name: 'gemini-1.5-flash' }, { name: 'gemini-2.0-flash' }] }
      : { ok: true });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Google Gemini' }));
    expect(await screen.findByDisplayValue('gemini-1.5-flash')).toBeDefined();
  });

  it('lists DeepSeek models with no URL typed, and prefers deepseek-chat', async () => {
    post.mockImplementation(async (path: string) => path === '/api/admin/test/ollama'
      ? { ok: true, models: [{ name: 'deepseek-coder' }, { name: 'deepseek-chat' }, { name: 'deepseek-reasoner' }] }
      : { ok: true });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek' }));
    expect(await screen.findByDisplayValue('deepseek-chat')).toBeDefined();
    expect(post).toHaveBeenCalledWith(
      '/api/admin/test/ollama',
      expect.objectContaining({ provider: 'deepseek', url: 'https://api.deepseek.com' }),
    );
  });

  it('warns what "Test ALL models" will cost on a hosted provider, and obeys the answer', async () => {
    post.mockImplementation(async (path: string) => path === '/api/admin/test/ollama'
      ? { ok: true, models: [{ name: 'gemini-3.8-flash' }, { name: 'gemini-3.6-flash' }] }
      : { ok: true, results: [] });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Google Gemini' }));
    await screen.findByDisplayValue('gemini-3.8-flash');

    const testAll = screen.getByRole('button', { name: 'ALLE Modelle testen' });
    fireEvent.click(testAll);
    // Said no: nothing was called, and the warning names the count and the cost.
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('2 Modelle'));
    expect(confirmSpy.mock.calls[0]![0]).toMatch(/rechnet jeden davon ab/);
    expect(post).not.toHaveBeenCalledWith('/api/admin/test/ollama-models', expect.anything());

    confirmSpy.mockReturnValue(true);
    fireEvent.click(testAll);
    expect(post).toHaveBeenCalledWith('/api/admin/test/ollama-models', expect.objectContaining({ provider: 'gemini' }));
    confirmSpy.mockRestore();
  });

  it('does not warn for a local provider, where the calls are free', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'ALLE Modelle testen' }));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('/api/admin/test/ollama-models', expect.objectContaining({ provider: 'ollama' }));
    confirmSpy.mockRestore();
  });

  it('renders reasoning effort selector with none by default and detailed explanation', async () => {
    renderPage();
    const tab = await screen.findByRole('button', { name: 'Google Gemini' });
    fireEvent.click(tab);

    expect(screen.getByText('Thinking / Reasoning-Aufwand')).toBeDefined();
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('none');
    expect(screen.getByText(/Thinking-Modelle/)).toBeDefined();

    fireEvent.change(select, { target: { value: 'low' } });
    expect(select.value).toBe('low');
  });
});
