// The variables hold "r g b" (see themes/css.ts), so opacity modifiers like
// `bg-gold-500/20` work, in every browser Tailwind's own colours do.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;
const scale = (name, steps) => Object.fromEntries(steps.map((step) => [step, token(`${name}-${step}`)]));
const NEUTRAL = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const TEXT = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl'];
const radius = (value) => `calc(${value} * var(--radius-scale))`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // The neutral ramp, brand and focus colours come from the active theme:
        // see src/themes. The old ink/accent names point at the same variables.
        chesscom: scale('neutral', NEUTRAL),
        ink: scale('neutral', NEUTRAL.filter((step) => step !== 950)),
        cream: token('neutral-50'),
        green: scale('brand', [50, 100, 400, 500, 600, 700]),
        accent: scale('brand', [50, 100, 300, 500, 600, 700]),
        gold: scale('focus', [50, 100, 300, 500, 600, 700]),
        panel: token('panel'),
        hero: token('hero'),
        // Components use board-dark as a brand colour, so it follows the theme.
        board: { dark: token('brand-500'), light: '#eeeed2', dest: '#baca44' },
        warn:   '#ffa459',
        bad:    '#fa412d',
        // Move classification colors — chess.com-faithful hex values.
        move: {
          brilliant:  '#1baca6',  // teal
          great:      '#5b8baf',  // steel blue
          best:       '#81b64c',  // green-400
          excellent:  '#95b776',  // olive
          good:       '#95a370',  // muted olive
          book:       '#a88865',  // warm tan
          inaccuracy: '#f7c045',  // mustard
          mistake:    '#ffa459',  // orange
          blunder:    '#fa412d',  // red
          miss:       '#ee6b55',  // red-orange (not purple)
          forced:     '#6b6964',  // graphite
        },
      },
      fontFamily: {
        sans: 'var(--font-sans)',
        mono: 'var(--font-mono)',
      },
      fontSize: Object.fromEntries(TEXT.map((name) => [name, [`var(--text-${name})`, { lineHeight: `var(--leading-${name})` }]])),
      borderRadius: {
        sm: radius('0.125rem'),
        DEFAULT: radius('0.25rem'),
        md: radius('0.375rem'),
        lg: radius('0.5rem'),
        xl: radius('0.75rem'),
        '2xl': radius('1rem'),
        '3xl': radius('1.5rem'),
        full: radius('9999px'),
      },
      boxShadow: {
        soft: 'var(--shadow-soft)',
        lift: 'var(--shadow-lift)',
        board: 'var(--shadow-board)',
        glow: 'var(--shadow-glow)',
      },
      keyframes: {
        'pulse-soft': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%':       { opacity: '0.7', transform: 'scale(0.97)' },
        },
        'loader-slide': {
          '0%':   { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(400%)' },
        },
        'fade-in': {
          '0%':   { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'badge-pop': {
          '0%':   { opacity: '0', transform: 'scale(0.6)' },
          '60%':  { opacity: '1', transform: 'scale(1.08)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'last-move-pulse': {
          '0%':   { backgroundColor: 'rgba(255, 235, 59, 0.65)' },
          '100%': { backgroundColor: 'rgba(255, 235, 59, 0.40)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'check-pulse': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(250, 65, 45, 0.00)' },
          '50%':       { boxShadow: '0 0 8px 2px rgba(250, 65, 45, 0.45)' },
        },
      },
      animation: {
        'pulse-soft':     'pulse-soft 1.6s ease-in-out infinite',
        'loader-slide':   'loader-slide 1.4s ease-in-out infinite',
        'fade-in':        'fade-in 220ms ease-out',
        'badge-pop':      'badge-pop 220ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        'last-move-pulse': 'last-move-pulse 360ms ease-out forwards',
        'shimmer':        'shimmer 1.6s linear infinite',
        'check-pulse':    'check-pulse 600ms ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
