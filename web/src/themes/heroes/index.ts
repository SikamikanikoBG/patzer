import { pixelTheme } from '../pixel';
import type { Theme } from '../types';
import pieces from './assets/pieces.png';

// Knights against demons, from Heroes Chess by Null Tale, on the Pixel look. The
// colours are from the sprites' fantasy24 palette. The board is their parchment
// highlight and stone armour, in an earth frame: light enough for their near-black
// outlines, unlike other Pixel themes' boards.
const SQUARES = { light: '#efd8a1', dark: '#927e6a' };
const BOARD = { '--px-square-light': SQUARES.light, '--px-square-dark': SQUARES.dark, '--px-frame': '#684c3c' };

const base = pixelTheme(
  'pixel-heroes',
  'Heroes',
  {
    bg: '#150f0a', surface: '#241a10', raised: '#392a1c', line: '#684c3c', ink: '#efd8a1', muted: '#b9a98f',
    brand: '#3c9f9c', focus: '#efac28',
    last: 'rgb(239 172 40 / 45%)', selected: 'rgb(60 159 156 / 50%)', hint: 'rgb(21 15 10 / 55%)',
    blackPiece: { highlight: '#684c3c', body: '#392a1c', shade: '#150f0a' },
  },
  {
    bg: '#f4e6c3', surface: '#fbf3de', raised: '#ecd9ac', line: '#c9b384', ink: '#2a1d0d', muted: '#684c3c',
    brand: '#276468', focus: '#9b1a0a',
    last: 'rgb(239 172 40 / 45%)', selected: 'rgb(39 100 104 / 40%)', hint: 'rgb(42 29 13 / 45%)',
  },
);

const heroes: Theme = {
  ...base,
  preview: { ...base.preview, boardLight: SQUARES.light, boardDark: SQUARES.dark },
  credits: [
    { text: 'Pieces: Heroes Chess by Null Tale, rearranged', url: 'https://nulltale.itch.io/heroes-chess' },
    { text: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' },
    ...(base.credits ?? []),
  ],
  pieces: { kind: 'sheet', url: pieces },
  vars: { light: { ...base.vars?.light, ...BOARD }, dark: { ...base.vars?.dark, ...BOARD } },
};

export default heroes;
