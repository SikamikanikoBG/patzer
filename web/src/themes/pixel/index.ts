import './pixel.css';
import { mix } from '../css';
import type { Theme } from '../types';
import { SPRITES } from './sprites';

// Nectar's chess pixel art: its 24×24 pieces, the Balatro theme's m6x11 font
// (Latin and Cyrillic) and hard edges, in any palette. The colour formulas are
// the ones in Nectar's chess.css.

/** One colour scheme of a Pixel theme. */
interface Palette {
  bg: string;
  surface: string;
  raised: string;
  line: string;
  ink: string;
  muted: string;
  /** Primary actions, and the tint of the board and the pieces. */
  brand: string;
  /** Focus rings and the active nav item. */
  focus: string;
  /** Translucent overlays on the board. */
  last: string;
  selected: string;
  hint: string;
}

/** The dark scheme's black pieces start from their own near-black tones. */
interface DarkPalette extends Palette {
  blackPiece: { highlight: string; body: string; shade: string };
}

const WHITE = '#ffffff';
const BLACK = '#000000';

// m6x11 stays crisp only at the sizes Nectar's Balatro theme uses: 16, 24, 32 and
// 48px here. Every size the app uses lands on one.
const FONT = `'m6x11', 'Inter', system-ui, sans-serif`;

const SHAPE: Theme['shape'] = {
  fontSans: FONT,
  fontMono: FONT,
  radiusScale: 0,
  bodySize: '16px',
  bodyLeading: '1.25',
  text: {
    xs: ['16px', '20px'],
    sm: ['16px', '20px'],
    base: ['16px', '24px'],
    lg: ['24px', '28px'],
    xl: ['24px', '28px'],
    '2xl': ['32px', '36px'],
    '3xl': ['32px', '40px'],
    '4xl': ['48px', '52px'],
  },
  shadowSoft: '3px 3px 0 rgb(0 0 0 / 25%)',
  shadowLift: '6px 6px 0 rgb(0 0 0 / 35%)',
  shadowBoard: 'none',
  shadowGlow: '0 0 0 3px var(--focus-500)',
};

function pixelTheme(id: string, name: string, dark: DarkPalette, light: Palette): Theme {
  const squaresDark = { light: mix(dark.brand, 24, dark.raised), dark: mix(dark.brand, 6, dark.surface) };
  const squaresLight = { light: mix(light.brand, 10, light.surface), dark: mix(light.brand, 34, light.raised) };
  return {
    id,
    name,
    preview: { page: dark.bg, surface: dark.raised, accent: dark.brand, boardLight: squaresDark.light, boardDark: squaresDark.dark },
    ownsBoard: true,
    credits: [
      { text: 'Font: m6x11 by Daniel Linssen', url: 'https://managore.itch.io/m6x11' },
      { text: 'Cyrillic: m6x11cyrillic by Natto Games', url: 'https://nattogames.itch.io/m6x11cyrillic' },
    ],
    colors: {
      light: {
        pageBg: light.bg,
        pageFg: light.ink,
        neutral: {
          50: light.bg, 100: light.raised, 200: light.line, 300: mix(light.line, 50, light.muted), 400: light.muted,
          500: light.muted, 600: mix(light.muted, 50, light.ink), 700: mix(light.muted, 25, light.ink),
          800: light.ink, 900: light.ink, 950: light.ink,
        },
        brand: {
          50: mix(light.brand, 12, light.surface), 100: mix(light.brand, 25, light.surface), 300: mix(light.brand, 55, light.surface),
          400: light.brand, 500: light.brand, 600: mix(light.brand, 85, light.ink), 700: mix(light.brand, 70, light.ink),
        },
        focus: {
          50: mix(light.focus, 8, light.surface), 100: mix(light.focus, 16, light.surface), 300: mix(light.focus, 45, light.surface),
          500: light.focus, 600: light.focus, 700: mix(light.focus, 80, light.ink),
        },
        panel: light.bg,
        hero: mix(light.brand, 60, light.ink),
      },
      dark: {
        pageBg: dark.bg,
        pageFg: dark.ink,
        neutral: {
          50: dark.ink, 100: mix(dark.ink, 85, dark.muted), 200: mix(dark.ink, 40, dark.muted), 300: dark.muted,
          400: mix(dark.muted, 80, dark.line), 500: mix(dark.muted, 55, dark.line), 600: dark.line,
          700: dark.raised, 800: dark.surface, 900: dark.bg, 950: mix(dark.bg, 70, BLACK),
        },
        brand: {
          50: mix(dark.brand, 12, dark.raised), 100: mix(dark.brand, 25, dark.raised), 300: mix(dark.brand, 75, dark.ink),
          400: dark.brand, 500: mix(dark.brand, 45, dark.raised), 600: mix(dark.brand, 55, dark.raised), 700: mix(dark.brand, 35, dark.raised),
        },
        focus: {
          50: mix(dark.focus, 10, dark.raised), 100: mix(dark.focus, 20, dark.raised), 300: mix(dark.focus, 70, dark.ink),
          500: dark.focus, 600: dark.focus, 700: mix(dark.focus, 80, dark.ink),
        },
        panel: dark.surface,
        hero: mix(dark.brand, 30, dark.raised),
      },
    },
    shape: SHAPE,
    pieces: {
      kind: 'sprites',
      sprites: SPRITES,
      palette: {
        light: {
          white: { o: light.focus, h: WHITE, b: mix(light.brand, 10, WHITE), s: mix(light.focus, 25, WHITE) },
          black: { o: light.surface, h: mix(light.ink, 60, WHITE), b: light.ink, s: mix(light.ink, 70, BLACK) },
        },
        dark: {
          white: { o: dark.bg, h: WHITE, b: mix(dark.brand, 18, dark.ink), s: mix(dark.brand, 45, dark.muted) },
          black: {
            o: mix(dark.brand, 15, dark.muted),
            h: mix(dark.brand, 22, dark.blackPiece.highlight),
            b: mix(dark.brand, 6, dark.blackPiece.body),
            s: dark.blackPiece.shade,
          },
        },
      },
    },
    vars: {
      light: {
        '--px-outline': light.bg,
        '--px-card-rim': light.line,
        '--px-frame': mix(light.brand, 45, light.raised),
        '--px-button': mix(light.brand, 30, light.surface),
        '--px-button-lip': mix(light.brand, 40, light.ink),
        '--px-button-ink': light.ink,
        '--px-square-light': squaresLight.light,
        '--px-square-dark': squaresLight.dark,
        '--px-last': light.last,
        '--px-selected': light.selected,
        '--px-select-rim': light.focus,
        '--px-hint': light.hint,
        '--px-capture': light.focus,
        '--px-coord': light.muted,
        '--px-text-shadow': 'none',
      },
      dark: {
        '--px-outline': dark.bg,
        '--px-card-rim': dark.line,
        '--px-frame': mix(dark.brand, 30, dark.raised),
        '--px-button': mix(dark.brand, 22, dark.raised),
        '--px-button-lip': mix(dark.brand, 12, dark.bg),
        '--px-button-ink': dark.ink,
        '--px-square-light': squaresDark.light,
        '--px-square-dark': squaresDark.dark,
        '--px-last': dark.last,
        '--px-selected': dark.selected,
        '--px-select-rim': dark.brand,
        '--px-hint': dark.hint,
        '--px-capture': dark.focus,
        '--px-coord': dark.muted,
        '--px-text-shadow': '2px 2px 0 rgb(0 0 0 / 35%)',
      },
    },
  };
}

