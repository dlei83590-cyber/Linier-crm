import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}', '../../packages/ui/src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          900: '#1e3a8a',
        },
        // F2-1 Design System — 语义色（单一事实来源：components/design-system/tokens.ts）
        canvas: '#f8fafc',
        surface: '#ffffff',
        border: {
          DEFAULT: '#e2e8f0',
          strong: '#cbd5e1',
        },
        ink: {
          primary: '#0f172a',
          secondary: '#475569',
          muted: '#94a3b8',
        },
        // F2-1 Design System — 状态色（bg/text/border 三元组，供 StatusBadge / ErrorPanel / StateActionBar 消费）
        status: {
          neutral: { bg: '#f1f5f9', text: '#475569', border: '#e2e8f0' },
          info: { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' },
          success: { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' },
          warning: { bg: '#fffbeb', text: '#b45309', border: '#fde68a' },
          danger: { bg: '#fef2f2', text: '#b91c1c', border: '#fecaca' },
        },
      },
      boxShadow: {
        'elevation-sm': '0 1px 2px 0 rgb(15 23 42 / 0.05)',
        'elevation-md': '0 4px 6px -1px rgb(15 23 42 / 0.08), 0 2px 4px -2px rgb(15 23 42 / 0.05)',
        'elevation-lg': '0 10px 15px -3px rgb(15 23 42 / 0.1), 0 4px 6px -4px rgb(15 23 42 / 0.05)',
      },
      fontSize: {
        'display-sm': ['1.25rem', { lineHeight: '1.75rem', fontWeight: '600' }],
        'display-base': ['1.5rem', { lineHeight: '2rem', fontWeight: '600' }],
      },
    },
  },
  plugins: [],
};

export default config;
