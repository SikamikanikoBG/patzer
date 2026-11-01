// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api } from '../api';
import { useAuth, type Profile, type User } from '../state/auth';
import { applyTheme } from '../themes';
import Settings from './Settings';

vi.mock('../api', () => ({ api: { get: vi.fn(), patch: vi.fn() } }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { changeLanguage: vi.fn() } }),
}));

const profile = { language: 'en', ui_theme: 'classic', site_theme: 'light', board_theme: 'green', avatar_emoji: '♟' } as Profile;
const user = { id: 1, username: 'tester', role: 'admin', created_at: '', profile } as User;

const root = () => document.documentElement;

beforeEach(() => {
  window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as never;
  useAuth.setState({ user, refresh: vi.fn(async () => {}) });
  applyTheme('classic');
  root().classList.remove('dark');
});

afterEach(cleanup);

describe('Settings appearance preview', () => {
  it('shows a picked theme and scheme at once, without saving', () => {
    render(<Settings />);
    fireEvent.click(screen.getByRole('button', { name: 'Pixel Sunset' }));
    expect(root().dataset.theme).toBe('pixel-sunset');
    fireEvent.click(screen.getByRole('button', { name: 'settings.siteThemeDark' }));
    expect(root().classList.contains('dark')).toBe(true);
    expect(api.patch).not.toHaveBeenCalled();
  });

  it("credits the selected theme's art and fonts, and nothing for Classic", () => {
    render(<Settings />);
    expect(screen.queryByRole('link', { name: /m6x11/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Pixel Sunset' }));
    expect(screen.getByRole('link', { name: /Daniel Linssen/ }).getAttribute('href')).toBe('https://managore.itch.io/m6x11');
    fireEvent.click(screen.getByRole('button', { name: 'Jelly Mint' }));
    expect(screen.getByRole('link', { name: /mightea/ })).toBeTruthy();
  });

  it('goes back to the saved look when leaving without saving', () => {
    const { unmount } = render(<Settings />);
    fireEvent.click(screen.getByRole('button', { name: 'Pixel Sunset' }));
    fireEvent.click(screen.getByRole('button', { name: 'settings.siteThemeDark' }));
    unmount();
    expect(root().dataset.theme).toBe('classic');
    expect(root().classList.contains('dark')).toBe(false);
  });

  it('keeps the look after saving, even when the page unmounts', async () => {
    vi.mocked(api.patch).mockResolvedValue({ profile: { ...profile, ui_theme: 'pixel-sunset' } });
    const { unmount } = render(<Settings />);
    fireEvent.click(screen.getByRole('button', { name: 'Pixel Sunset' }));
    fireEvent.click(screen.getByRole('button', { name: /settings\.save|common\.save/ }));
    await waitFor(() => expect(useAuth.getState().user?.profile.ui_theme).toBe('pixel-sunset'));
    unmount();
    expect(root().dataset.theme).toBe('pixel-sunset');
  });
});
