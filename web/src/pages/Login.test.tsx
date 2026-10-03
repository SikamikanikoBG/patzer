// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../api', () => ({ api: { get, post } }));
// happy-dom cancels framer-motion's entrance animation on unmount with an
// unhandled AbortError. The animation isn't under test: render a plain div.
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className }: { children?: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
  },
}));

import i18n from '../i18n';
import Login from './Login';

const baseConfig = {
  signup_enabled: true,
  signup_mode: 'open',
  email_enabled: true,
  oidc_enabled: false,
  oidc_only: false,
  oidc_button_text: null as string | null,
};

function renderLogin(config: Partial<typeof baseConfig>, url = '/login') {
  get.mockResolvedValue({ ...baseConfig, ...config });
  return render(<MemoryRouter initialEntries={[url]}><Login /></MemoryRouter>);
}

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('en');
});
// Without vitest globals, testing-library can't register its own cleanup.
afterEach(cleanup);

describe('Login page and single sign-on', () => {
  it('without SSO: the password form only, as before', async () => {
    renderLogin({});
    expect(await screen.findByLabelText('Username')).toBeTruthy();
    expect(screen.queryByText('Sign in with SSO')).toBeNull();
  });

  it('with SSO: the button with the operator label, then the password form', async () => {
    renderLogin({ oidc_enabled: true, oidc_button_text: 'Sign in with Authentik' });
    const button = await screen.findByText('Sign in with Authentik');
    expect(button.closest('a')?.getAttribute('href')).toBe('/api/auth/oidc/start');
    expect(screen.getByText('or')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
  });

  it('SSO only: no password form, no sign-up or reset links, translated default label', async () => {
    await i18n.changeLanguage('de');
    renderLogin({ oidc_enabled: true, oidc_only: true, signup_enabled: false, email_enabled: false });
    expect(await screen.findByText('Mit SSO anmelden')).toBeTruthy();
    expect(screen.queryByLabelText('Passwort')).toBeNull();
    expect(screen.queryByRole('button', { name: /anmelden/i })).toBeNull();
    expect(screen.queryByText('oder')).toBeNull();
  });

  it('explains a failed SSO login from the ?sso_error= the server redirected with', async () => {
    renderLogin({ oidc_enabled: true }, '/login?sso_error=not_provisioned');
    expect(await screen.findByText(/don't have a Patzer account yet/)).toBeTruthy();
  });

  it('explains that the admin has to sign in first', async () => {
    renderLogin({ oidc_enabled: true, oidc_only: true }, '/login?sso_error=admin_first');
    expect(await screen.findByText(/waiting for its administrator to sign in first/)).toBeTruthy();
  });

  it('tells a rate-limited user to wait', async () => {
    renderLogin({ oidc_enabled: true }, '/login?sso_error=rate_limited');
    expect(await screen.findByText(/Too many attempts/)).toBeTruthy();
  });

  it('an unknown error code still says something useful', async () => {
    renderLogin({ oidc_enabled: true }, '/login?sso_error=whatever');
    expect(await screen.findByText(/Single sign-on didn't work/)).toBeTruthy();
  });
});
