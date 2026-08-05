import { describe, it, expect } from "vitest";
import {
  evaluateCondition,
  evaluateStepConditions,
  isStepComplete,
  isValidAction,
  isValidConditionOperator,
} from "@/lib/workflow/engine";

describe("workflow engine - evaluateCondition", () => {
  it("EQ: 数字相等", () => {
    expect(evaluateCondition({ field: "amount", operator: "EQ", value: "100000" }, { amount: 100000 })).toBe(true);
    expect(evaluateCondition({ field: "amount", operator: "EQ", value: "100000" }, { amount: 99999 })).toBe(false);
  });

  it("GT/GTE/LT/LTE: 数值比较", () => {
    expect(evaluateCondition({ field: "amount", operator: "GT", value: "100000" }, { amount: 150000 })).toBe(true);
    expect(evaluateCondition({ field: "amount", operator: "GT", value: "100000" }, { amount: 100000 })).toBe(false);
    expect(evaluateCondition({ field: "amount", operator: "GTE", value: "100000" }, { amount: 100000 })).toBe(true);
    expect(evaluateCondition({ field: "amount", operator: "LT", value: "100000" }, { amount: 50000 })).toBe(true);
    expect(evaluateCondition({ field: "amount", operator: "LTE", value: "100000" }, { amount: 100000 })).toBe(true);
  });

  it("IN/NOT_IN: 枚举包含", () => {
    expect(evaluateCondition({ field: "currency", operator: "IN", value: "CNY,USD" }, { currency: "USD" })).toBe(true);
    expect(evaluateCondition({ field: "currency", operator: "IN", value: "CNY,USD" }, { currency: "EUR" })).toBe(false);
    expect(evaluateCondition({ field: "currency", operator: "NOT_IN", value: "CNY,USD" }, { currency: "EUR" })).toBe(true);
  });

  it("CONTAINS: 字符串包含", () => {
    expect(evaluateCondition({ field: "name", operator: "CONTAINS", value: "急" }, { name: "紧急采购单" })).toBe(true);
    expect(evaluateCondition({ field: "name", operator: "CONTAINS", value: "急" }, { name: "普通采购单" })).toBe(false);
  });

  it("NEQ: 不相等", () => {
    expect(evaluateCondition({ field: "department", operator: "NEQ", value: "Sales" }, { department: "Eng" })).toBe(true);
  });

  it("未知操作符默认通过（安全兜底）", () => {
    expect(evaluateCondition({ field: "x", operator: "UNKNOWN", value: "1" }, { x: 1 })).toBe(true);
  });
});

describe("workflow engine - evaluateStepConditions", () => {
  it("无条件步骤恒通过", () => {
    expect(evaluateStepConditions([], { amount: 1 })).toBe(true);
    expect(evaluateStepConditions(null, { amount: 1 })).toBe(true);
    expect(evaluateStepConditions(undefined, { amount: 1 })).toBe(true);
  });

  it("多条件 AND 组合", () => {
    const conditions = [
      { field: "amount", operator: "GT", value: "100000" },
      { field: "department", operator: "EQ", value: "Sales" },
    ];
    expect(evaluateStepConditions(conditions, { amount: 200000, department: "Sales" })).toBe(true);
    expect(evaluateStepConditions(conditions, { amount: 200000, department: "Eng" })).toBe(false);
    expect(evaluateStepConditions(conditions, { amount: 50000, department: "Sales" })).toBe(false);
  });
});

describe("workflow engine - isStepComplete", () => {
  it("无审批人视为完成（防御空步骤）", () => {
    expect(isStepComplete("SEQUENTIAL", [])).toBe(true);
  });

  it("SEQUENTIAL: 全部通过才算完成", () => {
    expect(isStepComplete("SEQUENTIAL", [{ status: "APPROVED" }, { status: "APPROVED" }])).toBe(true);
    expect(isStepComplete("SEQUENTIAL", [{ status: "APPROVED" }, { status: "PENDING" }])).toBe(false);
  });

  it("PARALLEL: 会签全部通过", () => {
    expect(isStepComplete("PARALLEL", [{ status: "APPROVED" }, { status: "APPROVED" }])).toBe(true);
    expect(isStepComplete("PARALLEL", [{ status: "APPROVED" }, { status: "PENDING" }])).toBe(false);
  });

  it("ANY_ONE: 任一通过即完成", () => {
    expect(isStepComplete("ANY_ONE", [{ status: "APPROVED" }, { status: "PENDING" }])).toBe(true);
    expect(isStepComplete("ANY_ONE", [{ status: "PENDING" }, { status: "PENDING" }])).toBe(false);
  });

  it("COUNTERSIGN: 达到指定人数即完成", () => {
    expect(
      isStepComplete("COUNTERSIGN", [{ status: "APPROVED" }, { status: "PENDING" }], 2),
    ).toBe(false);
    expect(
      isStepComplete("COUNTERSIGN", [{ status: "APPROVED" }, { status: "APPROVED" }], 2),
    ).toBe(true);
    expect(isStepComplete("COUNTERSIGN", [{ status: "APPROVED" }], undefined)).toBe(false);
  });
});

describe("workflow engine - 白名单", () => {
  it("isValidAction: 统一动作白名单", () => {
    expect(isValidAction("APPROVE")).toBe(true);
    expect(isValidAction("REJECT")).toBe(true);
    expect(isValidAction("TRANSFER")).toBe(true);
    expect(isValidAction("DELEGATE")).toBe(true);
    expect(isValidAction("WITHDRAW")).toBe(true);
    expect(isValidAction("TERMINATE")).toBe(true);
    expect(isValidAction("COMMENT")).toBe(true);
    expect(isValidAction("DELETE")).toBe(false);
    expect(isValidAction("CUSTOM_ACTION")).toBe(false);
  });

  it("isValidConditionOperator: 操作符白名单", () => {
    expect(isValidConditionOperator("GT")).toBe(true);
    expect(isValidConditionOperator("IN")).toBe(true);
    expect(isValidConditionOperator("LIKE")).toBe(false);
  });
});
