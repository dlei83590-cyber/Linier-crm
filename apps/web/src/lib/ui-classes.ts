/**
 * UI 批次3 — 统一控件类（单一来源；消费 F2-1 CONTROL_CLASS）
 * 页面应 import 本常量，禁止再自造 inputClass 字符串。
 */
import { CONTROL_CLASS } from '@/components/design-system';

/** 标准输入/选择框 */
export const INPUT_CLASS = CONTROL_CLASS;

/** 筛选控件（列表 Toolbar 用；与 INPUT_CLASS 视觉一致但不撑满——inline 自适应宽度） */
export const SELECT_CLASS =
  'rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-ink-primary placeholder:text-ink-muted focus:border-brand-500 focus:outline-none';

/** 主按钮（primary） */
export const BUTTON_PRIMARY_CLASS =
  'rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50';

/** 次按钮（secondary） */
export const BUTTON_SECONDARY_CLASS =
  'rounded-md border border-border px-3 py-1.5 text-sm font-medium text-ink-secondary transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';

/** 列表/详情页卡片容器 */
export const CARD_CLASS = 'rounded-xl border border-border bg-surface shadow-elevation-sm overflow-hidden';