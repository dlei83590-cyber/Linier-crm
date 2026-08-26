import { describe, it, expect } from "vitest";
import {
  activityTypeMeta,
  activityStatusMeta,
  activityFollowUpLevelMeta,
} from "./activity-meta";

describe("activityTypeMeta — 活动类型展示元数据（FE 2.0）", () => {
  it("FOLLOW_UP → 跟进 / info / follow-up 图标", () => {
    const meta = activityTypeMeta("FOLLOW_UP");
    expect(meta.label).toBe("跟进");
    expect(meta.tone).toBe("info");
    expect(meta.icon).toBe("follow-up");
  });

  it("VISIT_PLAN → 拜访计划 / warning / visit-plan 图标", () => {
    const meta = activityTypeMeta("VISIT_PLAN");
    expect(meta.label).toBe("拜访计划");
    expect(meta.tone).toBe("warning");
    expect(meta.icon).toBe("visit-plan");
  });

  it("CHECK_IN → 签到 / success / check-in 图标", () => {
    const meta = activityTypeMeta("CHECK_IN");
    expect(meta.label).toBe("签到");
    expect(meta.tone).toBe("success");
    expect(meta.icon).toBe("check-in");
  });

  it("COMMENT / APPROVAL 派生事件有独立轻量图标", () => {
    expect(activityTypeMeta("COMMENT").icon).toBe("comment");
    expect(activityTypeMeta("APPROVAL").icon).toBe("approval");
  });

  it("未知类型 → 原值文案 + neutral（禁止静默吞掉未知 enum）", () => {
    const meta = activityTypeMeta("UNKNOWN_X");
    expect(meta.label).toBe("UNKNOWN_X");
    expect(meta.tone).toBe("neutral");
  });

  it("null/undefined → 回退跟进", () => {
    expect(activityTypeMeta(null).label).toBe("跟进");
    expect(activityTypeMeta(undefined).label).toBe("跟进");
  });
});

describe("activityStatusMeta — 跟进审批状态展示元数据（FE 2.0）", () => {
  const cases: Array<[string, string]> = [
    ["DRAFT", "待提交"],
    ["SUBMITTED", "待审批"],
    ["APPROVED", "已批准"],
    ["REJECTED", "已驳回"],
  ];
  it.each(cases)("%s → %s 文案 + 语义 tone", (status, label) => {
    const meta = activityStatusMeta(status);
    expect(meta).not.toBeNull();
    expect(meta!.label).toBe(label);
    expect(["neutral", "warning", "success", "danger"]).toContain(meta!.tone);
  });

  it("SUBMITTED → warning（待审批用警示色）", () => {
    expect(activityStatusMeta("SUBMITTED")!.tone).toBe("warning");
  });
  it("APPROVED → success / REJECTED → danger", () => {
    expect(activityStatusMeta("APPROVED")!.tone).toBe("success");
    expect(activityStatusMeta("REJECTED")!.tone).toBe("danger");
  });

  it("null（VISIT_PLAN/CHECK_IN 不参与审批）→ null（不渲染徽标）", () => {
    expect(activityStatusMeta(null)).toBeNull();
    expect(activityStatusMeta(undefined)).toBeNull();
  });
});

describe("activityFollowUpLevelMeta — 跟进程度展示元数据（followup-level，Migration 0055）", () => {
  it("BASIC → 普通跟进 / neutral", () => {
    expect(activityFollowUpLevelMeta("BASIC")).toEqual({ label: "普通跟进", tone: "neutral" });
  });
  it("IMPORTANT → 重点跟进 / warning", () => {
    expect(activityFollowUpLevelMeta("IMPORTANT")).toEqual({ label: "重点跟进", tone: "warning" });
  });
  it("DECISION → 决策推进 / danger", () => {
    expect(activityFollowUpLevelMeta("DECISION")).toEqual({ label: "决策推进", tone: "danger" });
  });
  it("未知程度 → 原值文案 + neutral（禁止静默吞掉未知 enum）", () => {
    expect(activityFollowUpLevelMeta("URGENT_X")).toEqual({ label: "URGENT_X", tone: "neutral" });
  });
  it("null/undefined（未分级）→ null（不渲染徽标）", () => {
    expect(activityFollowUpLevelMeta(null)).toBeNull();
    expect(activityFollowUpLevelMeta(undefined)).toBeNull();
  });
});
