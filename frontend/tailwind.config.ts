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
      colors: {
        brand: {
          DEFAULT: '#0E7C7B',
          50: '#E6F4F4',
          100: '#C2E5E4',
          200: '#9FCFCD',
          500: '#0E7C7B',
          600: '#0B6968',
          700: '#085857',
          900: '#053837',
        },
        accent: '#FFB547',
        success: '#10B981',
        warning: '#F59E0B',
        danger: '#EF4444',
        info: '#3B82F6',
        gold: '#B8860B',
        ink: {
          DEFAULT: '#0F172A',
          muted: '#64748B',
          soft: '#94A3B8',
        },
        bg: '#F6F7F9',
        surface: '#FFFFFF',
        card: '#FFFFFF',
        border: '#E5E7EB',
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
