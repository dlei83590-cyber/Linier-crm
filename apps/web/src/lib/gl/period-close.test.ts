import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { closePeriod, computeBalancesWithOpening, reopenPeriod, RETAINED_EARNINGS_CODE } from "@/lib/gl/period-close";

/**
 * GL 期末结转核心单测（Sprint 7 Finance，ADR-0036）
 * 覆盖：结转分录借贷平衡/本年利润差额/防重复（GL_PERIOD_ALREADY_CLOSED）/期初余额派生。
 * 验证事实源 = GitHub CI（本地不运行测试）。
 */

function makeTx(overrides: Record<string, unknown> = {}) {
  return {
    glPeriodClose: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
    glAccount: {
      findMany: vi.fn().mockResolvedValue([
        { id: "acc-rev", code: "6001", name: "主营业务收入", category: "REVENUE", direction: "CREDIT" },
        { id: "acc-exp", code: "6401", name: "主营业务成本", category: "EXPENSE", direction: "DEBIT" },
        { id: "acc-ret", code: RETAINED_EARNINGS_CODE, name: "本年利润", category: "EQUITY", direction: "CREDIT" },
      ]),
      findFirst: vi.fn().mockImplementation((args: any) =>
        Promise.resolve(args.where.code === "9999" ? null : { id: "acct-" + args.where.code }),
      ),
    },
    glJournalEntryLine: {
      findMany: vi.fn().mockResolvedValue([
        { accountId: "acc-rev", debit: new Prisma.Decimal("0"), credit: new Prisma.Decimal("500.00") },
        { accountId: "acc-exp", debit: new Prisma.Decimal("300.00"), credit: new Prisma.Decimal("0") },
      ]),
      aggregate: vi.fn().mockResolvedValue({ _sum: { debit: null, credit: null } }),
    },
    documentSequence: {
      findFirst: vi.fn().mockResolvedValue({ id: "seq-jrn", docType: "JOURNAL", prefix: "JRN", nextNo: 100, padLength: 6 }),
      update: vi.fn().mockResolvedValue({ id: "seq-jrn", nextNo: 101 }),
    },
    glJournalEntry: {
      create: vi.fn().mockImplementation((args: any) =>
        Promise.resolve({ id: "entry-close", voucherNo: args.data.voucherNo, ...args.data }),
      ),
    },
    ...overrides,
  } as unknown as Prisma.TransactionClient;
}

