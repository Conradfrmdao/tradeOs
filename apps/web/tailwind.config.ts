import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Semantic names so profit/loss colouring is consistent everywhere and
        // can be adjusted in one place.
        profit: { DEFAULT: '#059669', soft: '#ecfdf5' },
        loss: { DEFAULT: '#dc2626', soft: '#fef2f2' },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
