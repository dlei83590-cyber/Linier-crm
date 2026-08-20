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
      findFirst: vi.fn().mockResolvedValue({ id: "seq-jrn", code: "JRN:202608:GENERAL", docType: "JOURNAL", prefix: null, nextNo: 42, padLength: 4 }),
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({ id: "seq-jrn", nextNo: 43 }),
    },
    // 会计期间（ADR-0044）：测试期间 202608 默认 OPEN
    accountingPeriod: {
      findFirst: vi.fn().mockResolvedValue({ id: "p1", periodKey: "202608", status: "OPEN" }),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ id: "seq-jrn" }]),
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
    expect(r.voucherNo).toBe("记202608-0042"); // ADR-0044：凭证字+期间+流水（padLength 4 → 0042）
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

  it("GrirAccrued：借 原材料 贷 应付账款-暂估（按行 baseAmount 合计）", async () => {
    const tx = makeTx();
    const r = await glPostFromEvent(tx, "GrirAccrued", {
      warehouseReceiptId: "whr1",
      warehouseReceiptCode: "WHR-2026-000001",
      accruedLines: [
        { baseAmount: "100.00" },
        { baseAmount: "50.00" },
      ],
    });
    expect(r.ok).toBe(true);
    const created = (tx.glJournalEntry.create as any).mock.calls[0][0];
    expect(created.data.sourceType).toBe("GrirAccrued");
    expect(created.data.sourceId).toBe("whr1");
    const debit = created.data.lines.create.find((l: any) => l.accountId === "acct-1403");
    expect(debit.debit.toFixed(2)).toBe("150.00");
    const credit = created.data.lines.create.find((l: any) => l.accountId === "acct-2203");
    expect(credit.credit.toFixed(2)).toBe("150.00");
  });

  it("GrirReversed：借 应付账款-暂估 贷 原材料（反向红字）", async () => {
    const tx = makeTx();
    const r = await glPostFromEvent(tx, "GrirReversed", {
      purchaseReturnId: "prt1",
      purchaseReturnCode: "PRT-2026-000001",
      reversedLines: [{ baseAmount: "80.00" }],
    });
    expect(r.ok).toBe(true);
    const created = (tx.glJournalEntry.create as any).mock.calls[0][0];
    expect(created.data.sourceType).toBe("GrirReversed");
    const debit = created.data.lines.create.find((l: any) => l.accountId === "acct-2203");
    expect(debit.debit.toFixed(2)).toBe("80.00");
    const credit = created.data.lines.create.find((l: any) => l.accountId === "acct-1403");
    expect(credit.credit.toFixed(2)).toBe("80.00");
  });

  it("未注册事件 → UNSUPPORTED_EVENT", async () => {
    const tx = makeTx();
    const r = await glPostFromEvent(tx, "SomeOtherEvent", {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("UNSUPPORTED_EVENT");
  });
});

