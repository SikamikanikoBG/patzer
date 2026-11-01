import '@fontsource-variable/nunito/wght.css';
import './jelly.css';
import classic from '../classic';
import { mix } from '../css';
import type { Theme, ThemeArrows, ThemeColors } from '../types';
import { JELLY_MOVE_GLYPHS } from './moveGlyphs';

// These assets by file name, as URLs: nothing downloads until a rule needs it. The
// icons aren't here, because jelly.css names them itself.
const assets = import.meta.glob<string>('./assets/{board,button,pieces,square}-*.webp', { eager: true, import: 'default' });
const asset = (name: string) => assets[`./assets/${name}.webp`];
const cssUrl = (name: string) => `url("${asset(name)}")`;

/** One row per theme. To add a combination, add a row: that is the whole change. */
interface Recipe {
  name: string;
  /** Which piece sheet, and a board cut from any sheet (scripts/extract-jelly-assets.py). */
  pieces: 1 | 2 | 3;
  board: string;
  squares: { light: string; dark: string };
  /** The neutral ramp runs from `paper` (50) to `deep` (900), tinted to match the board. */
  paper: string;
  deep: string;
  /** Primary actions. Links and accents use it, darkened where the ramp needs it. */
  accent: string;
  /** Focus rings and the active nav item. */
  pop: string;
  primary: ButtonFace;
  secondary: ButtonFace;
  arrows: ThemeArrows;
}

/** A jelly button, and the text colour that reads on it. */
type ButtonFace = { image: string; ink: string };

const NAVY = '#10263f';
const WHITE = '#ffffff';
const cyan: ButtonFace = { image: 'cyan', ink: NAVY };
const ice: ButtonFace = { image: 'ice', ink: NAVY };
const orange: ButtonFace = { image: 'orange', ink: '#3d1a00' };
const yellow: ButtonFace = { image: 'yellow', ink: '#3b2a00' };
const magenta: ButtonFace = { image: 'magenta', ink: '#3a0040' };
const purple: ButtonFace = { image: 'purple', ink: '#2a0a4a' };
const teal: ButtonFace = { image: 'teal', ink: '#04302d' };
const green: ButtonFace = { image: 'green', ink: '#07360a' };
const slate: ButtonFace = { image: 'slate', ink: WHITE };

// Deep candy colours for pale boards, bright ones for dark boards.
const CANDY: ThemeArrows = { green: '#178a2c', red: '#e01e45', blue: '#1558c0', yellow: '#d97a00' };
const GLOW: ThemeArrows = { green: '#8dff6e', red: '#ff6f8c', blue: '#7fdcff', yellow: '#ffdf4d' };

const RECIPES: Record<string, Recipe> = {
  // Red and navy pieces.
  lagoon: {
    name: 'Jelly Lagoon', pieces: 1, board: 'lagoon', squares: { light: '#e3f4fe', dark: '#9cd3ee' },
    paper: '#f2f9fd', deep: '#12304a', accent: '#2b9ad6', pop: '#ff5a6e', arrows: CANDY, primary: cyan, secondary: ice,
  },
  peach: {
    name: 'Jelly Peach', pieces: 1, board: 'peach', squares: { light: '#ffe6bc', dark: '#ffb683' },
    paper: '#fff8ef', deep: '#40240f', accent: '#e8863a', pop: '#d92f52', arrows: CANDY, primary: orange, secondary: yellow,
  },
  bubblegum: {
    name: 'Jelly Bubblegum', pieces: 1, board: 'bubblegum', squares: { light: '#fbdede', dark: '#fab7c9' },
    paper: '#fff5f7', deep: '#4a1a2e', accent: '#e8558f', pop: '#7a4dff', arrows: CANDY, primary: magenta, secondary: ice,
  },
  // Yellow and green pieces.
  mint: {
    name: 'Jelly Mint', pieces: 2, board: 'mint', squares: { light: '#b8fce0', dark: '#62ded6' },
    paper: '#f0fdf8', deep: '#0d3a38', accent: '#1fae9f', pop: '#f5a800', arrows: CANDY, primary: teal, secondary: ice,
  },
  sky: {
    name: 'Jelly Sky', pieces: 2, board: 'sky', squares: { light: '#e3eefa', dark: '#4099ed' },
    paper: '#f3f8fd', deep: '#102f55', accent: '#2f86e0', pop: '#f5a800', arrows: { ...CANDY, blue: '#0b2f6e', yellow: '#f2b200' }, primary: cyan, secondary: yellow,
  },
  lilac: {
    name: 'Jelly Lilac', pieces: 2, board: 'lilac', squares: { light: '#f9def5', dark: '#ecb7f6' },
    paper: '#fdf6fd', deep: '#3a1a4e', accent: '#b45fdc', pop: '#3fa314', arrows: CANDY, primary: purple, secondary: magenta,
  },
  // Magenta and ice pieces, on dark boards.
  grape: {
    name: 'Jelly Grape', pieces: 3, board: 'grape', squares: { light: '#6c63c6', dark: '#4a3e98' },
    paper: '#f4f2fd', deep: '#211a4a', accent: '#7a6bdc', pop: '#ff5fd0', arrows: GLOW, primary: purple, secondary: slate,
  },
  forest: {
    name: 'Jelly Forest', pieces: 3, board: 'forest', squares: { light: '#307e5f', dark: '#0a463f' },
    paper: '#f1f9f5', deep: '#0b2e28', accent: '#2f9a6e', pop: '#ff5fd0', arrows: GLOW, primary: green, secondary: slate,
  },
  midnight: {
    name: 'Jelly Midnight', pieces: 3, board: 'midnight', squares: { light: '#5172a2', dark: '#204970' },
    paper: '#f2f6fb', deep: '#0e2a45', accent: '#3f7fc0', pop: '#5fe8ff', arrows: GLOW, primary: cyan, secondary: slate,
  },
};

