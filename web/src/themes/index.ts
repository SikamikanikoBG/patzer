import { useSyncExternalStore } from 'react';
import classic from './classic';
import { PIXEL_THEMES } from './pixel';
import { themeCss } from './css';
import type { Theme } from './types';

// Every theme the app knows, in the order Settings shows them. To add one, see
// README.md in this folder: a new folder, and one line here.
export const THEMES: readonly Theme[] = [classic, ...PIXEL_THEMES];

export const DEFAULT_THEME = classic;

const STORAGE_KEY = 'patzer.ui_theme';
const STYLE_ID = 'patzer-theme';

let active: Theme = DEFAULT_THEME;
const listeners = new Set<() => void>();

/** An id from a profile may name a theme this build no longer has. */
export function findTheme(id: string | null | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? DEFAULT_THEME;
}

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Make a theme active: its tokens go in one <style>, its id on <html>. */
export function applyTheme(id: string | null | undefined): void {
  const theme = findTheme(id);
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  if (style.dataset.theme !== theme.id) {
    style.textContent = themeCss(theme);
    style.dataset.theme = theme.id;
  }
  document.documentElement.dataset.theme = theme.id;
  try {
    localStorage.setItem(STORAGE_KEY, theme.id);
  } catch {
    // Blocked storage only means the next load starts on the default theme.
  }
  if (active !== theme) {
    active = theme;
    listeners.forEach((listener) => listener());
  }
}

/** Before the first render, so the login page and the reload wear the last theme. */
export function applyStoredTheme(): void {
  applyTheme(readStored());
}

/** The active theme, for the few components that draw differently per theme. */
export function useTheme(): Theme {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => active,
  );
}
