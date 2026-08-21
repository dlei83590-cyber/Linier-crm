/**
 * Design System — Design Tokens（F2-1 UI System Foundation）
 *
 * 唯一视觉令牌来源：Typography / Spacing / Radius / Border / Elevation /
 * Semantic Color / Status Color / Form Density / Table Density / Responsive Breakpoint。
 *
 * 规则（CTO Frontend Full UI Productization）：
 * - 业务页面禁止自行组合一套视觉规范；取值以本文件 + apps/web/tailwind.config.ts 为准。
 * - Tailwind 侧语义类（bg-canvas / text-ink-primary / status-* / shadow-elevation-*）与本文件一一对应。
 * - Status 色为语义三元组（bg/text/border），只做状态展示，禁止跨状态语义压缩（如 APPROVED→"完成"）。
 */

// ===== Typography =====
export const TYPOGRAPHY = {
  sizes: {
    xs: '0.75rem',
    sm: '0.875rem',
    base: '1rem',
    lg: '1.125rem',
    xl: '1.25rem',
    '2xl': '1.5rem',
  },
  weights: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
} as const;

// ===== Spacing（语义别名，与 Tailwind 默认 scale 对齐）=====
export const SPACING = {
  xs: '0.5rem', // 8px
  sm: '0.75rem', // 12px
  md: '1rem', // 16px
  lg: '1.5rem', // 24px
  xl: '2rem', // 32px
  '2xl': '2.5rem', // 40px
} as const;

// ===== Radius =====
export const RADIUS = {
  sm: '0.375rem',
  md: '0.5rem',
  lg: '0.75rem',
  full: '9999px',
} as const;

// ===== Border =====
export const BORDER = {
  width: {
    default: '1px',
    strong: '2px',
  },
  color: {
    default: '#e2e8f0',
    strong: '#cbd5e1',
    focus: '#3b82f6',
  },
} as const;

// ===== Elevation =====
export const ELEVATION = {
  sm: '0 1px 2px 0 rgb(15 23 42 / 0.05)',
  md: '0 4px 6px -1px rgb(15 23 42 / 0.08), 0 2px 4px -2px rgb(15 23 42 / 0.05)',
  lg: '0 10px 15px -3px rgb(15 23 42 / 0.1), 0 4px 6px -4px rgb(15 23 42 / 0.05)',
} as const;

// ===== Semantic Color（语义色）=====
export const SEMANTIC_COLORS = {
  canvas: '#f8fafc', // 页面背景
  surface: '#ffffff', // 卡片 / 表单表面
  border: '#e2e8f0', // 默认边框
  borderStrong: '#cbd5e1',
  inkPrimary: '#0f172a', // 主文本
  inkSecondary: '#475569', // 次级文本
  inkMuted: '#94a3b8', // 弱化文本 / 占位
  brand: '#2563eb', // 主操作色
  brandHover: '#1d4ed8',
} as const;

// ===== Status Color（状态色：语义三元组）=====
export const STATUS_COLORS = {
  neutral: { bg: '#f1f5f9', text: '#475569', border: '#e2e8f0' },
  info: { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' },
  success: { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' },
  warning: { bg: '#fffbeb', text: '#b45309', border: '#fde68a' },
  danger: { bg: '#fef2f2', text: '#b91c1c', border: '#fecaca' },
} as const;

export type StatusTone = keyof typeof STATUS_COLORS;

// ===== Form Density（表单密度）=====
export const FORM_DENSITY = {
  compact: { height: '2rem', paddingX: '0.625rem', fontSize: '0.875rem' },
  default: { height: '2.5rem', paddingX: '0.75rem', fontSize: '0.875rem' },
} as const;

export type Density = keyof typeof FORM_DENSITY;

// ===== Table Density（表格密度）=====
export const TABLE_DENSITY = {
  compact: { cellPaddingY: '0.375rem', fontSize: '0.8125rem' },
  default: { cellPaddingY: '0.625rem', fontSize: '0.875rem' },
} as const;

// ===== Responsive Breakpoint =====
export const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;

// ===== 通用表单控件 class（供 ReferenceSelector / LineEditor 等复用）=====
/** 标准输入/选择控件外观（对齐 FORM_DENSITY.default） */
export const CONTROL_CLASS =
  'w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-ink-primary placeholder:text-ink-muted focus:border-brand-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-ink-muted';
// ===== Module Accent（Sprint8 UI Modern — 10 业务域高饱和色板，单一事实来源：tailwind domain-* 类）=====
export interface ModuleAccent {
  id: string;
  label: string;
  /** 主色（600 档，用于指示条/文字/色点） */
  color: string;
  /** 浅底（50 档，用于激活底色/图标底） */
  soft: string;
  /** 深色（700 档，用于 hover/强调） */
  strong: string;
}

export const MODULE_ACCENTS: ReadonlyArray<ModuleAccent> = [
  { id: 'workbench', label: '工作台', color: '#2563eb', soft: '#eff6ff', strong: '#1d4ed8' },
  { id: 'customer-project', label: '客户与项目', color: '#7c3aed', soft: '#f5f3ff', strong: '#6d28d9' },
  { id: 'sales', label: '销售管理', color: '#059669', soft: '#ecfdf5', strong: '#047857' },
  { id: 'purchasing', label: '采购管理', color: '#ea580c', soft: '#fff7ed', strong: '#c2410c' },
  { id: 'inventory', label: '库存管理', color: '#0891b2', soft: '#ecfeff', strong: '#0e7490' },
  { id: 'finance', label: '财务管理', color: '#e11d48', soft: '#fff1f2', strong: '#be123c' },
  { id: 'master-data', label: '基础资料', color: '#0284c7', soft: '#f0f9ff', strong: '#0369a1' },
  { id: 'system', label: '系统管理', color: '#475569', soft: '#f8fafc', strong: '#334155' },
  { id: 'reports', label: '分析与报表', color: '#c026d3', soft: '#fdf4ff', strong: '#a21caf' },
];

export const MODULE_ACCENT_MAP: Readonly<Record<string, ModuleAccent>> = MODULE_ACCENTS.reduce(
  (acc, a) => {
    acc[a.id] = a;
    return acc;
  },
  {} as Record<string, ModuleAccent>,
);

// ===== Motion（Sprint8 UI Modern — 动效令牌）=====
export const MOTION = {
  duration: { fast: '150ms', base: '200ms', slow: '300ms' } as const,
  easing: {
    standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
    in: 'cubic-bezier(0.4, 0, 1, 1)',
    out: 'cubic-bezier(0, 0, 0.2, 1)',
  } as const,
} as const;
