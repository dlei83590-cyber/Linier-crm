import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { applySupplierCnDn } from "@/lib/supplier-cn-dn/apply-helper";

/**
 * 5C-2 Supplier CN/DN APPLY 会计不变量单测（跨票 Consolidated，Migration 0032）
 * 查询序列（apply-helper）：① 锁 note FOR UPDATE → ② 关联发票集合 → ③ 行归属分摊（lines JOIN invoice）
 * → ④ 锁 Open Items（JOIN ApLiabilityFact 带 supplierInvoiceId，ORDER BY id FOR UPDATE）。
 * 覆盖：NOT_FOUND / ALREADY_APPLIED / INVALID_STATE / VERSION_CONFLICT / MAKER_CHECKER /
 *       NO_LINES / OPEN_ITEM_NOT_FOUND / OVER_ADJUSTMENT（负 AP 防线）/ 成功 CREDIT / 成功 DEBIT /
 *       跨票分摊（两票各自投影）/ 跨票逐票防超调。
 * 验证事实源 = GitHub CI（本地不运行测试）。
 */

function makeTx(rows: unknown[][]) {
  const queryMock = vi.fn();
  rows.forEach((r) => queryMock.mockResolvedValueOnce(r));
  return {
    $queryRaw: queryMock,
    apOpenItem: { update: vi.fn().mockResolvedValue({}) },
    supplierCreditDebitNote: { update: vi.fn().mockResolvedValue({}) },
  } as unknown as Prisma.TransactionClient;
}

const baseNote = {
  id: "n1",
  code: "SCN-2026-000001",
  noteType: "CREDIT",
  sourceSupplierInvoiceId: "inv1",
  supplierId: "s1",
  currency: "CNY",
  adjustmentTotal: "100.0000",
  status: "APPROVED",
  version: 1,
  createdById: "user-a",
};

const baseLink = { supplierInvoiceId: "inv1" };
const baseLine = { lineId: "sl1", amount: "100.0000", supplierInvoiceId: "inv1" };
const baseOpenItem = { id: "oi1", apLiabilityFactId: "lf1", openAmount: "500.0000", supplierInvoiceId: "inv1" };

