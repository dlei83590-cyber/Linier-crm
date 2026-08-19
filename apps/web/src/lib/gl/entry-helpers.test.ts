import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { validateGlLines, assertGlLinesBalanced } from "@/lib/gl/entry-helpers";

/**
 * GL 手工凭证核心单测（Sprint 7 Finance，ADR-0035）
 * 覆盖：行校验（每行恰一侧/科目 fail closed/借贷平衡）+ 已有行平衡复核。
 * 验证事实源 = GitHub CI（本地不运行测试）。
 */

function makeTx() {
  return {
    glAccount: {
      findFirst: vi.fn().mockImplementation((args: any) =>
        Promise.resolve(args.where.code === "9999" ? null : { id: "acct-" + args.where.code }),
      ),
    },
  } as unknown as Prisma.TransactionClient;
}

describe("validateGlLines — 手工凭证行校验", () => {
  it("合法分录（借 100 贷 100）→ 通过并解析科目", async () => {
    const tx = makeTx();
    const rows = await validateGlLines(tx, [
      { accountCode: "1002", debit: "100.00" },
      { accountCode: "2202", credit: "100.00" },
    ]);
    expect(rows.length).toBe(2);
    expect(rows[0].accountId).toBe("acct-1002");
    expect(rows[0].debit.toFixed(2)).toBe("100.00");
    expect(rows[1].credit.toFixed(2)).toBe("100.00");
  });

  it("借贷不平衡 → 抛 GL_UNBALANCED", async () => {
    const tx = makeTx();
    await expect(
      validateGlLines(tx, [
        { accountCode: "1002", debit: "100.00" },
        { accountCode: "2202", credit: "90.00" },
      ]),
    ).rejects.toThrow("GL_UNBALANCED");
  });

  it("每行借贷两侧均 > 0 → GL_BOTH_SIDES", async () => {
    const tx = makeTx();
    await expect(
      validateGlLines(tx, [{ accountCode: "1002", debit: "50.00", credit: "50.00" }]),
    ).rejects.toThrow("GL_BOTH_SIDES");
  });

  it("科目缺失 → GL_ACCOUNT_MISSING（fail closed）", async () => {
    const tx = makeTx();
    await expect(
      validateGlLines(tx, [
        { accountCode: "9999", debit: "10.00" },
        { accountCode: "2202", credit: "10.00" },
      ]),
    ).rejects.toThrow("GL_ACCOUNT_MISSING:9999");
  });

  it("零金额行 → GL_ZERO_AMOUNT", async () => {
    const tx = makeTx();
    await expect(
      validateGlLines(tx, [{ accountCode: "1002", debit: "0", credit: "0" }]),
    ).rejects.toThrow("GL_ZERO_AMOUNT");
  });
});

describe("assertGlLinesBalanced — 已有行复核（POST 时）", () => {
  it("平衡 → 不抛错", () => {
    expect(() =>
      assertGlLinesBalanced([
        { debit: new Prisma.Decimal("100.00"), credit: new Prisma.Decimal("0") },
        { debit: new Prisma.Decimal("0"), credit: new Prisma.Decimal("100.00") },
      ]),
    ).not.toThrow();
  });

  it("不平衡 → 抛 GL_UNBALANCED", () => {
    expect(() =>
      assertGlLinesBalanced([
        { debit: new Prisma.Decimal("100.00"), credit: new Prisma.Decimal("0") },
        { debit: new Prisma.Decimal("0"), credit: new Prisma.Decimal("90.00") },
      ]),
    ).toThrow("GL_UNBALANCED");
  });
});
