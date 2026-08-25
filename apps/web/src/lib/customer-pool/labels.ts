/**
 * FRT-03 — Customer Pool 前端展示标签与动作冲突判定（纯函数，可单测）
 *
 * - 展示标签：scope / 条目状态 / 入池方式 / 客户类型（与后端枚举一一对应，禁止前端自造）。
 * - isPoolActionConflict：claim / release / 手工入池的 409 冲突判定。
 *   409 业务冲突（POOL_CLAIM_CONFLICT / POOL_ENTRY_NOT_CLAIMABLE / CUSTOMER_ALREADY_*
 *   等）意味着服务端状态已变更（并发被他人挑入、已在池等）——前端必须展示后端真实
 *   业务提示并刷新列表，禁止把技术失败伪装成合法空态。
 */
import type { ApiClientError } from "@/lib/api-client";

export const POOL_SCOPE_LABELS: Record<string, string> = {
  GLOBAL: "全局",
  REGION: "区域",
  DEPARTMENT: "部门",
};

export const POOL_ENTRY_STATUS_LABELS: Record<string, string> = {
  IN_POOL: "在公海",
  CLAIMED: "已被挑入",
  RELEASED: "已移出",
};

export const POOL_ENTER_REASON_LABELS: Record<string, string> = {
  MANUAL: "手工",
  FIELD_RULE: "规则自动",
  RE_ENTER: "重新入池",
};

export const PARTNER_TYPE_LABELS: Record<string, string> = {
  CUSTOMER: "客户",
  SUPPLIER: "供应商",
  BOTH: "客户兼供应商",
};

/** 409 冲突码（claim/release/手工入池）：服务端状态已变更 → 需展示真实业务提示并刷新 */
const POOL_ACTION_CONFLICT_CODES = new Set([
  "POOL_CLAIM_CONFLICT",
  "POOL_ENTRY_NOT_CLAIMABLE",
  "CUSTOMER_ALREADY_OWNED",
  "CUSTOMER_ALREADY_IN_POOL",
]);

/** 是否为公海动作（claim/release/手工入池）的业务冲突（409）；非 409 的 400 校验错误不算 */
export function isPoolActionConflict(err: ApiClientError | null | undefined): boolean {
  if (!err || err.status !== 409 || !err.code) return false;
  return POOL_ACTION_CONFLICT_CODES.has(err.code);
}
