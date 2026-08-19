import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { computeTrialBalance, computeProfitStatement, type GlAggLineInput } from "@/lib/gl/balances";

/**
 * GL 余额/试算/利润聚合核心单测（Sprint 7 Finance，ADR-0034）
 * 覆盖：DEBIT/CREDIT 方向余额 / 借贷平衡校验 / 利润表收入-费用 / 期间无数据。
 * 验证事实源 = GitHub CI（本地不运行测试）。
 */

const d = (v: string) => new Prisma.Decimal(v);

function line(partial: Partial<GlAggLineInput> & { code: string; name: string; category: string; direction: "DEBIT" | "CREDIT" }): GlAggLineInput {
  return { accountId: partial.code, code: partial.code, name: partial.name, category: partial.category, direction: partial.direction, debit: partial.debit ?? d("0"), credit: partial.credit ?? d("0") };
}

describe("computeTrialBalance — 试算平衡", () => {
  it("DEBIT 科目余额 = debit−credit；CREDIT 科目余额 = credit−debit", () => {
    const r = computeTrialBalance([
      line({ code: "1002", name: "银行存款", category: "ASSET", direction: "DEBIT", debit: d("1000.00"), credit: d("400.00") }),
      line({ code: "2202", name: "应付账款", category: "LIABILITY", direction: "CREDIT", credit: d("600.00") }),
    ]);
    expect(r.lines[0].balance).toBe("600.00"); // 1000 - 400
    expect(r.lines[1].balance).toBe("600.00"); // 600 - 0
    expect(r.totals.debit).toBe("1000.00");
    expect(r.totals.credit).toBe("1000.00");
    expect(r.inBalance).toBe(true);
  });

  it("借贷不平衡 → inBalance:false", () => {
    const r = computeTrialBalance([
      line({ code: "1002", name: "银行存款", category: "ASSET", direction: "DEBIT", debit: d("100.00") }),
      line({ code: "2202", name: "应付账款", category: "LIABILITY", direction: "CREDIT", credit: d("90.00") }),
    ]);
    expect(r.inBalance).toBe(false);
  });

  it("空数据 → 全零且 inBalance:true", () => {
    const r = computeTrialBalance([]);
    expect(r.totals.debit).toBe("0.00");
    expect(r.totals.credit).toBe("0.00");
    expect(r.inBalance).toBe(true);
  });
});

describe("computeProfitStatement — 利润表", () => {
  it("收入（CREDIT 方向）− 费用（DEBIT 方向）= 利润", () => {
    const r = computeProfitStatement([
      line({ code: "6001", name: "主营业务收入", category: "REVENUE", direction: "CREDIT", credit: d("500.00") }),
      line({ code: "6401", name: "主营业务成本", category: "EXPENSE", direction: "DEBIT", debit: d("300.00") }),
      line({ code: "6602", name: "管理费用", category: "EXPENSE", direction: "DEBIT", debit: d("50.00") }),
    ]);
    expect(r.revenue).toBe("500.00");
    expect(r.expense).toBe("350.00");
    expect(r.profit).toBe("150.00");
  });

  it("费用超过收入 → 亏损（负利润）", () => {
    const r = computeProfitStatement([
      line({ code: "6001", name: "主营业务收入", category: "REVENUE", direction: "CREDIT", credit: d("100.00") }),
      line({ code: "6401", name: "主营业务成本", category: "EXPENSE", direction: "DEBIT", debit: d("150.00") }),
    ]);
    expect(r.profit).toBe("-50.00");
  });
});
