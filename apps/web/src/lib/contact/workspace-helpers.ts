/**
 * 2A-2 联系人管理 Workspace 纯逻辑（供前端组件 + 单元测试消费）
 *
 * 关键契约（CTO Directive 2A-2）：
 * - 主联系人：前端只提交当前 contact isPrimary=true（不批量改其他联系人，排他事实由 Backend transaction + partial unique 权威保证）
 * - 编辑带 version（CAS）；409 走统一冲突交互，不静默覆盖
 * - 关系 target selector 排除自己 + 仅同 BusinessPartner 内（前端过滤 + Backend fail-closed 兜底）
 * - special-date recurrence 直接透传 Backend enum（NONE|YEARLY），不在前端重实现 nextOccurrence / 2-29
 */

export interface ContactFormValues {
  name: string;
  title?: string | null;
  department?: string | null;
  phone?: string | null;
  mobile?: string | null;
  email?: string | null;
  wechat?: string | null;
  contactNote?: string | null;
  isPrimary?: boolean;
}

const nullIfEmpty = (v: string | undefined | null): string | null =>
  v && v.trim() !== '' ? v.trim() : null;

/** 新建联系人 payload（POST /api/business-partners/:id/contacts） */
export function buildContactCreatePayload(v: ContactFormValues): Record<string, unknown> {
  return {
    name: v.name.trim(),
    title: nullIfEmpty(v.title),
    department: nullIfEmpty(v.department),
    phone: nullIfEmpty(v.phone),
    mobile: nullIfEmpty(v.mobile),
    email: nullIfEmpty(v.email),
    wechat: nullIfEmpty(v.wechat),
    contactNote: nullIfEmpty(v.contactNote),
    ...(v.isPrimary ? { isPrimary: true } : {}),
  };
}

/** 编辑联系人 payload（PATCH；带 version CAS） */
export function buildContactEditPayload(v: ContactFormValues, version: number): Record<string, unknown> {
  return {
    ...buildContactCreatePayload(v),
    version,
  };
}

/** 设为主联系人 payload：只提交当前 contact isPrimary=true（不批量改其他） */
export function buildSetPrimaryPayload(version: number): { version: number; isPrimary: true } {
  return { version, isPrimary: true };
}

/** 关系 target selector：排除自己（前端过滤；Backend CONTACT_RELATION_SELF/CROSS_PARTNER 兜底） */
export function excludeSelf<T extends { id: string }>(options: T[], selfId: string): T[] {
  return options.filter((o) => o.id !== selfId);
}

export interface SpecialDateFormValues {
  type: 'BIRTHDAY' | 'ANNIVERSARY' | 'OTHER';
  date: string; // YYYY-MM-DD
  recurrence?: 'NONE' | 'YEARLY';
  title?: string | null;
  remindDaysBefore?: number;
  reminderEnabled?: boolean;
}

/** 特殊日期 payload（recurrence 直接透传 Backend enum） */
export function buildSpecialDatePayload(v: SpecialDateFormValues): Record<string, unknown> {
  return {
    type: v.type,
    date: v.date,
    ...(v.recurrence ? { recurrence: v.recurrence } : {}),
    ...(nullIfEmpty(v.title) ? { title: v.title } : {}),
    remindDaysBefore: v.remindDaysBefore ?? 0,
    reminderEnabled: v.reminderEnabled ?? true,
  };
}
