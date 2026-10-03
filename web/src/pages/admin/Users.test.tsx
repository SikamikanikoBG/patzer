// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const { get, post, del } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), del: vi.fn() }));
vi.mock('../../api', () => ({ api: { get, post, del } }));

import i18n from '../../i18n';
import AdminUsers from './Users';

beforeAll(async () => { await i18n.changeLanguage('en'); });
afterEach(cleanup);

const user = (id: number, username: string, over: Record<string, unknown>) => ({
  id, username, role: 'user', created_at: '2026-10-01 10:00:00', display_name: username, avatar_emoji: '♟',
  language: 'en', audience: 'beginner', email: null, email_verified: 1, invite_code: null, invite_note: null,
  created_via: 'password', sso_linked: 0, ...over,
});

describe('Admin → Users: how each account signs in', () => {
  it('marks SSO-created accounts, password accounts, and password accounts linked to SSO', async () => {
    get.mockImplementation((path: string) => Promise.resolve(
      path === '/api/admin/users'
        ? { users: [
            user(1, 'admin', { role: 'admin' }),
            user(2, 'linked', { sso_linked: 1 }),
            user(3, 'sso-kid', { created_via: 'sso', sso_linked: 1 }),
          ] }
        : { signup_mode: 'closed', invites: [] },
    ));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><MemoryRouter><AdminUsers /></MemoryRouter></QueryClientProvider>);

    const row = async (username: string) => within((await screen.findByText(`@${username}`)).closest('tr')!);
    expect(screen.getByRole('columnheader', { name: 'Sign-in' })).toBeTruthy();
    expect((await row('admin')).getByText('Password')).toBeTruthy();
    expect((await row('admin')).queryByText('linked to SSO')).toBeNull();
    expect((await row('linked')).getByText('Password')).toBeTruthy();
    expect((await row('linked')).getByText('linked to SSO')).toBeTruthy();
    expect((await row('sso-kid')).getByText('SSO').getAttribute('title')).toBe('Created by a single sign-on login');
    expect((await row('sso-kid')).queryByText('Password')).toBeNull();
  });
});
