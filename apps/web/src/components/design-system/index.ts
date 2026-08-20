/**
 * Design System — 统一出口（F2-1 UI System Foundation）
 *
 * 业务页面 / Workspace primitives 只从这里消费设计令牌，
 * 禁止直接在页面里散落一套颜色/间距/圆角常量。
 */
export {
  TYPOGRAPHY,
  SPACING,
  RADIUS,
  BORDER,
  ELEVATION,
  SEMANTIC_COLORS,
  STATUS_COLORS,
  FORM_DENSITY,
  TABLE_DENSITY,
  BREAKPOINTS,
  CONTROL_CLASS,
  MODULE_ACCENTS,
  MODULE_ACCENT_MAP,
  MOTION,
} from './tokens';

export type { StatusTone, Density, ModuleAccent } from './tokens';
