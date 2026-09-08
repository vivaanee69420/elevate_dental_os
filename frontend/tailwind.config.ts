import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './features/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      // Green/gold system — see DESIGN.md. Token names unchanged; values
      // migrated from the prior teal/amber theme so screens re-skin centrally.
      colors: {
        brand: {
          DEFAULT: '#1D6E5F',
          50: '#E2EFE9',
          100: '#C7E0D6',
          200: '#9FCBBC',
          500: '#1D6E5F',
          600: '#175C50',
          700: '#0F5132',
          900: '#0A3B28',
        },
        accent: '#C6A253',
        success: '#2E9E6A',
        warning: '#BF8A22',
        danger: '#C25F4D',
        info: '#2B7A8C',
        gold: '#C6A253',
        ink: {
          DEFAULT: '#15241E',
          muted: '#566B62',
          soft: '#5F7268',
        },
        bg: '#EEF3EF',
        surface: {
          DEFAULT: '#FFFFFF',
          // The muted ground used for hover states and banded rows. Screens
          // have referenced `bg-surface-muted` and `bg-surface-2` since the
          // theme migration, but neither token was ever defined — so those
          // classes produced NO CSS and the hovers and row banding simply did
          // not exist. Both name the same thing, and both are kept because
          // both are already written across the product.
          muted: '#EEF3EF',
          2: '#EEF3EF',
        },
        card: '#FFFFFF',
        border: '#DCE4DF',
        // Alias of `border`, for the `border-line` spelling used across the
        // Intelligence screens. Undefined until now, so ten buttons that were
        // written to have a border rendered with none.
        line: '#DCE4DF',
      },
      // Panel-scale radius/shadow for the new primitives (KpiCard, PanelHeader).
      // Named distinctly so the base `rounded`/`shadow` scale is untouched —
      // avoids re-rounding chips / re-shadowing small elements on legacy screens.
      borderRadius: {
        panel: '18px',
      },
      boxShadow: {
        panel: '0 18px 48px rgba(20, 60, 46, .10)',
        'panel-sm': '0 6px 18px rgba(20, 60, 46, .07)',
      },
      fontFamily: {
        display: ['Fraunces', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
