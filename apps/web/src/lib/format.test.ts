import { describe, it, expect } from "vitest";
import { formatDate, formatDateOnly, formatMoney, formatMoneyValue } from "@/lib/format";

/**
 * UI-07 — 金额/日期格式化单元测试（销售链金额右对齐 tabular-nums 的数据底座）
 * 不变量：
 * 1) null / undefined / 空串 / NaN → 占位符 "—"（绝不渲染 "NaN" / "undefined"）
 * 2) 金额千分位 + 2 位小数；币种前缀
 * 3) 业务日期仅 YYYY/MM/DD（无时分秒）
 */

describe("formatMoney / formatMoneyValue", () => {
  it("空值返回占位符", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(undefined)).toBe("—");
    expect(formatMoney("")).toBe("—");
    expect(formatMoney(NaN)).toBe("—");
    expect(formatMoneyValue(null)).toBe("—");
    expect(formatMoneyValue("")).toBe("—");
  });

  it("千分位 + 2 位小数", () => {
    expect(formatMoney("12345.6789", "CNY")).toBe("CNY 12,345.68");
    expect(formatMoney(1000)).toBe("1,000.00");
    expect(formatMoneyValue("12345.6789")).toBe("12,345.68");
    expect(formatMoneyValue(999.5)).toBe("999.50");
  });

  it("负数与零", () => {
    expect(formatMoney("-1000.5", "CNY")).toBe("CNY -1,000.50");
    expect(formatMoney("0", "CNY")).toBe("CNY 0.00");
    expect(formatMoneyValue("-0.001")).toBe("-0.00");
  });

  it("无币种时纯数值；非法字符串回退占位符", () => {
    expect(formatMoney("abc")).toBe("—");
    expect(formatMoneyValue("abc")).toBe("—");
    expect(formatMoney("  12.3  ")).toBe("12.30");
  });
});

describe("formatDate / formatDateOnly", () => {
  it("空值返回占位符", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("not-a-date")).toBe("—");
    expect(formatDateOnly(null)).toBe("—");
  });

  it("业务日期仅日期粒度（YYYY/MM/DD）", () => {
    expect(formatDateOnly("2026-08-21T09:30:00.000Z")).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
  });

  it("完整时间戳含时分秒", () => {
    expect(formatDate("2026-08-21T09:30:00.000Z")).toContain("2026");
  });
});
