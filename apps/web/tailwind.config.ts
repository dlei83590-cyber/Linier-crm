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
        // FE 2.0 Design System — 语义色（单一事实来源：components/design-system/tokens.ts；Canvas #F6F7F9）
        canvas: '#f7f6f3', // 暖灰白（P2 微暖化；与 design-system/tokens.ts 同步）
        surface: '#ffffff',
        border: {
          DEFAULT: '#e2e8f0',
          strong: '#cbd5e1',
        },
        ink: {
          primary: '#111827',
          secondary: '#475569',
          muted: '#94a3b8',
        },
        // FE 2.0 Design System — 状态色（bg/text/border 三元组；Success=Emerald / Warning=Amber / Danger=Rose / Info=Blue / Neutral=Slate）
        status: {
          neutral: { bg: '#f1f5f9', text: '#475569', border: '#e2e8f0' },
          info: { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' },
          success: { bg: '#ecfdf5', text: '#047857', border: '#a7f3d0' },
          warning: { bg: '#fffbeb', text: '#b45309', border: '#fde68a' },
          danger: { bg: '#fff1f2', text: '#be123c', border: '#fecdd3' },
        },
        // Sprint8 UI Modern — 10 业务域高饱和色板（单一事实来源：design-system/tokens.ts MODULE_ACCENTS）
        domain: {
          workbench: { 50: '#eff6ff', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8' },
          'customer-project': { 50: '#f5f3ff', 500: '#8b5cf6', 600: '#7c3aed', 700: '#6d28d9' },
          sales: { 50: '#ecfdf5', 500: '#10b981', 600: '#059669', 700: '#047857' },
          purchasing: { 50: '#fff7ed', 500: '#f97316', 600: '#ea580c', 700: '#c2410c' },
          inventory: { 50: '#ecfeff', 500: '#06b6d4', 600: '#0891b2', 700: '#0e7490' },
          'supplier-ap': { 50: '#fffbeb', 500: '#f59e0b', 600: '#d97706', 700: '#b45309' },
          finance: { 50: '#fff1f2', 500: '#f43f5e', 600: '#e11d48', 700: '#be123c' },
          'master-data': { 50: '#f0f9ff', 500: '#0ea5e9', 600: '#0284c7', 700: '#0369a1' },
          system: { 50: '#f8fafc', 500: '#64748b', 600: '#475569', 700: '#334155' },
          reports: { 50: '#fdf4ff', 500: '#d946ef', 600: '#c026d3', 700: '#a21caf' },
        },
      },
      boxShadow: {
        'elevation-sm': '0 1px 2px 0 rgb(15 23 42 / 0.05)',
        'elevation-md': '0 4px 6px -1px rgb(15 23 42 / 0.08), 0 2px 4px -2px rgb(15 23 42 / 0.05)',
        'elevation-lg': '0 10px 15px -3px rgb(15 23 42 / 0.1), 0 4px 6px -4px rgb(15 23 42 / 0.05)',
      },
      // FE 2.0 — 语义字号（页面标题 24-28px / Section 14-16px semibold；display-sm/base 向后兼容保留）
      fontSize: {
        'display-sm': ['1.25rem', { lineHeight: '1.75rem', fontWeight: '600' }],
        'display-base': ['1.5rem', { lineHeight: '2rem', fontWeight: '600' }],
        'display-lg': ['1.75rem', { lineHeight: '2.25rem', fontWeight: '600' }],
        'section-sm': ['0.875rem', { lineHeight: '1.25rem', fontWeight: '600' }],
        section: ['1rem', { lineHeight: '1.5rem', fontWeight: '600' }],
      },
    },
  },
  plugins: [],
};

export default config;
