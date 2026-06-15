/** @type {import('tailwindcss').Config} */
module.exports = {
  // Bloom toggles the `.dark` class on the document root (web) / RN appearance,
  // so class-based dark mode keeps NativeWind utilities in sync with Bloom.
  darkMode: 'class',
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    './context/**/*.{js,jsx,ts,tsx}',
    './hooks/**/*.{js,jsx,ts,tsx}',
    './services/**/*.{js,jsx,ts,tsx}',
    './store/**/*.{js,jsx,ts,tsx}',
    './utils/**/*.{js,jsx,ts,tsx}',
    './styles/**/*.{js,jsx,ts,tsx}',
    '../../node_modules/@oxyhq/services/lib/**/*.{js,jsx}',
    '../../node_modules/@oxyhq/bloom/lib/**/*.{js,jsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      // All themed colors resolve to Bloom's CSS variables (see styles/global.css),
      // sourced from Bloom's `blue` preset and flipped by the `.dark` class. This
      // makes `bg-primary` / `bg-background` / `text-foreground` / `border-border`
      // the single source of truth shared with Bloom.
      colors: {
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'hsl(0 0% 100%)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        card: {
          DEFAULT: 'var(--surface)',
          foreground: 'var(--surface-foreground)',
        },
        surface: {
          DEFAULT: 'var(--surface)',
          foreground: 'var(--surface-foreground)',
        },
      },
    },
  },
  plugins: [],
};
