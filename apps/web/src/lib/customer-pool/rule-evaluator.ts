/**
 * Phase 2C-2 — Customer Pool 规则评估器（纯确定性 matcher，可单测）
 *
 * CTO 裁决：
 * - 只支持 EQ / IN（禁止通用脚本/表达式/eval/动态 JS）
 * - 白名单字段：type / region / industry / sourceChannel / isActive
 * - type 必须 CUSTOMER/BOTH 且 deletedAt=null（否则不评估）
 * - 多池命中：priority 最高者获胜；同 priority → AMBIGUOUS（NO AUTO ENTRY，Audit + sweep conflict 标记）
 * - DEPARTMENT scope 池：无 BP 部门事实 → 自动评估跳过（仅支持手工入池）
 */
import type { RuleConditionItem } from "./validators";
import { isPartnerPoolEligible } from "./validators";

export interface PartnerPoolSnapshot {
  id: string;
  type: string | null;
  region: string | null;
  industry: string | null;
  sourceChannel: string | null;
  isActive: boolean;
  deletedAt: Date | null;
}

export interface ActivePoolRuleView {
  poolId: string;
  poolCode: string;
  poolName: string;
  poolScopeType: string;
  poolScopeValue: string | null;
  ruleId: string;
  ruleType: string;
  matchMode: "ALL" | "ANY";
  condition: RuleConditionItem[];
  priority: number;
}

export interface PoolMatch {
  poolId: string;
  poolCode: string;
  poolName: string;
  priority: number;
}

export type EvaluationOutcome =
  | { status: "NO_MATCH" }
  | { status: "MATCH"; winner: PoolMatch }
  | { status: "AMBIGUOUS"; ties: PoolMatch[] };

function fieldValue(snapshot: PartnerPoolSnapshot, field: string): unknown {
  switch (field) {
    case "type":
      return snapshot.type;
    case "region":
      return snapshot.region;
    case "industry":
      return snapshot.industry;
    case "sourceChannel":
      return snapshot.sourceChannel;
    case "isActive":
      return snapshot.isActive;
    default:
      return undefined; // 白名单外字段：评估器绝不读取（fail closed，validators 已拦截写入）
  }
}

function conditionMatch(snapshot: PartnerPoolSnapshot, cond: RuleConditionItem): boolean {
  const actual = fieldValue(snapshot, cond.field);
  if (cond.operator === "EQ") {
    return actual === cond.value;
  }
  if (cond.operator === "IN") {
    return Array.isArray(cond.value) && cond.value.includes(actual);
  }
  return false;
}

function ruleMatch(snapshot: PartnerPoolSnapshot, rule: ActivePoolRuleView): boolean {
  if (rule.ruleType !== "FIELD_MATCH") return false; // INACTIVITY 不应存在（validators 拦截）；防御跳过
  if (rule.poolScopeType === "DEPARTMENT") return false; // 无 BP 部门事实 → 自动评估跳过
  if (rule.poolScopeType === "REGION" && snapshot.region !== rule.poolScopeValue) return false;
  const results = rule.condition.map((c) => conditionMatch(snapshot, c));
  return rule.matchMode === "ALL" ? results.every(Boolean) : results.some(Boolean);
}

/**
 * 纯确定性评估：输入客户快照 + 激活规则视图 → NO_MATCH | MATCH(winner) | AMBIGUOUS(ties)
 */
export function evaluateCustomerPoolRules(
  snapshot: PartnerPoolSnapshot,
  rules: ActivePoolRuleView[],
): EvaluationOutcome {
  // 前置：type CUSTOMER/BOTH 且 deletedAt=null（CTO 约束）
  if (!isPartnerPoolEligible(snapshot.type) || snapshot.deletedAt !== null) {
    return { status: "NO_MATCH" };
  }

  const hits: PoolMatch[] = [];
  for (const rule of rules) {
    if (!ruleMatch(snapshot, rule)) continue;
    hits.push({
      poolId: rule.poolId,
      poolCode: rule.poolCode,
      poolName: rule.poolName,
      priority: rule.priority,
    });
  }

  if (hits.length === 0) return { status: "NO_MATCH" };

  const maxPriority = Math.max(...hits.map((h) => h.priority));
  const top = hits.filter((h) => h.priority === maxPriority);
  if (top.length === 1) return { status: "MATCH", winner: top[0] };
  return { status: "AMBIGUOUS", ties: top };
}
