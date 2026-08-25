import { describe, it, expect } from "vitest";
import { ApiClientError } from "@/lib/api-client";
import {
  isPoolActionConflict,
  POOL_ENTER_REASON_LABELS,
  POOL_SCOPE_LABELS,
  POOL_ENTRY_STATUS_LABELS,
} from "@/lib/customer-pool/labels";

describe("customer-pool labels", () => {
  it("FIELD_RULE 入池方式展示为「规则自动」（FRT-03 #5）", () => {
    expect(POOL_ENTER_REASON_LABELS.FIELD_RULE).toBe("规则自动");
    expect(POOL_ENTER_REASON_LABELS.MANUAL).toBe("手工");
  });

  it("scope/状态标签与后端枚举一一对应", () => {
    expect(POOL_SCOPE_LABELS).toMatchObject({ GLOBAL: "全局", REGION: "区域", DEPARTMENT: "部门" });
    expect(POOL_ENTRY_STATUS_LABELS).toMatchObject({ IN_POOL: "在公海", CLAIMED: "已被挑入", RELEASED: "已移出" });
  });

  describe("isPoolActionConflict（FRT-03 #7：并发 claim 409 显示真实业务提示）", () => {
    it("POOL_CLAIM_CONFLICT 409 → true（并发双 claim 撞唯一约束）", () => {
      expect(isPoolActionConflict(new ApiClientError(409, "该客户已有有效归属（并发冲突）", "POOL_CLAIM_CONFLICT"))).toBe(true);
    });

    it("POOL_ENTRY_NOT_CLAIMABLE 409 → true（他人已挑入，条目不再 IN_POOL）", () => {
      expect(isPoolActionConflict(new ApiClientError(409, "条目不在可挑入状态（非 IN_POOL）", "POOL_ENTRY_NOT_CLAIMABLE"))).toBe(true);
    });

    it("CUSTOMER_ALREADY_IN_POOL / CUSTOMER_ALREADY_OWNED 409 → true（手工入池冲突）", () => {
      expect(isPoolActionConflict(new ApiClientError(409, "该客户已在公海中（存在有效条目）", "CUSTOMER_ALREADY_IN_POOL"))).toBe(true);
      expect(isPoolActionConflict(new ApiClientError(409, "该客户已有有效归属，不能入池", "CUSTOMER_ALREADY_OWNED"))).toBe(true);
    });

    it("非 409（400 校验/500 系统/网络 0）→ false", () => {
      expect(isPoolActionConflict(new ApiClientError(400, "客户区域与公海 scope 不匹配", "POOL_ENTRY_NOT_ALLOWED"))).toBe(false);
      expect(isPoolActionConflict(new ApiClientError(500, "系统错误", undefined))).toBe(false);
      expect(isPoolActionConflict(new ApiClientError(0, "网络错误", "NETWORK_ERROR"))).toBe(false);
      expect(isPoolActionConflict(null)).toBe(false);
    });
  });
});
