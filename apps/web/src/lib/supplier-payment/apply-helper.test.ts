import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { applySupplierPaymentAllocation } from "@/lib/supplier-payment/apply-helper";

/**
 * 5C-2 Payment APPLY 会计不变量单测（CTO 建议 P0-1）
 * 覆盖：NOT_FOUND / VOIDED / FULLY_ALLOCATED / MAKER_CHECKER / OPEN_ITEM_NOT_FOUND /
 *       SUPPLIER_MISMATCH / CURRENCY_MISMATCH / INVALID_AMOUNT / OVER_ALLOCATION /
 *       OVER_PAYMENT / 成功部分核销 / 成功全额核销。
 * 验证事实源 = GitHub CI（本地不运行测试）。
 */

function makeTx(rows: unknown[][]) {
  const queryMock = vi.fn();
  rows.forEach((r) => queryMock.mockResolvedValueOnce(r));
  return {
    $queryRaw: queryMock,
    supplierPaymentAllocation: { create: vi.fn().mockResolvedValue({}) },
    supplierPayment: { update: vi.fn().mockResolvedValue({}) },
    apOpenItem: { update: vi.fn().mockResolvedValue({}) },
  } as unknown as Prisma.TransactionClient;
}

const basePayment = {
  id: "p1",
  supplierId: "s1",
  currency: "CNY",
  amount: "1000.0000",
  allocatedAmount: "0.0000",
  unallocatedAmount: "1000.0000",
  status: "UNALLOCATED",
  version: 1,
  voidedAt: null,
  createdById: "user-a",
};

const baseOpenItem = { id: "oi1", supplierId: "s1", currency: "CNY", openAmount: "500.0000" };

describe("applySupplierPaymentAllocation — 会计不变量", () => {
  it("NOT_FOUND：付款单不存在 → 404", async () => {
    const tx = makeTx([[]]);
    const r = await applySupplierPaymentAllocation(tx, { paymentId: "p-x", apOpenItemId: "oi1", allocatedAmount: new Prisma.Decimal(100), actorId: "user-b" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });

  it("VOIDED：已作废付款单 → 409", async () => {
    const tx = makeTx([[{ ...basePayment, voidedAt: new Date() }]]);
    const r = await applySupplierPaymentAllocation(tx, { paymentId: "p1", apOpenItemId: "oi1", allocatedAmount: new Prisma.Decimal(100), actorId: "user-b" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("VOIDED");
  });

  it("FULLY_ALLOCATED：已全额核销 → 409", async () => {
    const tx = makeTx([[{ ...basePayment, status: "ALLOCATED", allocatedAmount: "1000.0000", unallocatedAmount: "0.0000" }]]);
    const r = await applySupplierPaymentAllocation(tx, { paymentId: "p1", apOpenItemId: "oi1", allocatedAmount: new Prisma.Decimal(100), actorId: "user-b" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("FULLY_ALLOCATED");
  });

  it("MAKER_CHECKER：核销人 = 创建人 → 409", async () => {
    const tx = makeTx([[basePayment]]);
    const r = await applySupplierPaymentAllocation(tx, { paymentId: "p1", apOpenItemId: "oi1", allocatedAmount: new Prisma.Decimal(100), actorId: "user-a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MAKER_CHECKER");
  });

  it("OPEN_ITEM_NOT_FOUND：目标未结项不存在 → 404", async () => {
    const tx = makeTx([[basePayment], []]);
    const r = await applySupplierPaymentAllocation(tx, { paymentId: "p1", apOpenItemId: "oi-x", allocatedAmount: new Prisma.Decimal(100), actorId: "user-b" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("OPEN_ITEM_NOT_FOUND");
  });

  it("SUPPLIER_MISMATCH：供应商不一致 → 409（同供应商硬规则）", async () => {
    const tx = makeTx([[basePayment], [{ ...baseOpenItem, supplierId: "s2" }]]);
    const r = await applySupplierPaymentAllocation(tx, { paymentId: "p1", apOpenItemId: "oi1", allocatedAmount: new Prisma.Decimal(100), actorId: "user-b" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("SUPPLIER_MISMATCH");
  });

  it("CURRENCY_MISMATCH：币种不一致 → 409（同币种硬规则）", async () => {
    const tx = makeTx([[basePayment], [{ ...baseOpenItem, currency: "USD" }]]);
    const r = await applySupplierPaymentAllocation(tx, { paymentId: "p1", apOpenItemId: "oi1", allocatedAmount: new Prisma.Decimal(100), actorId: "user-b" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("CURRENCY_MISMATCH");
  });

  it("INVALID_AMOUNT：核销金额 ≤ 0 → 400", async () => {
    const tx = makeTx([[basePayment], [baseOpenItem]]);
    const r = await applySupplierPaymentAllocation(tx, { paymentId: "p1", apOpenItemId: "oi1", allocatedAmount: new Prisma.Decimal(0), actorId: "user-b" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INVALID_AMOUNT");
  });

  it("OVER_ALLOCATION：核销超过未结项剩余 → 409 防超核销（锁内重算）", async () => {
    const tx = makeTx([[basePayment], [baseOpenItem]]);
    const r = await applySupplierPaymentAllocation(tx, { paymentId: "p1", apOpenItemId: "oi1", allocatedAmount: new Prisma.Decimal(600), actorId: "user-b" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("OVER_ALLOCATION");
  });

  it("OVER_PAYMENT：核销超过付款单未核销余额 → 409", async () => {
    const tx = makeTx([[{ ...basePayment, unallocatedAmount: "50.0000" }], [baseOpenItem]]);
    const r = await applySupplierPaymentAllocation(tx, { paymentId: "p1", apOpenItemId: "oi1", allocatedAmount: new Prisma.Decimal(100), actorId: "user-b" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("OVER_PAYMENT");
  });

  it("成功部分核销：openAmount 500-100=400；payment status PARTIALLY_ALLOCATED；核销行创建", async () => {
    const tx = makeTx([[basePayment], [baseOpenItem]]);
    const r = await applySupplierPaymentAllocation(tx, { paymentId: "p1", apOpenItemId: "oi1", allocatedAmount: new Prisma.Decimal(100), actorId: "user-b" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.openAmountAfter).toBe("400.0000");
    expect(r.unallocatedAmountAfter).toBe("900.0000");
    expect(tx.supplierPaymentAllocation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ paymentId: "p1", apOpenItemId: "oi1", allocatedBy: "user-b" }) }),
    );
    expect(tx.supplierPayment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PARTIALLY_ALLOCATED" }) }),
    );
    expect(tx.apOpenItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ openAmount: expect.any(Prisma.Decimal) }) }),
    );
  });

  it("成功全额核销：openAmount 归零；payment status ALLOCATED", async () => {
    const tx = makeTx([[basePayment], [baseOpenItem]]);
    const r = await applySupplierPaymentAllocation(tx, { paymentId: "p1", apOpenItemId: "oi1", allocatedAmount: new Prisma.Decimal(500), actorId: "user-b" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.openAmountAfter).toBe("0.0000");
    expect(tx.supplierPayment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "ALLOCATED" }) }),
    );
  });
});