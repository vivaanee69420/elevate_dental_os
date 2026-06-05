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
        surface: '#FFFFFF',
        card: '#FFFFFF',
        border: '#DCE4DF',
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
