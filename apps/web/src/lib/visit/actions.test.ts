import { describe, it, expect } from "vitest";
import { resolveVisitRowAction, latestCheckin } from "@/lib/visit/actions";

describe("visit row action（UI-05 签到/签退入口判定，消费后端状态契约）", () => {
  it("PENDING → checkin（无签到明细）", () => {
    expect(resolveVisitRowAction({ status: "PENDING", checkins: [] })).toBe("checkin");
  });

  it("COMPLETED 且有未签退签到 → checkout", () => {
    expect(
      resolveVisitRowAction({
        status: "COMPLETED",
        checkins: [{ checkinAt: "2026-09-09T01:00:00Z", checkoutAt: null }],
      }),
    ).toBe("checkout");
  });

  it("COMPLETED 且全部已签退 → null（不再出现签退入口）", () => {
    expect(
      resolveVisitRowAction({
        status: "COMPLETED",
        checkins: [{ checkinAt: "2026-09-09T01:00:00Z", checkoutAt: "2026-09-09T03:00:00Z" }],
      }),
    ).toBe(null);
  });

  it("未知状态 → null（不渲染假按钮）", () => {
    expect(resolveVisitRowAction({ status: "CANCELLED", checkins: [] })).toBe(null);
  });

  it("latestCheckin 返回最后一条签到（含签退信息）；空数组 → null", () => {
    const checkins = [
      { checkinAt: "2026-09-08T01:00:00Z", checkoutAt: "2026-09-08T02:00:00Z" },
      { checkinAt: "2026-09-09T01:00:00Z", checkoutAt: null },
    ];
    expect(latestCheckin(checkins)?.checkinAt).toBe("2026-09-09T01:00:00Z");
    expect(latestCheckin([])).toBeNull();
  });
});
