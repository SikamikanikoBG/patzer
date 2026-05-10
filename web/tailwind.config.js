/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // v5 chess.com-faithful palette. The legacy ink/cream/accent aliases
        // are retained as redirects to the chesscom scale so any unmigrated
        // callsite still renders in the right family (gradual purge — the
        // tokens point to neutral greys instead of slate-blue, which is what
        // was clashing with chess.com chrome before).
        chesscom: {
          50:  '#f7f6f5',
          100: '#ebe9e7',
          200: '#d6d2cd',
          300: '#a09a93',
          400: '#7d7670',
          500: '#5d5955',
          600: '#4b4744',
          700: '#3a3735',
          800: '#312e2b', // primary panel bg in dark mode
          900: '#262421', // top nav bg
          950: '#1a1816',
        },
        // Board + brand-green family (also used for the primary "Play" CTA).
        board: { dark: '#769656', light: '#eeeed2', dest: '#baca44' },
        green: {
          50:  '#e8efd8',
          100: '#d3e0b8',
          400: '#81b64c',  // best-move / success
          500: '#769656',  // dark squares + primary CTA bg
          600: '#5d8a3a',  // primary CTA hover
          700: '#4e7837',  // primary CTA active
        },
        gold: {
          50:  '#fffaeb',
          100: '#fff3c7',
          300: '#ffd766',
          500: '#ffc934',  // focus rings, last-move highlight, active-nav underline only
          600: '#e6a700',
          700: '#a8780a',
        },
        panel: '#f1f1f0',
        hi:    '#e0c34a',

        // Legacy palette — redirected to chesscom-equivalent values so any
        // unmigrated component renders in the chess.com family even before its
        // callsite is touched. v6 fully eliminates these.
        ink:    { 50: '#f7f6f5', 100: '#ebe9e7', 200: '#d6d2cd', 300: '#a09a93', 400: '#7d7670', 500: '#5d5955', 600: '#4b4744', 700: '#3a3735', 800: '#312e2b', 900: '#262421' },
        cream:  '#f7f6f5',
        accent: { 50: '#e8efd8', 100: '#d3e0b8', 300: '#abc986', 500: '#769656', 600: '#5d8a3a', 700: '#4e7837' },
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
        sans: ['"Inter"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"Roboto Mono"', 'ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      // Chess.com-style shadows — pure black alpha base reads warmer over the
      // sage/cream chrome than the slate-blue base v4 used.
      boxShadow: {
        soft: '0 1px 2px rgba(0,0,0,0.04), 0 2px 8px -2px rgba(0,0,0,0.06)',
        lift: '0 2px 4px rgba(0,0,0,0.06), 0 12px 24px -8px rgba(0,0,0,0.16)',
        board: '0 4px 16px rgba(0,0,0,0.18)',
        glow: '0 0 0 2px rgba(255,201,52,0.45), 0 0 12px -2px rgba(255,201,52,0.30)',
      },
      // Default Tailwind radii (no overrides — chess.com uses tight 4-8px).
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
