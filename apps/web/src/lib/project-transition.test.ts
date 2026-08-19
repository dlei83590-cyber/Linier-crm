import { describe, it, expect } from "vitest";
import { isLegalTransition, getAllowedProjectTransitions, STAGE_ORDER } from "@/lib/project-transition";

/**
 * Project Lifecycle 契约单测（CTO P2 G-1，对齐 P0-1 先例）
 * 覆盖：isLegalTransition 正向/倒退/跳级/PAUSED/FAILED/CLOSED 全路径 + getAllowedProjectTransitions 候选投影。
 * 验证事实源 = GitHub CI（本地不运行测试）。
 */

describe("isLegalTransition — 阶段流转规则（CTO #3C5）", () => {
  it("正向推进：仅下一步合法", () => {
    expect(isLegalTransition("LEAD", "QUALIFIED")).toBe(true);
    expect(isLegalTransition("QUALIFIED", "SOLUTION")).toBe(true);
    expect(isLegalTransition("SOLUTION", "QUOTATION")).toBe(true);
    expect(isLegalTransition("QUOTATION", "SAMPLING")).toBe(true);
    expect(isLegalTransition("SAMPLING", "TESTING")).toBe(true);
    expect(isLegalTransition("TESTING", "SMALL_BATCH")).toBe(true);
    expect(isLegalTransition("SMALL_BATCH", "MASS_SUPPLY")).toBe(true);
  });

  it("跳级禁止", () => {
    expect(isLegalTransition("LEAD", "SOLUTION")).toBe(false);
    expect(isLegalTransition("QUALIFIED", "SAMPLING")).toBe(false);
    expect(isLegalTransition("SAMPLING", "MASS_SUPPLY")).toBe(false);
    expect(isLegalTransition("LEAD", "MASS_SUPPLY")).toBe(false);
  });

  it("倒退禁止（MASS_SUPPLY 不能回 SMALL_BATCH）", () => {
    expect(isLegalTransition("MASS_SUPPLY", "SMALL_BATCH")).toBe(false);
    expect(isLegalTransition("TESTING", "SAMPLING")).toBe(false);
  });

  it("from === to 内部兼容（API 层 CLOSED gate / 候选投影排除自环）", () => {
    expect(isLegalTransition("SAMPLING", "SAMPLING")).toBe(true);
    expect(isLegalTransition("CLOSED", "CLOSED")).toBe(true);
  });

  it("任意阶段 → PAUSED / FAILED 合法", () => {
    expect(isLegalTransition("LEAD", "PAUSED")).toBe(true);
    expect(isLegalTransition("MASS_SUPPLY", "PAUSED")).toBe(true);
    expect(isLegalTransition("SAMPLING", "FAILED")).toBe(true);
    expect(isLegalTransition("MASS_SUPPLY", "FAILED")).toBe(true);
  });

  it("PAUSED 可恢复：→ 结项/失败/正向链任意阶段", () => {
    expect(isLegalTransition("PAUSED", "FAILED")).toBe(true);
    expect(isLegalTransition("PAUSED", "CLOSED")).toBe(true);
    expect(isLegalTransition("PAUSED", "QUALIFIED")).toBe(true);
    expect(isLegalTransition("PAUSED", "MASS_SUPPLY")).toBe(true);
    for (const s of STAGE_ORDER) expect(isLegalTransition("PAUSED", s)).toBe(true);
  });

  it("→ CLOSED：仅 MASS_SUPPLY / FAILED（PAUSED 已由恢复分支处理）", () => {
    expect(isLegalTransition("MASS_SUPPLY", "CLOSED")).toBe(true);
    expect(isLegalTransition("FAILED", "CLOSED")).toBe(true);
    expect(isLegalTransition("QUALIFIED", "CLOSED")).toBe(false);
    expect(isLegalTransition("SAMPLING", "CLOSED")).toBe(false);
    expect(isLegalTransition("LEAD", "CLOSED")).toBe(false);
  });

  it("FAILED 不可恢复为正向链（仅 PAUSED 可恢复）", () => {
    expect(isLegalTransition("FAILED", "MASS_SUPPLY")).toBe(false);
    expect(isLegalTransition("FAILED", "SAMPLING")).toBe(false);
  });

  it("CLOSED → 任意：API 层 CLOSED gate 兜底（transition route 锁后显式 409）", () => {
    // isLegalTransition 对 to=PAUSED/FAILED 返回 true（from 未检查），但 transition route 在锁后 + version CAS 后显式封死 CLOSED → 409
    expect(isLegalTransition("CLOSED", "PAUSED")).toBe(true);
    expect(isLegalTransition("CLOSED", "FAILED")).toBe(true);
    expect(isLegalTransition("CLOSED", "MASS_SUPPLY")).toBe(false);
  });
});

describe("getAllowedProjectTransitions — L2-B0 read projection 候选", () => {
  it("CLOSED 恒空（结项后禁止任何 stage mutation）", () => {
    expect(getAllowedProjectTransitions("CLOSED")).toEqual([]);
  });

  it("SAMPLING：正向 TESTING + 暂停/失败（排除 CLOSED 与自环）", () => {
    expect(getAllowedProjectTransitions("SAMPLING")).toEqual(["TESTING", "PAUSED", "FAILED"]);
  });

  it("MASS_SUPPLY：可暂停/失败（CLOSED 走 close 入口，不暴露为 transition 候选）", () => {
    expect(getAllowedProjectTransitions("MASS_SUPPLY")).toEqual(["PAUSED", "FAILED"]);
  });

  it("PAUSED：恢复正向链全部 + 失败（排除自身与 CLOSED）", () => {
    expect(getAllowedProjectTransitions("PAUSED")).toEqual([...STAGE_ORDER, "FAILED"]);
  });

  it("FAILED：仅可暂停（CLOSED 排除；恢复需 PAUSED 路径）", () => {
    expect(getAllowedProjectTransitions("FAILED")).toEqual(["PAUSED"]);
  });
});