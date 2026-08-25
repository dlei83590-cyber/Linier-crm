import { describe, it, expect } from "vitest";
import { buildPoolListParams, poolListHasFilter } from "@/lib/customer-pool/filters";

describe("customer-pool list filters（UI-05 列表筛选 → API 参数）", () => {
  it("空筛选 → 全部 undefined（不发空参数）", () => {
    expect(buildPoolListParams({})).toEqual({});
    expect(buildPoolListParams({ code: "", name: "  ", scopeType: "", isActive: "" })).toEqual({});
  });

  it("有效值透传；code/name trim 前后空格", () => {
    expect(
      buildPoolListParams({ code: "  POOL-01 ", name: " 华东公海 ", scopeType: "REGION", isActive: "true" }),
    ).toEqual({ code: "POOL-01", name: "华东公海", scopeType: "REGION", isActive: "true" });
  });

  it("scopeType/isActive 空串 → undefined", () => {
    expect(buildPoolListParams({ scopeType: "", isActive: "" })).toEqual({});
  });

  it("poolListHasFilter 只在存在真实筛选时为 true", () => {
    expect(poolListHasFilter({ code: "  ", name: "" })).toBe(false);
    expect(poolListHasFilter({ isActive: "false" })).toBe(true);
    expect(poolListHasFilter({ scopeType: "DEPARTMENT" })).toBe(true);
  });
});