function jellyTheme(key: string, r: Recipe): Theme {
  // Like Classic, one ramp serves both schemes: components pick the steps.
  const step = (pct: number) => mix(r.deep, pct, r.paper);
  const shared: Omit<ThemeColors, 'pageBg' | 'pageFg' | 'panel'> = {
    arrows: r.arrows,
    neutral: {
      50: r.paper, 100: step(9), 200: step(20), 300: step(42), 400: step(58), 500: step(70),
      600: step(78), 700: step(86), 800: step(93), 900: r.deep, 950: mix(r.deep, 72, '#000000'),
    },
    brand: {
      50: mix(r.accent, 12, r.paper), 100: mix(r.accent, 25, r.paper), 300: mix(r.accent, 60, r.paper), 400: r.accent,
      500: r.accent, 600: mix(r.accent, 85, r.deep), 700: mix(r.accent, 70, r.deep),
    },
    focus: {
      50: mix(r.pop, 10, r.paper), 100: mix(r.pop, 22, r.paper), 300: mix(r.pop, 60, r.paper),
      500: r.pop, 600: mix(r.pop, 88, r.deep), 700: mix(r.pop, 70, r.deep),
    },
    hero: mix(r.accent, 55, r.deep),
  };
  const vars = {
    '--jelly-board': cssUrl(`board-${r.board}`),
    '--jelly-primary': cssUrl(`button-${r.primary.image}`),
    '--jelly-primary-ink': r.primary.ink,
    '--jelly-secondary': cssUrl(`button-${r.secondary.image}`),
    '--jelly-secondary-ink': r.secondary.ink,
    '--jelly-rim': mix(r.accent, 45, r.deep),
    '--jelly-square-last': cssUrl('square-last'),
    '--jelly-square-selected': cssUrl('square-selected'),
    '--jelly-square-target': cssUrl('square-target'),
  };
  return {
    id: `jelly-${key}`,
    name: r.name,
    preview: { page: r.paper, surface: WHITE, accent: r.accent, boardLight: r.squares.light, boardDark: r.squares.dark },
    ownsBoard: true,
    credits: [{ text: 'Art: Jelly Chess Assets by mightea', url: 'https://mightea.itch.io/jelly-chess-assets' }],
    colors: {
      light: { ...shared, pageBg: mix(r.accent, 8, r.paper), pageFg: r.deep, panel: r.paper },
      // Muted text sits on dark surfaces here, so its steps are lighter.
      dark: {
        ...shared,
        neutral: { ...shared.neutral, 300: step(30), 400: step(40), 500: step(50) },
        pageBg: r.deep,
        pageFg: r.paper,
        panel: step(93),
      },
    },
    shape: {
      ...classic.shape,
      fontSans: `'Nunito Variable', system-ui, -apple-system, 'Segoe UI', sans-serif`,
      radiusScale: 1.5,
      shadowSoft: '0 3px 0 rgb(0 0 0 / 8%)',
      shadowLift: '0 6px 0 rgb(0 0 0 / 12%)',
    },
    moveGlyphs: JELLY_MOVE_GLYPHS,
    pieces: { kind: 'sheet', url: asset(`pieces-${r.pieces}`)! },
    vars: {
      light: { ...vars, '--jelly-gloss': 'rgb(255 255 255 / 45%)' },
      dark: { ...vars, '--jelly-gloss': 'rgb(255 255 255 / 8%)' },
    },
  };
}

export const JELLY_THEMES: readonly Theme[] = Object.entries(RECIPES).map(([key, recipe]) => jellyTheme(key, recipe));
