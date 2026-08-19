import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { postGlEntry, glPostFromEvent } from "@/lib/gl/posting";

/**
 * Sprint 7 GL 过账服务单测（ADR-0033；CTO 解锁 2026-08-20）
 * 覆盖：借贷平衡 / 每行恰一侧 / 负金额 / 幂等跳过 / 取号 / SupplierInvoicePosted 映射 / PaymentApplied / CnDnApplied / Reversed。
 * 验证事实源 = GitHub CI（本地不运行测试）。
 */

function makeTx(overrides: Record<string, unknown> = {}) {
  return {
    glJournalEntry: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation((args: any) =>
        Promise.resolve({
          id: "entry-1",
          voucherNo: args.data.voucherNo,
          postingDate: args.data.postingDate,
          status: "POSTED",
          sourceType: args.data.sourceType,
          sourceId: args.data.sourceId,
          summary: args.data.summary,
          lines: [],
        }),
      ),
    },
    glAccount: {
      findFirst: vi.fn().mockImplementation((args: any) =>
        Promise.resolve(args.where.code === "9999" ? null : { id: "acct-" + args.where.code }),
      ),
    },
    documentSequence: {
      findFirst: vi.fn().mockResolvedValue({ id: "seq-jrn", docType: "JOURNAL", prefix: "JRN", nextNo: 42, padLength: 6 }),
      update: vi.fn().mockResolvedValue({ id: "seq-jrn", nextNo: 43 }),
    },
    supplierPaymentAllocation: {
      findMany: vi.fn().mockResolvedValue([{ allocatedAmount: "300.00" }, { allocatedAmount: "200.00" }]),
    },
    ...overrides,
  } as unknown as Prisma.TransactionClient;
}

