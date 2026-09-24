// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post, del } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), del: vi.fn() }));
vi.mock('../../api', () => ({ api: { get, post, del } }));

import i18n from '../../i18n';
import InvitesSection from './Invites';

// Real German strings rather than keys, so a missing or misspelt key shows up
// here as a failed lookup.
beforeAll(async () => { await i18n.changeLanguage('de'); });

const invite = (over: Record<string, unknown>) => ({
  id: 1, code: 'ABCD-EFGH-JKLM', link: 'https://chess.example.org/signup?invite=ABCD-EFGH-JKLM', note: null,
  max_uses: 1, uses: 0, expires_at: '2026-10-02T12:00:00.000Z', language: null, audience: null,
  created_at: '2026-09-25T12:00:00.000Z', revoked_at: null, status: 'active', used_by: [], ...over,
});

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><InvitesSection /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});
// Without vitest globals, testing-library can't register its own cleanup.
afterEach(cleanup);

describe('Admin → Users → Invites', () => {
  it('lists invites with their state, and who used them', async () => {
    get.mockResolvedValue({
      signup_mode: 'invite',
      invites: [
        invite({ id: 2, code: 'KLUB-KLUB-KLUB', note: 'Schachklub', max_uses: 5, uses: 2, used_by: ['anna', 'ben'], language: 'es', audience: 'kid' }),
        invite({ id: 1, status: 'revoked', revoked_at: '2026-09-26T08:00:00.000Z' }),
      ],
    });
    renderSection();

    expect(await screen.findByText('KLUB-KLUB-KLUB')).toBeTruthy();
    expect(screen.getByText('Schachklub')).toBeTruthy();
    expect(screen.getByText('2 von 5 genutzt')).toBeTruthy();
    expect(screen.getByText('Genutzt von @anna, @ben')).toBeTruthy();
    expect(screen.getByText('Español')).toBeTruthy();
    expect(screen.getByText('Kind (7–10)')).toBeTruthy();
    expect(screen.getByText('Aktiv')).toBeTruthy();
    expect(screen.getByText('Zurückgezogen')).toBeTruthy();
    // Only the active one can still be shared or withdrawn; the other can go.
    expect(screen.getAllByRole('button', { name: /Link kopieren/ })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Einladung zurückziehen' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Aus der Liste entfernen' })).toHaveLength(1);
    expect(screen.queryByText(/steht auf „Niemand“/)).toBeNull();
  });

  it('warns when account creation is switched off, so invites do nothing', async () => {
    get.mockResolvedValue({ signup_mode: 'closed', invites: [] });
    renderSection();
    expect(await screen.findByText(/steht auf „Niemand“/)).toBeTruthy();
    expect(screen.getByText('Noch keine Einladungen.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'System' }).getAttribute('href')).toBe('/admin/system');
  });

  it('withdraws an invite only after asking', async () => {
    get.mockResolvedValue({ signup_mode: 'invite', invites: [invite({})] });
    post.mockResolvedValue({ ok: true });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderSection();

    const revoke = await screen.findByRole('button', { name: 'Einladung zurückziehen' });
    fireEvent.click(revoke);
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(revoke);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/admin/invites/1/revoke'));
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('creates an invite with the chosen limits and presets, then shows the link', async () => {
    get.mockResolvedValue({ signup_mode: 'invite', invites: [] });
    post.mockResolvedValue({ invite: invite({ max_uses: null, language: 'de', audience: 'kid' }) });
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: /Neue Einladung/ }));
    fireEvent.change(screen.getByLabelText('Notiz (sehen nur Admins)'), { target: { value: 'Familie' } });
    fireEvent.change(screen.getByLabelText('Konten'), { target: { value: 'unlimited' } });
    fireEvent.change(screen.getByLabelText('Gültig für'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Sprache'), { target: { value: 'de' } });
    fireEvent.change(screen.getByLabelText('Erklär-Niveau'), { target: { value: 'kid' } });
    fireEvent.click(screen.getByRole('button', { name: 'Einladung erstellen' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/admin/invites', {
      note: 'Familie', max_uses: null, expires_in_days: 30, language: 'de', audience: 'kid',
    }));
    const dialog = (await screen.findByText('Einladung erstellt')).closest('.card') as HTMLElement;
    expect((within(dialog).getByLabelText('Link') as HTMLInputElement).value)
      .toBe('https://chess.example.org/signup?invite=ABCD-EFGH-JKLM');
    expect(within(dialog).getByText('ABCD-EFGH-JKLM')).toBeTruthy();
  });

  it('defaults to one account for one week', async () => {
    get.mockResolvedValue({ signup_mode: 'invite', invites: [] });
    post.mockResolvedValue({ invite: invite({}) });
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: /Neue Einladung/ }));
    expect((screen.getByLabelText('Konten') as HTMLSelectElement).selectedOptions[0]!.textContent).toBe('1 Konto');
    expect((screen.getByLabelText('Gültig für') as HTMLSelectElement).selectedOptions[0]!.textContent).toBe('7 Tage');
    fireEvent.click(screen.getByRole('button', { name: 'Einladung erstellen' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/admin/invites', {
      note: '', max_uses: 1, expires_in_days: 7, language: null, audience: null,
    }));
  });
});