describe("closePeriod — 期末结转", () => {
  it("收入 500 / 费用 300 → 结转凭证借贷平衡，本年利润 200（贷 4103）", async () => {
    const tx = makeTx();
    const r = await closePeriod(tx, { periodKey: "2026-08", actorId: "user-a" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.revenueNet).toBe("500.00");
    expect(r.expenseNet).toBe("300.00");
    expect(r.profit).toBe("200.00");
    const created = (tx.glJournalEntry.create as any).mock.calls[0][0];
    expect(created.data.sourceType).toBe("PERIOD_CLOSE");
    expect(created.data.sourceId).toBe("2026-08");
    // 借贷平衡
    const sumD = created.data.lines.create.reduce((acc: Prisma.Decimal, l: any) => acc.add(l.debit), new Prisma.Decimal(0));
    const sumC = created.data.lines.create.reduce((acc: Prisma.Decimal, l: any) => acc.add(l.credit), new Prisma.Decimal(0));
    expect(sumD.eq(sumC)).toBe(true);
    // 4103 贷方 = 200
    const retainedLine = created.data.lines.create.find((l: any) => l.accountId === "acct-4103");
    expect(retainedLine.credit.toFixed(2)).toBe("200.00");
    // GlPeriodClose 写入
    expect(tx.glPeriodClose.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ periodKey: "2026-08" }) }));
  });

  it("费用 > 收入 → 本年利润为负（借 4103）", async () => {
    const tx = makeTx({
      glJournalEntryLine: {
        findMany: vi.fn().mockResolvedValue([
          { accountId: "acc-rev", debit: new Prisma.Decimal("0"), credit: new Prisma.Decimal("100.00") },
          { accountId: "acc-exp", debit: new Prisma.Decimal("150.00"), credit: new Prisma.Decimal("0") },
        ]),
      },
    });
    const r = await closePeriod(tx, { periodKey: "2026-08", actorId: "user-a" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.profit).toBe("-50.00");
    const created = (tx.glJournalEntry.create as any).mock.calls[0][0];
    const retainedLine = created.data.lines.create.find((l: any) => l.accountId === "acct-4103");
    expect(retainedLine.debit.toFixed(2)).toBe("50.00");
  });

  it("防重复：periodKey 已存在 → GL_PERIOD_ALREADY_CLOSED 409", async () => {
    const tx = makeTx({
      glPeriodClose: { findFirst: vi.fn().mockResolvedValue({ id: "pc1", periodKey: "2026-08" }), create: vi.fn() },
    });
    const r = await closePeriod(tx, { periodKey: "2026-08", actorId: "user-a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("GL_PERIOD_ALREADY_CLOSED");
  });

  it("期间格式非法 → GL_PERIOD_INVALID", async () => {
    const tx = makeTx();
    const r = await closePeriod(tx, { periodKey: "2026-8", actorId: "user-a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("GL_PERIOD_INVALID");
  });

  it("无收入/费用凭证 → GL_PERIOD_NO_ACTIVITY", async () => {
    const tx = makeTx({
      glJournalEntryLine: { findMany: vi.fn().mockResolvedValue([]) },
    });
    const r = await closePeriod(tx, { periodKey: "2026-07", actorId: "user-a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("GL_PERIOD_NO_ACTIVITY");
  });

describe("reopenPeriod — 期间重开（ADR-0037）", () => {
  const closeRow = {
    id: "pc1",
    periodKey: "2026-08",
    journalEntry: {
      id: "entry-close",
      lines: [
        { accountId: "acc-rev", debit: new Prisma.Decimal("0"), credit: new Prisma.Decimal("500.00"), summary: "结转收入" },
        { accountId: "acc-ret", debit: new Prisma.Decimal("0"), credit: new Prisma.Decimal("200.00"), summary: "本年利润" },
        { accountId: "acc-exp", debit: new Prisma.Decimal("300.00"), credit: new Prisma.Decimal("0"), summary: "结转费用" },
        { accountId: "acc-ret", debit: new Prisma.Decimal("300.00"), credit: new Prisma.Decimal("0"), summary: "本年利润(费用)" },
      ],
    },
  };

  function reopenTx(overrides: Record<string, unknown> = {}) {
    return {
      glPeriodClose: {
        findFirst: vi.fn().mockResolvedValue(closeRow),
        delete: vi.fn().mockResolvedValue({}),
      },
      documentSequence: {
        findFirst: vi.fn().mockResolvedValue({ id: "seq-jrn", docType: "JOURNAL", prefix: "JRN", nextNo: 200, padLength: 6 }),
        update: vi.fn().mockResolvedValue({ id: "seq-jrn", nextNo: 201 }),
      },
      glJournalEntry: {
        create: vi.fn().mockImplementation((args: any) => Promise.resolve({ id: "entry-rev", voucherNo: args.data.voucherNo, ...args.data })),
      },
      ...overrides,
    } as unknown as Prisma.TransactionClient;
  }

  it("生成红字冲销凭证（逐行反向，借贷平衡）+ 删除 GlPeriodClose", async () => {
    const tx = reopenTx();
    const r = await reopenPeriod(tx, { periodCloseId: "pc1", actorId: "user-a" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const created = (tx.glJournalEntry.create as any).mock.calls[0][0];
    expect(created.data.sourceType).toBe("PERIOD_CLOSE_REVERSAL");
    const sumD = created.data.lines.create.reduce((acc: Prisma.Decimal, l: any) => acc.add(l.debit), new Prisma.Decimal(0));
    const sumC = created.data.lines.create.reduce((acc: Prisma.Decimal, l: any) => acc.add(l.credit), new Prisma.Decimal(0));
    expect(sumD.eq(sumC)).toBe(true);
    // 反向：原贷 500 → 冲销借 500
    const revLine = created.data.lines.create.find((l: any) => l.accountId === "acc-rev");
    expect(revLine.debit.toFixed(2)).toBe("500.00");
    expect(revLine.credit.toFixed(2)).toBe("0.00");
    expect(tx.glPeriodClose.delete).toHaveBeenCalledWith({ where: { id: "pc1" } });
  });

  it("已重开（无结转记录）→ GL_PERIOD_NOT_CLOSED", async () => {
    const tx = reopenTx({ glPeriodClose: { findFirst: vi.fn().mockResolvedValue(null), delete: vi.fn() } });
    const r = await reopenPeriod(tx, { periodCloseId: "pc-x", actorId: "user-a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("GL_PERIOD_NOT_CLOSED");
  });

  it("结转凭证无分录 → GL_REOPEN_NO_SOURCE", async () => {
    const tx = reopenTx({ glPeriodClose: { findFirst: vi.fn().mockResolvedValue({ id: "pc1", periodKey: "2026-08", journalEntry: { id: "e", lines: [] } }), delete: vi.fn() } });
    const r = await reopenPeriod(tx, { periodCloseId: "pc1", actorId: "user-a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("GL_REOPEN_NO_SOURCE");
  });
});

});

describe("computeBalancesWithOpening — 期初余额派生（ADR-0036）", () => {
  it("无 dateFrom → 期初 0；closing = 期间净额", async () => {
    const tx = makeTx();
    const r = await computeBalancesWithOpening(tx, "acc-rev", undefined, new Date("2026-08-31"));
    expect(r.openingBalance.toFixed(2)).toBe("0.00");
  });
});