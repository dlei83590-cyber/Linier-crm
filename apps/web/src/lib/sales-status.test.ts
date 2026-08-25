import { describe, it, expect } from "vitest";
import {
  SALES_STATUS_OPTIONS,
  approvalStatusDef,
  salesStatusDef,
  salesStatusLabel,
  salesStatusTone,
} from "@/lib/sales-status";

/**
 * UI-07 — 销售链状态映射单元测试
 * 不变量：
 * 1) 每个筛选可选状态都有中文 label + 语义 tone（禁止漏配导致英文枚举裸奔）
 * 2) 关键业务状态映射正确（APPROVED ≠ CONFIRMED、OVERDUE 等惰性投影）
 * 3) 未知 / 空状态回退 neutral + 原文（不伪造业务语义）
 */

const DOMAINS = Object.keys(SALES_STATUS_OPTIONS) as (keyof typeof SALES_STATUS_OPTIONS)[];

describe("sales-status 状态映射完整性", () => {
  it("每个域的筛选选项都配置了 label 与 tone", () => {
    for (const domain of DOMAINS) {
      for (const status of SALES_STATUS_OPTIONS[domain]) {
        const def = salesStatusDef(domain, status);
        expect(def.label, `${domain}.${status} label`).toBeTruthy();
        expect(def.label).not.toBe(status); // 必须中文化，禁止直接透出枚举
        expect(
          ["neutral", "info", "success", "warning", "danger"],
          `${domain}.${status} tone`,
        ).toContain(def.tone);
      }
    }
  });

  it("报价单：DRAFT 草稿 / ACCEPTED 客户已接受 / EXPIRED 已过期", () => {
    expect(salesStatusLabel("quotation", "DRAFT")).toBe("草稿");
    expect(salesStatusTone("quotation", "DRAFT")).toBe("neutral");
    expect(salesStatusLabel("quotation", "ACCEPTED")).toBe("客户已接受");
    expect(salesStatusTone("quotation", "ACCEPTED")).toBe("success");
    expect(salesStatusLabel("quotation", "EXPIRED")).toBe("已过期");
    expect(salesStatusTone("quotation", "EXPIRED")).toBe("warning");
  });

  it("销售订单：CONFIRMED 已确认（≠ APPROVED）", () => {
    expect(salesStatusLabel("salesOrder", "CONFIRMED")).toBe("已确认");
    expect(salesStatusTone("salesOrder", "CONFIRMED")).toBe("success");
    expect(salesStatusLabel("salesOrder", "PARTIALLY_DELIVERED")).toBe("部分交付");
    expect(salesStatusTone("salesOrder", "PARTIALLY_DELIVERED")).toBe("warning");
  });

  it("送货单：READY 待发运 / DISPATCHED 已发运", () => {
    expect(salesStatusLabel("delivery", "READY")).toBe("待发运");
    expect(salesStatusTone("delivery", "READY")).toBe("info");
    expect(salesStatusLabel("delivery", "DISPATCHED")).toBe("已发运");
  });

  it("发票：ISSUED 已开票 / PAID 已收款 / CANCELLED 已取消", () => {
    expect(salesStatusLabel("invoice", "ISSUED")).toBe("已开票");
    expect(salesStatusTone("invoice", "ISSUED")).toBe("info");
    expect(salesStatusLabel("invoice", "PAID")).toBe("已收款");
    expect(salesStatusTone("invoice", "PAID")).toBe("success");
    expect(salesStatusLabel("invoice", "CANCELLED")).toBe("已取消");
    expect(salesStatusTone("invoice", "CANCELLED")).toBe("danger");
  });

  it("应收：OVERDUE 已逾期（惰性投影）为 danger", () => {
    expect(salesStatusLabel("ar", "OPEN")).toBe("未结清");
    expect(salesStatusTone("ar", "OVERDUE")).toBe("danger");
    expect(salesStatusLabel("ar", "PAID")).toBe("已结清");
  });

  it("收款单：UNALLOCATED 未核销 / VOIDED 已作废", () => {
    expect(salesStatusLabel("receipt", "UNALLOCATED")).toBe("未核销");
    expect(salesStatusTone("receipt", "UNALLOCATED")).toBe("info");
    expect(salesStatusLabel("receipt", "VOIDED")).toBe("已作废");
    expect(salesStatusTone("receipt", "VOIDED")).toBe("danger");
  });

  it("贷项/借项：APPLIED 已应用（≠ APPROVED）", () => {
    expect(salesStatusLabel("cnDn", "SUBMITTED")).toBe("已提交");
    expect(salesStatusLabel("cnDn", "APPLIED")).toBe("已应用");
    expect(salesStatusTone("cnDn", "APPLIED")).toBe("success");
    expect(salesStatusLabel("cnDn", "REVERSED")).toBe("已反冲");
  });

  it("未知 / 空状态回退 neutral + 原文，不伪造语义", () => {
    expect(salesStatusDef("invoice", "WEIRD_STATUS")).toEqual({
      label: "WEIRD_STATUS",
      tone: "neutral",
    });
    expect(salesStatusLabel("invoice", null)).toBe("—");
    expect(salesStatusTone("invoice", undefined)).toBe("neutral");
    expect(approvalStatusDef("PENDING")).toEqual({ label: "待审批", tone: "warning" });
    expect(approvalStatusDef(null)).toEqual({ label: "—", tone: "neutral" });
  });
});
