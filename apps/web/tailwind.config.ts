import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans Arabic"', '"Cairo"', 'system-ui', 'sans-serif'],
        math: ['"KaTeX_Main"', '"Times New Roman"', 'serif'],
      },
      colors: {
        brand: {
          50: '#eef6ff',
          100: '#d9ebff',
          600: '#1d4ed8',
          700: '#1e40af',
          800: '#1e3a8a',
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
