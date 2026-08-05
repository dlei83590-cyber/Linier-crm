import type { Prisma } from "@prisma/client";

/**
 * Sprint 3A - Workflow Engine（工作流执行引擎，纯函数 + 可单测）
 * 规则：
 *  - 条件评估：结构化 field/operator/value（不存 JSON 表达式）
 *  - 审批模式：SEQUENTIAL(串签) / PARALLEL(会签全签) / ANY_ONE(或签) / COUNTERSIGN(会签人数)
 *  - 动作统一：SUBMIT/APPROVE/REJECT/RETURN/TRANSFER/DELEGATE/WITHDRAW/TERMINATE/COMMENT
 */

export type ConditionLike = {
  field: string;
  operator: string;
  value: string;
};

/** 条件操作符白名单（与 schema 枚举一致） */
export const CONDITION_OPERATORS = ["EQ", "NEQ", "GT", "GTE", "LT", "LTE", "IN", "NOT_IN", "CONTAINS"] as const;

/** 统一动作白名单 */
export const WORKFLOW_ACTIONS = [
  "SUBMIT",
  "APPROVE",
  "REJECT",
  "RETURN",
  "TRANSFER",
  "DELEGATE",
  "WITHDRAW",
  "TERMINATE",
  "COMMENT",
] as const;

/** 比较值解析：数字尝试转 number */
function toComparable(value: unknown): number | string {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (value.trim() !== "" && Number.isFinite(n)) return n;
    return value;
  }
  return String(value ?? "");
}

/** 单条条件评估（纯函数） */
export function evaluateCondition(condition: ConditionLike, payload: Record<string, unknown>): boolean {
  const actual = toComparable(payload[condition.field]);
  const expected = toComparable(condition.value);

  switch (condition.operator) {
    case "EQ":
      return actual === expected;
    case "NEQ":
      return actual !== expected;
    case "GT":
      return typeof actual === "number" && typeof expected === "number" && actual > expected;
    case "GTE":
      return typeof actual === "number" && typeof expected === "number" && actual >= expected;
    case "LT":
      return typeof actual === "number" && typeof expected === "number" && actual < expected;
    case "LTE":
      return typeof actual === "number" && typeof expected === "number" && actual <= expected;
    case "IN": {
      const list = condition.value
        .split(",")
        .map((v) => toComparable(v.trim()))
        .filter((v) => v !== "");
      return list.includes(actual);
    }
    case "NOT_IN": {
      const list = condition.value
        .split(",")
        .map((v) => toComparable(v.trim()))
        .filter((v) => v !== "");
      return !list.includes(actual);
    }
    case "CONTAINS":
      return String(actual).includes(String(expected));
    default:
      return true;
  }
}

/** 步骤条件组评估（默认 AND 组合；expression 字段预留，暂不支持复杂布尔） */
export function evaluateStepConditions(
  conditions: ConditionLike[] | undefined | null,
  payload: Record<string, unknown>,
): boolean {
  if (!conditions || conditions.length === 0) return true;
  return conditions.every((c) => evaluateCondition(c, payload));
}

/**
 * 判断步骤是否完成（按审批模式）：
 *  - SEQUENTIAL / PARALLEL / COUNTERSIGN：全部审批人通过才算完成
 *  - ANY_ONE：任一审批人通过即完成
 */
export function isStepComplete(
  approvalMode: string,
  approvers: { status: string }[],
  countersignCount?: number,
): boolean {
  if (approvers.length === 0) return true;
  if (approvalMode === "ANY_ONE") {
    return approvers.some((a) => a.status === "APPROVED");
  }
  if (approvalMode === "COUNTERSIGN" && countersignCount && countersignCount > 0) {
    const approved = approvers.filter((a) => a.status === "APPROVED").length;
    return approved >= countersignCount;
  }
  return approvers.every((a) => a.status === "APPROVED");
}

/** 校验动作是否在统一白名单内 */
export function isValidAction(action: string): boolean {
  return (WORKFLOW_ACTIONS as readonly string[]).includes(action);
}

/** 校验条件操作符是否在白名单内 */
export function isValidConditionOperator(operator: string): boolean {
  return (CONDITION_OPERATORS as readonly string[]).includes(operator);
}

/** Prisma 事务内解析步骤审批人（approverType: USER/ROLE/DEPARTMENT/APPROVER_GROUP） */
export async function resolveStepApprovers(
  tx: Prisma.TransactionClient,
  approverType: string,
  approverValue: string | null | undefined,
): Promise<string[]> {
  if (!approverValue) return [];
  switch (approverType) {
    case "USER":
      return [approverValue];
    case "ROLE": {
      const rows = await tx.userRole.findMany({
        where: { role: { code: approverValue } },
        select: { userId: true },
      });
      return rows.map((r) => r.userId);
    }
    case "DEPARTMENT": {
      const dept = await tx.department.findFirst({
        where: { OR: [{ id: approverValue }, { code: approverValue }] },
        select: { id: true },
      });
      if (!dept) return [];
      const rows = await tx.user.findMany({
        where: { departmentId: dept.id, isActive: true },
        select: { id: true },
      });
      return rows.map((u) => u.id);
    }
    case "APPROVER_GROUP": {
      const rows = await tx.approverGroupMember.findMany({
        where: { group: { code: approverValue } },
        select: { userId: true },
      });
      return rows.map((m) => m.userId);
    }
    default:
      return [];
  }
}
