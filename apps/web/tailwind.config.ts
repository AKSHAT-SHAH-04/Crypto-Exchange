import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--bg) / <alpha-value>)',
        section: 'rgb(var(--section) / <alpha-value>)',
        panel: 'rgb(var(--panel) / <alpha-value>)',
        panel2: 'rgb(var(--panel2) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        fg: 'rgb(var(--fg) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        brand: 'rgb(var(--brand) / <alpha-value>)',
        up: 'rgb(var(--up) / <alpha-value>)',
        down: 'rgb(var(--down) / <alpha-value>)',
      },
      fontFamily: {
        // Native system UI font first (SF Pro on Apple devices), Inter elsewhere.
        sans: ['-apple-system', 'BlinkMacSystemFont', 'var(--font-sans)', 'system-ui', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
