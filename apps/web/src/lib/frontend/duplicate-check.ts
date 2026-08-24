/**
 * Phase 2B — BusinessPartner 新建页查重前端逻辑层（纯函数，可单测）
 *
 * 覆盖 CTO §J UI 行为：EXACT 阻断 / POTENTIAL 确认后携带 duplicateAcknowledged / stale 防护。
 * 查重 API 结果为 NONE 不代表创建授权 token——保存前仍由 Server Guard 最终裁决（CTO §J）。
 */
export interface DuplicateMatchView {
  id: string;
  code: string;
  name: string;
  type: string;
  isActive: boolean;
  isDeleted: boolean;
  phoneMasked: string | null;
  usccMasked: string | null;
  matchReasons: string[];
  level: 'EXACT' | 'POTENTIAL';
}

export interface DuplicateCheckView {
  duplicateLevel: 'EXACT' | 'POTENTIAL' | 'NONE';
  matches: DuplicateMatchView[];
}

export type DuplicateLevel = 'EXACT' | 'POTENTIAL' | 'NONE';

export const DUPLICATE_REASON_LABELS: Record<string, string> = {
  USCC_EXACT: '统一社会信用代码完全一致',
  USCC_EXACT_DELETED: '已存在已归档/删除的同一主体（USCC 一致），请恢复或处理原主体，不能重复新建',
  NAME_EXACT: '企业名称完全一致',
  PARTNER_PHONE_EXACT: '企业电话完全一致',
  CONTACT_PHONE_EXACT: '联系人电话完全一致',
  CONTACT_MOBILE_EXACT: '联系人手机完全一致',
};

export function duplicateReasonLabel(reason: string): string {
  return DUPLICATE_REASON_LABELS[reason] ?? reason;
}

export interface DuplicateUiState {
  /** EXACT：提交阻断（acknowledgement 不能解除） */
  blocking: boolean;
  /** POTENTIAL：显示 warning card */
  warning: boolean;
  /** 用户已显式确认（仅 POTENTIAL 有意义；随创建请求携带 duplicateAcknowledged=true） */
  confirmed: boolean;
  /** 是否有卡片需要展示（NONE/未查 → false，不打扰用户） */
  visible: boolean;
}

export function computeDuplicateUiState(
  level: DuplicateLevel | undefined,
  acknowledged: boolean,
): DuplicateUiState {
  if (level === 'EXACT') return { blocking: true, warning: false, confirmed: acknowledged, visible: true };
  if (level === 'POTENTIAL') return { blocking: false, warning: true, confirmed: acknowledged, visible: true };
  return { blocking: false, warning: false, confirmed: false, visible: false };
}

/** stale 防护：旧序号响应不得覆盖新输入产生的新结果 */
export function isStaleDuplicateResult(seq: number, latestSeq: number): boolean {
  return seq < latestSeq;
}

/** 任一关键字段（name/uscc/phone）非空才触发查重 */
export function shouldRunDuplicateCheck(name: string, uscc: string, phone: string): boolean {
  return name.trim().length > 0 || uscc.trim().length > 0 || phone.trim().length > 0;
}

/** POTENTIAL 确认后随创建请求携带 request-level duplicateAcknowledged */
export function withAcknowledgment<T extends Record<string, unknown>>(
  payload: T,
  acknowledged: boolean,
): T & { duplicateAcknowledged?: boolean } {
  return acknowledged ? { ...payload, duplicateAcknowledged: true } : payload;
}
