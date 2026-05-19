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
          50: '#E6F2F2',
          100: '#C2E0DF',
          200: '#9FCFCD',
          500: '#0E7C7B',
          700: '#085857',
          900: '#053837',
        },
        accent: '#FFB547',
        success: '#10B981',
        warning: '#F59E0B',
        danger: '#EF4444',
        ink: {
          DEFAULT: '#1F2937',
          muted: '#6B7280',
        },
        bg: '#F9FAFB',
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