describe("glPostFromEvent — 销售侧 GL（ADR-0042）", () => {
  it("InvoiceIssued：借 应收账款(1122, 含税) 贷 主营业务收入(6001, 未税) + 销项税额(22210102) — 借贷平衡", async () => {
    const tx = makeTx();
    const r = await glPostFromEvent(tx, "InvoiceIssued", {
      invoiceId: "inv-s1",
      invoiceCode: "INV-2026-000001",
      subtotal: "100.00",
      taxAmount: "13.00",
      invoiceTotal: "113.00",
      issuedAt: "2026-08-20T02:00:00.000Z",
    });
    expect(r.ok).toBe(true);
    const created = (tx.glJournalEntry.create as any).mock.calls[0][0];
    const debitTotal = created.data.lines.create.reduce((acc: Prisma.Decimal, l: any) => acc.add(l.debit), new Prisma.Decimal(0));
    const creditTotal = created.data.lines.create.reduce((acc: Prisma.Decimal, l: any) => acc.add(l.credit), new Prisma.Decimal(0));
    expect(debitTotal.eq(creditTotal)).toBe(true);
    expect(created.data.sourceType).toBe("InvoiceIssued");
    expect(created.data.sourceId).toBe("inv-s1");
    const ar = created.data.lines.create.find((l: any) => l.accountId === "acct-1122");
    expect(ar.debit.toFixed(2)).toBe("113.00");
    const revenue = created.data.lines.create.find((l: any) => l.accountId === "acct-6001");
    expect(revenue.credit.toFixed(2)).toBe("100.00");
    const outputTax = created.data.lines.create.find((l: any) => l.accountId === "acct-22210102");
    expect(outputTax.credit.toFixed(2)).toBe("13.00");
  });

  it("InvoiceIssued 零税额：省略销项税行（1122 = 6001）", async () => {
    const tx = makeTx();
    const r = await glPostFromEvent(tx, "InvoiceIssued", {
      invoiceId: "inv-s2",
      subtotal: "100.00",
      taxAmount: "0",
      invoiceTotal: "100.00",
      issuedAt: "2026-08-20T02:00:00.000Z",
    });
    expect(r.ok).toBe(true);
    const created = (tx.glJournalEntry.create as any).mock.calls[0][0];
    expect(created.data.lines.create).toHaveLength(2);
    expect(created.data.lines.create.some((l: any) => l.accountId === "acct-22210102")).toBe(false);
  });

  it("InvoiceIssued 金额不一致（subtotal+tax ≠ invoiceTotal）→ GL_UNBALANCED", async () => {
    const tx = makeTx();
    const r = await glPostFromEvent(tx, "InvoiceIssued", {
      invoiceId: "inv-s3",
      subtotal: "100.00",
      taxAmount: "13.00",
      invoiceTotal: "120.00",
      issuedAt: "2026-08-20T02:00:00.000Z",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("GL_UNBALANCED");
  });

  it("ReceiptAllocated：借 银行存款(1002) 贷 应收账款(1122) — 按核销行金额", async () => {
    const tx = makeTx();
    const r = await glPostFromEvent(tx, "ReceiptAllocated", {
      receiptAllocationId: "alloc-1",
      receiptId: "rcpt-1",
      receiptCode: "RCPT-2026-000001",
      allocatedAmount: "113.00",
      paymentMethod: "BANK_TRANSFER",
      allocatedAt: "2026-08-20T03:00:00.000Z",
    });
    expect(r.ok).toBe(true);
    const created = (tx.glJournalEntry.create as any).mock.calls[0][0];
    expect(created.data.sourceType).toBe("ReceiptAllocated");
    expect(created.data.sourceId).toBe("alloc-1");
    const bank = created.data.lines.create.find((l: any) => l.accountId === "acct-1002");
    expect(bank.debit.toFixed(2)).toBe("113.00");
    const ar = created.data.lines.create.find((l: any) => l.accountId === "acct-1122");
    expect(ar.credit.toFixed(2)).toBe("113.00");
  });

  it("ReceiptAllocated CASH：借 库存现金(1001)", async () => {
    const tx = makeTx();
    const r = await glPostFromEvent(tx, "ReceiptAllocated", {
      receiptAllocationId: "alloc-2",
      receiptId: "rcpt-2",
      allocatedAmount: "50.00",
      paymentMethod: "CASH",
      allocatedAt: "2026-08-20T03:00:00.000Z",
    });
    expect(r.ok).toBe(true);
    const created = (tx.glJournalEntry.create as any).mock.calls[0][0];
    const cash = created.data.lines.create.find((l: any) => l.accountId === "acct-1001");
    expect(cash.debit.toFixed(2)).toBe("50.00");
  });

  it("ReceiptAllocationReversed：红字反向 借 应收账款 贷 银行存款", async () => {
    const tx = makeTx();
    const r = await glPostFromEvent(tx, "ReceiptAllocationReversed", {
      receiptAllocationId: "alloc-1",
      receiptId: "rcpt-1",
      reversedAmount: "113.00",
      paymentMethod: "BANK_TRANSFER",
      reversedAt: "2026-08-20T04:00:00.000Z",
    });
    expect(r.ok).toBe(true);
    const created = (tx.glJournalEntry.create as any).mock.calls[0][0];
    expect(created.data.sourceType).toBe("ReceiptAllocationReversed");
    expect(created.data.sourceId).toBe("alloc-1");
    const ar = created.data.lines.create.find((l: any) => l.accountId === "acct-1122");
    expect(ar.debit.toFixed(2)).toBe("113.00");
    const bank = created.data.lines.create.find((l: any) => l.accountId === "acct-1002");
    expect(bank.credit.toFixed(2)).toBe("113.00");
  });
});