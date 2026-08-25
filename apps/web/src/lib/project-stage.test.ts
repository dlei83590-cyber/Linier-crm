import { describe, it, expect } from "vitest";
import {
  PROJECT_STAGE_LABELS,
  PROJECT_STAGE_TONES,
  PROJECT_STAGE_OPTIONS,
  projectStageLabel,
  projectStageTone,
  PROJECT_PRIORITY_LABELS,
  PROJECT_PAYMENT_LABELS,
  PROJECT_ACCEPTANCE_RESULT_LABELS,
  PROJECT_ACCEPTANCE_TONES,
} from "@/lib/project-stage";

/**
 * UI-06 — 阶段/状态文案与语义色映射单测（纯展示层映射，不含业务判定）。
 * 验证事实源 = GitHub CI（本地不运行测试）。
 */

describe("PROJECT_STAGE_LABELS — 阶段文案映射（11 阶段全覆盖）", () => {
  it("覆盖全部阶段 code 且文案非空", () => {
    const stages = [
      "LEAD", "QUALIFIED", "SOLUTION", "QUOTATION", "SAMPLING", "TESTING",
      "SMALL_BATCH", "MASS_SUPPLY", "PAUSED", "FAILED", "CLOSED",
    ];
    for (const s of stages) {
      expect(PROJECT_STAGE_LABELS[s]).toBeTruthy();
      expect(PROJECT_STAGE_TONES[s]).toBeTruthy();
    }
  });

  it("关键阶段文案正确", () => {
    expect(PROJECT_STAGE_LABELS.LEAD).toBe("线索");
    expect(PROJECT_STAGE_LABELS.QUALIFIED).toBe("准入");
    expect(PROJECT_STAGE_LABELS.QUOTATION).toBe("报价");
    expect(PROJECT_STAGE_LABELS.SMALL_BATCH).toBe("小批量");
    expect(PROJECT_STAGE_LABELS.MASS_SUPPLY).toBe("批量供货");
    expect(PROJECT_STAGE_LABELS.PAUSED).toBe("暂停");
    expect(PROJECT_STAGE_LABELS.FAILED).toBe("失败");
    expect(PROJECT_STAGE_LABELS.CLOSED).toBe("结项");
  });
});

describe("PROJECT_STAGE_TONES — 阶段语义色映射", () => {
  it("终态 FAILED 为 danger、MASS_SUPPLY 为 success、PAUSED 为 warning", () => {
    expect(PROJECT_STAGE_TONES.FAILED).toBe("danger");
    expect(PROJECT_STAGE_TONES.MASS_SUPPLY).toBe("success");
    expect(PROJECT_STAGE_TONES.PAUSED).toBe("warning");
    expect(PROJECT_STAGE_TONES.QUOTATION).toBe("warning");
  });

  it("未知阶段回退 neutral", () => {
    expect(projectStageTone("UNKNOWN_STAGE")).toBe("neutral");
    expect(projectStageTone(null)).toBe("neutral");
  });
});

describe("projectStageLabel / projectStageTone — 兜底行为", () => {
  it("未知阶段原样透出（不伪造文案）", () => {
    expect(projectStageLabel("WEIRD")).toBe("WEIRD");
  });

  it("空值返回占位符 / neutral", () => {
    expect(projectStageLabel(null)).toBe("—");
    expect(projectStageLabel(undefined)).toBe("—");
    expect(projectStageTone(undefined)).toBe("neutral");
  });
});

describe("PROJECT_STAGE_OPTIONS — 表单下拉", () => {
  it("选项与 label 一一对应", () => {
    expect(PROJECT_STAGE_OPTIONS).toHaveLength(11);
    for (const opt of PROJECT_STAGE_OPTIONS) {
      expect(opt.label).toBe(PROJECT_STAGE_LABELS[opt.value]);
    }
  });
});

describe("优先级 / 回款 / 验收映射", () => {
  it("优先级文案", () => {
    expect(PROJECT_PRIORITY_LABELS.HIGH).toBe("高");
    expect(PROJECT_PRIORITY_LABELS.MEDIUM).toBe("中");
    expect(PROJECT_PRIORITY_LABELS.LOW).toBe("低");
  });

  it("回款状态文案", () => {
    expect(PROJECT_PAYMENT_LABELS.UNPAID).toBe("未回款");
    expect(PROJECT_PAYMENT_LABELS.PARTIAL).toBe("部分回款");
    expect(PROJECT_PAYMENT_LABELS.PAID).toBe("已回款");
    expect(PROJECT_PAYMENT_LABELS.OVERDUE).toBe("逾期");
  });

  it("验收结果文案 + tone", () => {
    expect(PROJECT_ACCEPTANCE_RESULT_LABELS.PASSED).toBe("通过");
    expect(PROJECT_ACCEPTANCE_RESULT_LABELS.CONDITIONAL_PASS).toBe("有条件通过");
    expect(PROJECT_ACCEPTANCE_RESULT_LABELS.FAILED).toBe("不通过");
    expect(PROJECT_ACCEPTANCE_RESULT_LABELS.PENDING).toBe("待验收");
    expect(PROJECT_ACCEPTANCE_TONES.PASSED).toBe("success");
    expect(PROJECT_ACCEPTANCE_TONES.FAILED).toBe("danger");
    expect(PROJECT_ACCEPTANCE_TONES.PENDING).toBe("neutral");
  });
});
