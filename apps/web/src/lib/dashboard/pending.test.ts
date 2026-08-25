import { describe, expect, it } from "vitest";
import { buildPendingWork, PENDING_WORK_SOURCES } from "./pending";

describe("buildPendingWork — 真实数据源投影待处理工作", () => {
  it("数据源不可用（权限/API 缺失）→ 直接剔除，不显示假入口", () => {
    const items = buildPendingWork(PENDING_WORK_SOURCES, {
      "pending-sales-orders": { count: 3, available: false },
      "pending-expenses": { count: 1, available: false },
    });
    expect(items).toEqual([]);
  });

  it("可用且 count>0 → warning 语义；count=0 → neutral", () => {
    const items = buildPendingWork(PENDING_WORK_SOURCES, {
      "pending-sales-orders": { count: 3, available: true },
      "pending-expenses": { count: 0, available: true },
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ key: "pending-sales-orders", count: 3, tone: "warning" });
    expect(items[1]).toMatchObject({ key: "pending-expenses", count: 0, tone: "neutral" });
  });

  it("只保留可用的数据源（部分不可用时不清空其余）", () => {
    const items = buildPendingWork(PENDING_WORK_SOURCES, {
      "pending-expenses": { count: 5, available: true },
    });
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe("pending-expenses");
    expect(items[0].route).toBe("/expenses");
  });
});
