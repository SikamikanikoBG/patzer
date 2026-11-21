// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ role: 'user' }));
vi.mock('../api', () => ({
  api: { get: vi.fn(() => Promise.resolve({ version: '' })) },
}));
vi.mock('../state/auth', () => ({
  useAuth: () => ({ user: { role: auth.role, profile: {} }, refresh: vi.fn() }),
}));
vi.mock('./UpdateNotice', () => ({ default: () => null }));
vi.mock('./GitHubStar', () => ({ default: () => null }));

import i18n from '../i18n';
import Layout from './Layout';
import { LANGUAGE_CODES } from '../lib/languages';

beforeEach(async () => {
  auth.role = 'user';
  await i18n.changeLanguage('en');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderNav(path = '/') {
  const { container } = render(<MemoryRouter initialEntries={[path]}><Layout /></MemoryRouter>);
  return container.querySelector('nav')!;
}

/** happy-dom does no layout, so give the pill strip the sizes of a bar that
 *  is too narrow for its pills. */
function narrowBar(scrollWidth = 900, clientWidth = 400) {
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(scrollWidth);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(clientWidth);
}

describe('desktop navigation labels', () => {
  it('keeps translated titles visible when switching languages and back to English', async () => {
    const nav = renderNav();
    for (const language of [...LANGUAGE_CODES, 'en']) {
      await act(async () => { await i18n.changeLanguage(language); });

      const review = within(nav).getByRole('link', { name: i18n.t('home.reviewTitle') });
      expect(review.querySelector('span')?.textContent).toBe(i18n.t('home.reviewTitle'));
      const labels = [...nav.querySelectorAll('a > span')];
      expect(labels).toHaveLength(10);
      for (const label of labels) {
        // No stylesheet is loaded here, so getComputedStyle can't see a
        // Tailwind `hidden`; the class list is what the old icon-only mode set.
        expect(label.textContent).not.toBe('');
        expect([...label.classList]).not.toContain('hidden');
        expect([...label.classList]).not.toContain('sr-only');
      }
    }
  });

  it('keeps the admin dropdown outside the scrolling pills', async () => {
    auth.role = 'admin';
    await i18n.changeLanguage('de');
    const nav = renderNav();

    fireEvent.click(within(nav).getByRole('button', { name: i18n.t('common.admin') }));
    const menu = within(nav).getByRole('menu');
    expect(menu.closest('.overflow-x-auto')).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: i18n.t('admin.users') })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: i18n.t('admin.system') })).toBeTruthy();
  });
});

describe('desktop navigation that does not fit', () => {
  it('shows no arrows when every pill fits', () => {
    const nav = renderNav();
    expect(nav.querySelector('[data-nav-scroll]')).toBeNull();
  });

  it('offers an arrow towards the hidden pills, and one back after scrolling', () => {
    narrowBar();
    const nav = renderNav();
    const strip = nav.querySelector<HTMLElement>('.overflow-x-auto')!;
    expect(nav.querySelector('[data-nav-scroll="left"]')).toBeNull();
    const right = nav.querySelector<HTMLElement>('[data-nav-scroll="right"]')!;
    expect(right).not.toBeNull();

    const scrollBy = vi.fn();
    strip.scrollBy = scrollBy;
    fireEvent.click(right);
    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ left: 240 }));

    // Scrolled to the far end: only the way back is offered.
    vi.spyOn(strip, 'scrollLeft', 'get').mockReturnValue(500);
    fireEvent.scroll(strip);
    expect(nav.querySelector('[data-nav-scroll="right"]')).toBeNull();
    fireEvent.click(nav.querySelector<HTMLElement>('[data-nav-scroll="left"]')!);
    expect(scrollBy).toHaveBeenLastCalledWith(expect.objectContaining({ left: -240 }));
  });

  it('scrolls the current page into view', () => {
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) { scrolled.push(this); };
    const nav = renderNav('/lab');
    const lab = within(nav).getByRole('link', { name: i18n.t('lab.nav', { defaultValue: 'Lab' }) });
    expect(lab.getAttribute('aria-current')).toBe('page');
    expect(scrolled).toContain(lab);
  });
});
