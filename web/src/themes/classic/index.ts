import type { Theme, ThemeColors } from '../types';

// Patzer's original chess.com-style look: the values that used to be literals
// in tailwind.config.js and index.css. Its ramp serves both schemes, because
// the components already pick different steps for light and dark.
const colors: Omit<ThemeColors, 'pageBg' | 'pageFg'> = {
  neutral: {
    50: '#f7f6f5', 100: '#ebe9e7', 200: '#d6d2cd', 300: '#a09a93', 400: '#7d7670', 500: '#5d5955',
    600: '#4b4744', 700: '#3a3735', 800: '#312e2b', 900: '#262421', 950: '#1a1816',
  },
  brand: { 50: '#e8efd8', 100: '#d3e0b8', 300: '#abc986', 400: '#81b64c', 500: '#769656', 600: '#5d8a3a', 700: '#4e7837' },
  focus: { 50: '#fffaeb', 100: '#fff3c7', 300: '#ffd766', 500: '#ffc934', 600: '#e6a700', 700: '#a8780a' },
  panel: '#f1f1f0',
  arrows: { green: '#15781B', red: '#882020', blue: '#003088', yellow: '#e68f00' },
  hero: '#3b4c2f',
};

const classic: Theme = {
  id: 'classic',
  name: 'Classic',
  preview: { page: '#f1f1f0', surface: '#ffffff', accent: '#769656', boardLight: '#eeeed2', boardDark: '#769656' },
  colors: {
    light: { ...colors, pageBg: '#f1f1f0', pageFg: '#262421' },
    dark: { ...colors, pageBg: '#262421', pageFg: '#f1f1f0' },
  },
  shape: {
    fontSans: `'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif`,
    fontMono: `'Roboto Mono', ui-monospace, SFMono-Regular, Consolas, monospace`,
    radiusScale: 1,
    bodySize: '14px',
    bodyLeading: '1.45',
    text: {
      xs: ['0.75rem', '1rem'],
      sm: ['0.875rem', '1.25rem'],
      base: ['1rem', '1.5rem'],
      lg: ['1.125rem', '1.75rem'],
      xl: ['1.25rem', '1.75rem'],
      '2xl': ['1.5rem', '2rem'],
      '3xl': ['1.875rem', '2.25rem'],
      '4xl': ['2.25rem', '2.5rem'],
    },
    shadowSoft: '0 1px 2px rgba(0,0,0,0.04), 0 2px 8px -2px rgba(0,0,0,0.06)',
    shadowLift: '0 2px 4px rgba(0,0,0,0.06), 0 12px 24px -8px rgba(0,0,0,0.16)',
    shadowBoard: '0 4px 16px rgba(0,0,0,0.18)',
    shadowGlow: '0 0 0 2px rgba(255,201,52,0.45), 0 0 12px -2px rgba(255,201,52,0.30)',
  },
};

export default classic;
