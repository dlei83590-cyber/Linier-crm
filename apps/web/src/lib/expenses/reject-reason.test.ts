import { describe, it, expect } from "vitest";
import { validateRejectReason, REJECT_REASON_MAX_LENGTH } from "@/lib/expenses/reject-reason";

/**
 * FE2.0 UI-10 — 报销驳回原因校验（替换 window.prompt 后的唯一前端校验事实，
 * 与 POST /api/expenses/:id/reject zod 契约对齐：1..500 且 trim 后非空）。
 */
describe("validateRejectReason（FE2.0 UI-10 驳回原因校验）", () => {
  it("空字符串 / 纯空格返回必填错误", () => {
    expect(validateRejectReason("")).toBe("驳回必须提供原因");
    expect(validateRejectReason("   ")).toBe("驳回必须提供原因");
  });

  it("正常原因通过校验", () => {
    expect(validateRejectReason("发票金额与报销金额不一致")).toBeNull();
    expect(validateRejectReason("  附件缺失，请补充  ")).toBeNull();
  });

  it("超过 500 字返回长度错误", () => {
    const tooLong = "长".repeat(REJECT_REASON_MAX_LENGTH + 1);
    expect(validateRejectReason(tooLong)).toBe(`驳回原因不能超过 ${REJECT_REASON_MAX_LENGTH} 字`);
  });

  it("恰好 500 字边界通过", () => {
    const boundary = "长".repeat(REJECT_REASON_MAX_LENGTH);
    expect(validateRejectReason(boundary)).toBeNull();
  });
});