export const PIXEL_THEMES: readonly Theme[] = [
  // Nectar's own palette, from its nectar-tokens.css.
  pixelTheme(
    'pixel',
    'Pixel',
    {
      bg: '#0b1015', surface: '#141d26', raised: '#1d2a36', line: '#344451', ink: '#f4f8ec', muted: '#a8b8c3',
      brand: '#6ce8ed', focus: '#f5ff62',
      last: 'rgb(245 255 98 / 30%)', selected: 'rgb(108 232 237 / 38%)', hint: 'rgb(245 255 98 / 55%)',
      blackPiece: { highlight: '#46545c', body: '#1b2329', shade: '#07090b' },
    },
    {
      bg: '#f0f4ed', surface: '#fcfef8', raised: '#e4ebdf', line: '#bacaba', ink: '#18271f', muted: '#4d6458',
      brand: '#3c6813', focus: '#006b78',
      last: 'rgb(212 224 74 / 45%)', selected: 'rgb(0 107 120 / 28%)', hint: 'rgb(24 39 31 / 35%)',
    },
  ),
  // Deep plum with hot pink and orange, like a synthwave arcade cabinet.
  pixelTheme(
    'pixel-sunset',
    'Pixel Sunset',
    {
      bg: '#170d24', surface: '#24143a', raised: '#321e4e', line: '#54386f', ink: '#fdf1e6', muted: '#c4aac9',
      brand: '#ff5fa2', focus: '#ffb347',
      last: 'rgb(255 179 71 / 30%)', selected: 'rgb(255 95 162 / 38%)', hint: 'rgb(255 179 71 / 55%)',
      blackPiece: { highlight: '#5a3d66', body: '#2a1a38', shade: '#0f0716' },
    },
    {
      bg: '#fdf1e6', surface: '#fffaf4', raised: '#f6e2d2', line: '#e3c2b4', ink: '#2c1530', muted: '#6e4a66',
      brand: '#c2185b', focus: '#b4530a',
      last: 'rgb(255 179 71 / 45%)', selected: 'rgb(194 24 91 / 28%)', hint: 'rgb(44 21 48 / 35%)',
    },
  ),
];