describe("applySupplierCnDn — 会计不变量（单票）", () => {
  it("NOT_FOUND：通知单不存在 → 404", async () => {
    const tx = makeTx([[]]);
    const r = await applySupplierCnDn(tx, { cnDnId: "n-x", version: 1, actorId: "user-b" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });

  it("ALREADY_APPLIED：已应用 → 409 幂等拒绝", async () => {
    const tx = makeTx([[{ ...baseNote, status: "APPLIED" }]]);
    const r = await applySupplierCnDn(tx, { cnDnId: "n1", version: 1, actorId: "user-b" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("ALREADY_APPLIED");
  });

  it("INVALID_STATE：非 APPROVED → 409（APPROVED ≠ APPLIED）", async () => {
    const tx = makeTx([[{ ...baseNote, status: "DRAFT" }]]);
    const r = await applySupplierCnDn(tx, { cnDnId: "n1", version: 1, actorId: "user-b" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INVALID_STATE");
  });

  it("VERSION_CONFLICT：版本不匹配 → 409", async () => {
    const tx = makeTx([[baseNote]]);
    const r = await applySupplierCnDn(tx, { cnDnId: "n1", version: 99, actorId: "user-b" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("VERSION_CONFLICT");
  });

  it("MAKER_CHECKER：应用人 = 创建人 → 409", async () => {
    const tx = makeTx([[baseNote]]);
    const r = await applySupplierCnDn(tx, { cnDnId: "n1", version: 1, actorId: "user-a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MAKER_CHECKER");
  });

  it("NO_LINES：无明细行 → 409", async () => {
    const tx = makeTx([[baseNote], [baseLink], []]);
    const r = await applySupplierCnDn(tx, { cnDnId: "n1", version: 1, actorId: "user-b" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NO_LINES");
  });

  it("OPEN_ITEM_NOT_FOUND：发票未过账（无 Open Item）→ 409", async () => {
    const tx = makeTx([[baseNote], [baseLink], [baseLine], []]);
    const r = await applySupplierCnDn(tx, { cnDnId: "n1", version: 1, actorId: "user-b" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("OPEN_ITEM_NOT_FOUND");
  });

  it("OVER_ADJUSTMENT：CREDIT 超冲减（openAmount 将 < 0）→ 409 负 AP 防线", async () => {
    const tx = makeTx([[baseNote], [baseLink], [{ ...baseLine, amount: "600.0000" }], [{ ...baseOpenItem, openAmount: "500.0000" }]]);
    const r = await applySupplierCnDn(tx, { cnDnId: "n1", version: 1, actorId: "user-b" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("OVER_ADJUSTMENT");
  });

  it("成功 CREDIT：投影 500 - 100 = 400，状态 → APPLIED（同事务）", async () => {
    const tx = makeTx([[baseNote], [baseLink], [baseLine], [baseOpenItem]]);
    const r = await applySupplierCnDn(tx, { cnDnId: "n1", version: 1, actorId: "user-b" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.openAmountsAfter).toEqual([{ supplierInvoiceId: "inv1", openAmountAfter: "400.0000" }]);
    expect(tx.apOpenItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ openAmount: expect.any(Prisma.Decimal) }),
      }),
    );
    expect(tx.supplierCreditDebitNote.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "APPLIED", appliedById: "user-b" }),
      }),
    );
  });

  it("成功 DEBIT：投影 500 + 100 = 600（signed 正向）", async () => {
    const tx = makeTx([[{ ...baseNote, noteType: "DEBIT" }], [baseLink], [baseLine], [baseOpenItem]]);
    const r = await applySupplierCnDn(tx, { cnDnId: "n1", version: 1, actorId: "user-b" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.openAmountsAfter).toEqual([{ supplierInvoiceId: "inv1", openAmountAfter: "600.0000" }]);
  });

  it("单票退化兼容：无关联表记录但 sourceSupplierInvoiceId 非空（历史数据）", async () => {
    const tx = makeTx([[baseNote], [], [baseLine], [baseOpenItem]]);
    const r = await applySupplierCnDn(tx, { cnDnId: "n1", version: 1, actorId: "user-b" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.openAmountsAfter).toEqual([{ supplierInvoiceId: "inv1", openAmountAfter: "400.0000" }]);
  });
});

describe("applySupplierCnDn — 跨票 Consolidated（Migration 0032）", () => {
  const multiLinks = [{ supplierInvoiceId: "inv1" }, { supplierInvoiceId: "inv2" }];
  const multiLines = [
    { lineId: "sl1", amount: "60.0000", supplierInvoiceId: "inv1" },
    { lineId: "sl2", amount: "40.0000", supplierInvoiceId: "inv2" },
  ];
  const multiOpenItems = [
    { id: "oi1", apLiabilityFactId: "lf1", openAmount: "500.0000", supplierInvoiceId: "inv1" },
    { id: "oi2", apLiabilityFactId: "lf2", openAmount: "300.0000", supplierInvoiceId: "inv2" },
  ];

  it("成功跨票 CREDIT：金额按行归属分摊（inv1: 500-60=440，inv2: 300-40=260）", async () => {
    const tx = makeTx([[baseNote], [multiLinks], [multiLines], [multiOpenItems]]);
    const r = await applySupplierCnDn(tx, { cnDnId: "n1", version: 1, actorId: "user-b" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.openAmountsAfter).toEqual([
      { supplierInvoiceId: "inv1", openAmountAfter: "440.0000" },
      { supplierInvoiceId: "inv2", openAmountAfter: "260.0000" },
    ]);
    // 两张发票投影各自 update（同事务）
    expect(tx.apOpenItem.update).toHaveBeenCalledTimes(2);
  });

  it("跨票逐票防超调：仅 inv2 CREDIT 超冲减 → 409（整体拒绝，不部分应用）", async () => {
    const badLines = [
      { lineId: "sl1", amount: "60.0000", supplierInvoiceId: "inv1" },
      { lineId: "sl2", amount: "400.0000", supplierInvoiceId: "inv2" },
    ];
    const tx = makeTx([[baseNote], [multiLinks], [badLines], [multiOpenItems]]);
    const r = await applySupplierCnDn(tx, { cnDnId: "n1", version: 1, actorId: "user-b" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("OVER_ADJUSTMENT");
    expect(tx.apOpenItem.update).not.toHaveBeenCalled();
    expect(tx.supplierCreditDebitNote.update).not.toHaveBeenCalled();
  });

  it("跨票行归属必须 ⊆ 关联发票集合（LINE_INVOICE_MISMATCH）", async () => {
    const badLines = [
      { lineId: "sl1", amount: "60.0000", supplierInvoiceId: "inv1" },
      { lineId: "sl9", amount: "40.0000", supplierInvoiceId: "inv9" }, // 不在关联集合
    ];
    const tx = makeTx([[baseNote], [multiLinks], [badLines]]);
    const r = await applySupplierCnDn(tx, { cnDnId: "n1", version: 1, actorId: "user-b" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("LINE_INVOICE_MISMATCH");
  });

  it("跨票缺 Open Item（部分发票未过账）→ 409，不部分应用", async () => {
    const tx = makeTx([[baseNote], [multiLinks], [multiLines], [multiOpenItems.slice(0, 1)]]);
    const r = await applySupplierCnDn(tx, { cnDnId: "n1", version: 1, actorId: "user-b" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("OPEN_ITEM_NOT_FOUND");
  });

  it("成功跨票 DEBIT：inv1: 500+60=560，inv2: 300+40=340", async () => {
    const tx = makeTx([[{ ...baseNote, noteType: "DEBIT" }], [multiLinks], [multiLines], [multiOpenItems]]);
    const r = await applySupplierCnDn(tx, { cnDnId: "n1", version: 1, actorId: "user-b" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.openAmountsAfter).toEqual([
      { supplierInvoiceId: "inv1", openAmountAfter: "560.0000" },
      { supplierInvoiceId: "inv2", openAmountAfter: "340.0000" },
    ]);
  });
});
