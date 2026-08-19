import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { applySupplierCnDn } from "@/lib/supplier-cn-dn/apply-helper";

/**
 * 5C-2 Supplier CN/DN APPLY 会计不变量单测（CTO 建议 P0-1）
 * 覆盖：NOT_FOUND / ALREADY_APPLIED / INVALID_STATE / VERSION_CONFLICT / MAKER_CHECKER /
 *       OPEN_ITEM_NOT_FOUND / OVER_ADJUSTMENT（负 AP 防线）/ 成功 CREDIT / 成功 DEBIT。
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

const baseOpenItem = { id: "oi1", apLiabilityFactId: "lf1", openAmount: "500.0000" };

describe("applySupplierCnDn — 会计不变量", () => {
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

  it("OPEN_ITEM_NOT_FOUND：发票未过账（无 Open Item）→ 409", async () => {
    const tx = makeTx([[baseNote], []]);
    const r = await applySupplierCnDn(tx, { cnDnId: "n1", version: 1, actorId: "user-b" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("OPEN_ITEM_NOT_FOUND");
  });

  it("OVER_ADJUSTMENT：CREDIT 超冲减（openAmount 将 < 0）→ 409 负 AP 防线", async () => {
    const tx = makeTx([[{ ...baseNote, adjustmentTotal: "600.0000" }], [{ ...baseOpenItem, openAmount: "500.0000" }]]);
    const r = await applySupplierCnDn(tx, { cnDnId: "n1", version: 1, actorId: "user-b" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("OVER_ADJUSTMENT");
  });

  it("成功 CREDIT：投影 500 - 100 = 400，状态 → APPLIED（同事务）", async () => {
    const tx = makeTx([[baseNote], [baseOpenItem]]);
    const r = await applySupplierCnDn(tx, { cnDnId: "n1", version: 1, actorId: "user-b" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.openAmountAfter).toBe("400.0000");
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
    const tx = makeTx([[{ ...baseNote, noteType: "DEBIT" }], [baseOpenItem]]);
    const r = await applySupplierCnDn(tx, { cnDnId: "n1", version: 1, actorId: "user-b" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.openAmountAfter).toBe("600.0000");
  });
});