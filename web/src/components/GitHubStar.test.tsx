// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

import { useAuth, type User } from '../state/auth';
import GitHubStar, { formatStars, useStarPreview } from './GitHubStar';

const ok = (stars: number) => Promise.resolve({ ok: true, json: () => Promise.resolve({ stargazers_count: stars }) });

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => ok(42)));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('formatStars', () => {
  it('abbreviates thousands and drops a trailing .0', () => {
    expect(formatStars(7)).toBe('7');
    expect(formatStars(999)).toBe('999');
    expect(formatStars(1000)).toBe('1k');
    expect(formatStars(1240)).toBe('1.2k');
    expect(formatStars(12400)).toBe('12k');
  });
});

describe('GitHubStar', () => {
  it('shows the count and caches it so the next mount asks nobody', async () => {
    const { unmount } = render(<GitHubStar />);
    await waitFor(() => expect(screen.getByText('42')).toBeTruthy());
    expect(fetch).toHaveBeenCalledTimes(1);
    // Sent without a Referer: sign-up and reset URLs carry codes and tokens.
    expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ referrerPolicy: 'no-referrer' }));
    unmount();

    render(<GitHubStar />);
    expect(screen.getByText('42')).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('refetches once the cached count is a day old', async () => {
    localStorage.setItem('github.stars', JSON.stringify({ n: 1, at: Date.now() - 25 * 60 * 60 * 1000 }));
    render(<GitHubStar />);
    await waitFor(() => expect(screen.getByText('42')).toBeTruthy());
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('stays usable when GitHub is unreachable — link yes, number no', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    const { container } = render(<GitHubStar />);
    const link = container.querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://github.com/SikamikanikoBG/patzer');
    expect(link.textContent).toBe('Star on GitHub');
  });

  it('stops nudging on this device once you have clicked through', () => {
    const { container, unmount } = render(<GitHubStar />);
    fireEvent.click(container.querySelector('a') as HTMLAnchorElement);
    expect(screen.getByText('Starred')).toBeTruthy();
    unmount();

    render(<GitHubStar />);
    expect(screen.getByText('Starred')).toBeTruthy();
  });
});

describe('GitHubStar visibility', () => {
  const withStar = (show: number) => useAuth.setState({ user: { profile: { show_github_star: show } } as User });
  afterEach(() => useAuth.setState({ user: null }));

  it('shows when logged out, because there is no profile to ask', () => {
    useAuth.setState({ user: null });
    const { container, unmount } = render(<GitHubStar />);
    expect(container.querySelector('a')).toBeTruthy();
    unmount();
  });

  it('renders nothing and asks GitHub nothing when the profile turned it off', () => {
    withStar(0);
    const { container, unmount } = render(<GitHubStar />);
    expect(container.innerHTML).toBe('');
    expect(fetch).not.toHaveBeenCalled();
    unmount();
  });

  it('follows the unsaved choice in Settings over the saved one', () => {
    withStar(1);
    useStarPreview.setState({ preview: false });
    const { container, unmount } = render(<GitHubStar />);
    expect(container.querySelector('a')).toBeNull();
    useStarPreview.setState({ preview: null });
    unmount();
  });
});
