/**
 * UI 批次3 / FE 2.0 UI-01 — 统一控件类（单一来源；消费 F2-1 CONTROL_CLASS）
 * 页面应 import 本常量，禁止再自造 inputClass 字符串。
 *
 * UI-01：新增 ghost/danger/link 按钮类 + 尺寸类，与 components/ui/button.tsx 视觉对齐；
 * 旧常量（BUTTON_PRIMARY_CLASS 等 214 处消费）原样保留，向后兼容。
 */
import { CONTROL_CLASS } from '@/components/design-system';

/** 标准输入/选择框 */
export const INPUT_CLASS = CONTROL_CLASS;

/** 筛选控件（列表 Toolbar 用；与 INPUT_CLASS 视觉一致但不撑满——inline 自适应宽度） */
export const SELECT_CLASS =
  'rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-ink-primary placeholder:text-ink-muted focus:border-brand-500 focus:outline-none';

/** 主按钮（primary）—— 与 ui Button primary 对齐 */
export const BUTTON_PRIMARY_CLASS =
  'rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50';

/** 次按钮（secondary）—— 与 ui Button secondary 对齐 */
export const BUTTON_SECONDARY_CLASS =
  'rounded-md border border-border px-3 py-1.5 text-sm font-medium text-ink-secondary transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50';

/** 幽灵按钮（ghost）—— 与 ui Button ghost 对齐 */
export const BUTTON_GHOST_CLASS =
  'rounded-md px-3 py-1.5 text-sm font-medium text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink-primary disabled:cursor-not-allowed disabled:opacity-50';

/** 危险按钮（danger）—— 与 ui Button danger 对齐（Rose 语义） */
export const BUTTON_DANGER_CLASS =
  'rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50';

/** 链接按钮（link）—— 与 ui Button link 对齐 */
export const BUTTON_LINK_CLASS =
  'rounded text-sm font-medium text-brand-600 underline-offset-4 transition-colors hover:underline disabled:cursor-not-allowed disabled:opacity-50';

/** 按钮尺寸：sm（h-8） */
export const BUTTON_SM_CLASS = 'h-8 rounded-md px-2.5 text-xs';
/** 按钮尺寸：md（h-10，默认） */
export const BUTTON_MD_CLASS = 'h-10 rounded-md px-4 text-sm';
/** 按钮尺寸：lg（h-11） */
export const BUTTON_LG_CLASS = 'h-11 rounded-lg px-5 text-base';

/** 列表/详情页卡片容器 */
export const CARD_CLASS = 'rounded-xl border border-border bg-surface shadow-elevation-sm overflow-hidden';
