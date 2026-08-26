import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}', '../../packages/ui/src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Phase 1 深色模式：语义色全部改为 CSS 变量引用（类名不变 → 页面/测试零改动）；
        // 实际色值 SSOT = globals.css :root（亮）/ [data-theme="dark"]（暖暗）
        brand: {
          50: 'var(--color-brand-50)',
          100: 'var(--color-brand-100)',
          500: 'var(--color-brand-500)',
          600: 'var(--color-brand-600)',
          700: 'var(--color-brand-700)',
          900: 'var(--color-brand-900)',
        },
        // FE 2.0 Design System — 语义色（单一事实来源：design-system/tokens.ts；Canvas 暖灰白 #F7F6F3）
        canvas: 'var(--color-canvas)',
        surface: 'var(--color-surface)',
        border: {
          DEFAULT: 'var(--color-border)',
          strong: 'var(--color-border-strong)',
        },
        ink: {
          primary: 'var(--color-ink-primary)',
          secondary: 'var(--color-ink-secondary)',
          muted: 'var(--color-ink-muted)',
        },
        // FE 2.0 Design System — 状态色（bg/text/border 三元组；Success=Emerald / Warning=Amber / Danger=Rose / Info=Blue / Neutral=Slate）
        status: {
          neutral: { bg: 'var(--color-status-neutral-bg)', text: 'var(--color-status-neutral-text)', border: 'var(--color-status-neutral-border)' },
          info: { bg: 'var(--color-status-info-bg)', text: 'var(--color-status-info-text)', border: 'var(--color-status-info-border)' },
          success: { bg: 'var(--color-status-success-bg)', text: 'var(--color-status-success-text)', border: 'var(--color-status-success-border)' },
          warning: { bg: 'var(--color-status-warning-bg)', text: 'var(--color-status-warning-text)', border: 'var(--color-status-warning-border)' },
          danger: { bg: 'var(--color-status-danger-bg)', text: 'var(--color-status-danger-text)', border: 'var(--color-status-danger-border)' },
        },
        // Sprint8 UI Modern — 10 业务域高饱和色板（单一事实来源：design-system/tokens.ts MODULE_ACCENTS）
        domain: {
          workbench: { 50: 'var(--color-domain-workbench-50)', 500: 'var(--color-domain-workbench-500)', 600: 'var(--color-domain-workbench-600)', 700: 'var(--color-domain-workbench-700)' },
          'customer-project': { 50: 'var(--color-domain-customer-project-50)', 500: 'var(--color-domain-customer-project-500)', 600: 'var(--color-domain-customer-project-600)', 700: 'var(--color-domain-customer-project-700)' },
          sales: { 50: 'var(--color-domain-sales-50)', 500: 'var(--color-domain-sales-500)', 600: 'var(--color-domain-sales-600)', 700: 'var(--color-domain-sales-700)' },
          purchasing: { 50: 'var(--color-domain-purchasing-50)', 500: 'var(--color-domain-purchasing-500)', 600: 'var(--color-domain-purchasing-600)', 700: 'var(--color-domain-purchasing-700)' },
          inventory: { 50: 'var(--color-domain-inventory-50)', 500: 'var(--color-domain-inventory-500)', 600: 'var(--color-domain-inventory-600)', 700: 'var(--color-domain-inventory-700)' },
          'supplier-ap': { 50: 'var(--color-domain-supplier-ap-50)', 500: 'var(--color-domain-supplier-ap-500)', 600: 'var(--color-domain-supplier-ap-600)', 700: 'var(--color-domain-supplier-ap-700)' },
          finance: { 50: 'var(--color-domain-finance-50)', 500: 'var(--color-domain-finance-500)', 600: 'var(--color-domain-finance-600)', 700: 'var(--color-domain-finance-700)' },
          'master-data': { 50: 'var(--color-domain-master-data-50)', 500: 'var(--color-domain-master-data-500)', 600: 'var(--color-domain-master-data-600)', 700: 'var(--color-domain-master-data-700)' },
          system: { 50: 'var(--color-domain-system-50)', 500: 'var(--color-domain-system-500)', 600: 'var(--color-domain-system-600)', 700: 'var(--color-domain-system-700)' },
          reports: { 50: 'var(--color-domain-reports-50)', 500: 'var(--color-domain-reports-500)', 600: 'var(--color-domain-reports-600)', 700: 'var(--color-domain-reports-700)' },
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
