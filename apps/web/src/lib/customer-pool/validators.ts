/**
 * Phase 2C — Customer Pool 共享校验器（纯函数，可单测）
 *
 * 规则来源：ADR-0053 APPROVED + CTO OQ 裁决（Migration 0049）。
 * - OQ-1：REGION scopeValue = BusinessPartner.region 字符串 EQ/IN，不建字典。
 * - OQ-5：v1 无 approval workflow（Pool/Rule 仅 RBAC + version + Audit）。
 * - INACTIVITY 规则：Phase 3 Activity 提供权威 lastActivityAt 前禁止创建/启用（fail closed）。
 * - FIELD_MATCH condition 字段白名单：type / region / industry / sourceChannel / isActive；operator EQ|IN。
 */
import { ERROR_CODES, type ErrorCode } from "@/lib/api/errors";

export const POOL_RULE_FIELD_WHITELIST = ["type", "region", "industry", "sourceChannel", "isActive"] as const;
export const POOL_RULE_OPERATORS = ["EQ", "IN"] as const;

export interface PoolScopeValidation {
  ok: boolean;
  errorCode?: ErrorCode;
  message?: string;
}

export function validatePoolScope(scopeType: string, scopeValue: string | null | undefined): PoolScopeValidation {
  if (scopeType === "GLOBAL") {
    return scopeValue === null || scopeValue === undefined || scopeValue.trim() === ""
      ? { ok: true }
      : { ok: false, errorCode: ERROR_CODES.POOL_SCOPE_INVALID, message: "GLOBAL 公海不允许设置 scopeValue" };
  }
  if (scopeType === "REGION" || scopeType === "DEPARTMENT") {
    return scopeValue !== null && scopeValue !== undefined && scopeValue.trim().length > 0
      ? { ok: true }
      : { ok: false, errorCode: ERROR_CODES.POOL_SCOPE_INVALID, message: scopeType + " 公海必须提供 scopeValue" };
  }
  return { ok: false, errorCode: ERROR_CODES.POOL_SCOPE_INVALID, message: "scopeType 非法（GLOBAL|REGION|DEPARTMENT）" };
}

export interface RuleValidation {
  ok: boolean;
  errorCode?: ErrorCode;
  message?: string;
}

/**
 * 校验规则定义（创建/更新共用）。INACTIVITY 在 Phase 3 前一律拒绝（POOL_RULE_SOURCE_UNAVAILABLE）。
 */
export function validateRule(ruleType: string, matchMode: string, condition: unknown): RuleValidation {
  if (ruleType === "INACTIVITY") {
    return {
      ok: false,
      errorCode: ERROR_CODES.POOL_RULE_SOURCE_UNAVAILABLE,
      message: "INACTIVITY（无跟进 N 天自动入池）规则在 Phase 3 CRM Activity 落地前禁用（无 lastActivityAt 事实源）",
    };
  }
  if (ruleType !== "FIELD_MATCH") {
    return { ok: false, errorCode: ERROR_CODES.POOL_RULE_INVALID, message: "ruleType 非法（Phase 2C 仅 FIELD_MATCH 可用）" };
  }
  if (matchMode !== "ALL" && matchMode !== "ANY") {
    return { ok: false, errorCode: ERROR_CODES.POOL_RULE_INVALID, message: "matchMode 非法（ALL|ANY）" };
  }
  if (!Array.isArray(condition) || condition.length === 0) {
    return { ok: false, errorCode: ERROR_CODES.POOL_RULE_INVALID, message: "condition 必须为非空数组（[{ field, operator, value }]）" };
  }
  for (const item of condition) {
    if (item === null || typeof item !== "object") {
      return { ok: false, errorCode: ERROR_CODES.POOL_RULE_INVALID, message: "condition 项必须为对象" };
    }
    const it = item as Record<string, unknown>;
    if (typeof it.field !== "string" || !(POOL_RULE_FIELD_WHITELIST as readonly string[]).includes(it.field)) {
      return {
        ok: false,
        errorCode: ERROR_CODES.POOL_RULE_INVALID,
        message: "字段不在白名单（" + POOL_RULE_FIELD_WHITELIST.join("/") + "）",
      };
    }
    if (it.operator !== "EQ" && it.operator !== "IN") {
      return { ok: false, errorCode: ERROR_CODES.POOL_RULE_INVALID, message: "operator 仅支持 EQ|IN（禁止表达式/动态脚本）" };
    }
  }
  return { ok: true };
}

/** 客户公海入池资格：type 须 CUSTOMER/BOTH（CTO 自动入池约束 + 手工入池校验共用） */
export function isPartnerPoolEligible(type: string | null | undefined): boolean {
  return type === "CUSTOMER" || type === "BOTH";
}