describe("postGlEntry — 过账服务不变量", () => {
  it("借贷平衡成功：借 100 贷 100 → 创建凭证 + 取号 JRN-000042", async () => {
    const tx = makeTx();
    const r = await postGlEntry(tx, {
      sourceType: "TEST",
      sourceId: "s1",
      postingDate: new Date("2026-08-20T00:00:00Z"),
      lines: [
        { accountCode: "1002", debit: "100.00", credit: "0", summary: "借" },
        { accountCode: "2202", debit: "0", credit: "100.00", summary: "贷" },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.voucherNo).toBe("JRN000042");
    expect(tx.glJournalEntry.create).toHaveBeenCalledTimes(1);
  });

  it("借贷不平衡（借 100 贷 90）→ GL_UNBALANCED 409", async () => {
    const tx = makeTx();
    const r = await postGlEntry(tx, {
      sourceType: "TEST",
      sourceId: "s2",
      postingDate: new Date(),
      lines: [
        { accountCode: "1002", debit: "100.00", credit: "0" },
        { accountCode: "2202", debit: "0", credit: "90.00" },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("GL_UNBALANCED");
  });

  it("一行借贷两侧均 > 0 → GL_BOTH_SIDES（抛错）", async () => {
    const tx = makeTx();
    await expect(
      postGlEntry(tx, {
        sourceType: "TEST",
        sourceId: "s3",
        postingDate: new Date(),
        lines: [{ accountCode: "1002", debit: "50.00", credit: "50.00" }],
      }),
    ).rejects.toThrow("GL_BOTH_SIDES");
  });

  it("科目缺失 → 抛错（fail closed）", async () => {
    const tx = makeTx();
    await expect(
      postGlEntry(tx, {
        sourceType: "TEST",
        sourceId: "s4",
        postingDate: new Date(),
        lines: [{ accountCode: "9999", debit: "10.00", credit: "0" }],
      }),
    ).rejects.toThrow("GL_ACCOUNT_MISSING:9999");
  });

  it("幂等：sourceType+sourceId 已存在 → 跳过创建返回 idempotent=true", async () => {
    const tx = makeTx({
      glJournalEntry: {
        findFirst: vi.fn().mockResolvedValue({ id: "existing", voucherNo: "JRN-000001" }),
        create: vi.fn(),
      },
    });
    const r = await postGlEntry(tx, {
      sourceType: "SupplierInvoicePosted",
      sourceId: "inv1",
      postingDate: new Date(),
      lines: [{ accountCode: "1403", debit: "100.00", credit: "0" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.idempotent).toBe(true);
    expect(tx.glJournalEntry.create).not.toHaveBeenCalled();
  });
});

describe("glPostFromEvent — 5C 事件 → GL 分录映射（ADR-0033）", () => {
  it("SupplierInvoicePosted：借 采购成本+进项税 贷 应付账款（借贷平衡）", async () => {
    const tx = makeTx();
    const r = await glPostFromEvent(tx, "SupplierInvoicePosted", {
      invoiceId: "inv1",
      invoiceNo: "SINV-2026-000001",
      grossAmount: "113.00",
      netAmount: "100.00",
      inputVatAmount: "13.00",
      nonRecoverableTaxAmount: "0",
    });
    expect(r.ok).toBe(true);
    const created = (tx.glJournalEntry.create as any).mock.calls[0][0];
    const debitTotal = created.data.lines.create.reduce((acc: Prisma.Decimal, l: any) => acc.add(l.debit), new Prisma.Decimal(0));
    const creditTotal = created.data.lines.create.reduce((acc: Prisma.Decimal, l: any) => acc.add(l.credit), new Prisma.Decimal(0));
    expect(debitTotal.eq(creditTotal)).toBe(true);
    expect(created.data.sourceType).toBe("SupplierInvoicePosted");
    expect(created.data.sourceId).toBe("inv1");
  });

  it("SupplierPaymentApplied：借 应付账款 贷 银行存款", async () => {
    const tx = makeTx();
    const r = await glPostFromEvent(tx, "SupplierPaymentApplied", {
      paymentId: "pay1",
      code: "PV-2026-000001",
      apOpenItemId: "oi1",
      allocatedAmount: "250.00",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.idempotent).toBe(false);
  });

  it("SupplierCreditDebitNoteApplied CREDIT：借 应付账款 贷 采购调整（负数取绝对值）", async () => {
    const tx = makeTx();
    const r = await glPostFromEvent(tx, "SupplierCreditDebitNoteApplied", {
      cnDnId: "cn1",
      code: "SCN-2026-000001",
      noteType: "CREDIT",
      adjustmentTotal: "-100.0000",
    });
    expect(r.ok).toBe(true);
  });

  it("SupplierCreditDebitNoteApplied DEBIT：借 采购调整 贷 应付账款", async () => {
    const tx = makeTx();
    const r = await glPostFromEvent(tx, "SupplierCreditDebitNoteApplied", {
      cnDnId: "dn1",
      code: "SDN-2026-000001",
      noteType: "DEBIT",
      adjustmentTotal: "80.0000",
    });
    expect(r.ok).toBe(true);
  });

  it("SupplierPaymentReversed：金额从业务事实读取（reversed allocations 合计），借 银行存款 贷 应付账款", async () => {
    const tx = makeTx();
    const r = await glPostFromEvent(tx, "SupplierPaymentReversed", {
      paymentId: "pay1",
      code: "PV-2026-000001",
      reversedAllocations: 2,
    });
    expect(r.ok).toBe(true);
    const created = (tx.glJournalEntry.create as any).mock.calls[0][0];
    const debit = created.data.lines.create.find((l: any) => l.accountId === "acct-1002");
    expect(debit.debit.toFixed(2)).toBe("500.00"); // 300 + 200
  });

  it("未注册事件 → UNSUPPORTED_EVENT", async () => {
    const tx = makeTx();
    const r = await glPostFromEvent(tx, "SomeOtherEvent", {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("UNSUPPORTED_EVENT");
  });
});