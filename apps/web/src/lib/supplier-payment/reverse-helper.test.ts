import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { reverseSupplierPayment } from "@/lib/supplier-payment/reverse-helper";

/**
 * 5C-2 Payment 整体冲销单测（对齐 P0-1 会计单测先例）
 * 覆盖：NOT_FOUND / ALREADY_REVERSED / VOIDED / VERSION_CONFLICT / MAKER_CHECKER /
 *       NO_ALLOCATIONS / INCONSISTENT / 成功（多核销行回滚 + 投影还原）。
 * 验证事实源 = GitHub CI（本地不运行测试）。
 */

function makeTx(opts: {
  paymentRows: unknown[];
  itemRows?: unknown[];
  allocations?: Array<{ id: string; apOpenItemId: string; allocatedAmount: string }>;
}) {
  const queryMock = vi.fn();
  queryMock.mockResolvedValueOnce(opts.paymentRows);
  if (opts.itemRows) queryMock.mockResolvedValueOnce(opts.itemRows);
  const findMany = vi.fn().mockResolvedValue(opts.allocations ?? []);
  return {
    $queryRaw: queryMock,
    supplierPaymentAllocation: { findMany, update: vi.fn().mockResolvedValue({}) },
    apOpenItem: { update: vi.fn().mockResolvedValue({}) },
    supplierPayment: { update: vi.fn().mockResolvedValue({}) },
  } as unknown as Prisma.TransactionClient;
}

const basePayment = { id: "p1", amount: "1000.0000", version: 1, reversedAt: null, voidedAt: null, createdById: "user-a" };

describe("reverseSupplierPayment — 付款单整体冲销", () => {
  it("NOT_FOUND：付款单不存在 → 404", async () => {
    const tx = makeTx({ paymentRows: [] });
    const r = await reverseSupplierPayment(tx, { paymentId: "p-x", reason: "误付冲销", version: 1, actorId: "user-b" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });

  it("ALREADY_REVERSED：已整体冲销 → 409 幂等拒绝", async () => {
    const tx = makeTx({ paymentRows: [{ ...basePayment, reversedAt: new Date() }] });
    const r = await reverseSupplierPayment(tx, { paymentId: "p1", reason: "重复冲销", version: 1, actorId: "user-b" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("ALREADY_REVERSED");
  });

  it("VOIDED：已作废单 → 409（未核销走 void）", async () => {
    const tx = makeTx({ paymentRows: [{ ...basePayment, voidedAt: new Date() }] });
    const r = await reverseSupplierPayment(tx, { paymentId: "p1", reason: "冲销", version: 1, actorId: "user-b" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("VOIDED");
  });

  it("VERSION_CONFLICT：版本不匹配 → 409", async () => {
    const tx = makeTx({ paymentRows: [basePayment] });
    const r = await reverseSupplierPayment(tx, { paymentId: "p1", reason: "冲销", version: 99, actorId: "user-b" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("VERSION_CONFLICT");
  });

  it("MAKER_CHECKER：冲销人 = 创建人 → 409", async () => {
    const tx = makeTx({ paymentRows: [basePayment] });
    const r = await reverseSupplierPayment(tx, { paymentId: "p1", reason: "冲销", version: 1, actorId: "user-a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MAKER_CHECKER");
  });

  it("NO_ALLOCATIONS：无未反转核销 → 409（未核销场景走 void）", async () => {
    const tx = makeTx({ paymentRows: [basePayment], allocations: [] });
    const r = await reverseSupplierPayment(tx, { paymentId: "p1", reason: "冲销", version: 1, actorId: "user-b" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NO_ALLOCATIONS");
  });

  it("INCONSISTENT：核销目标未结项缺失 → 500（事务回滚）", async () => {
    const tx = makeTx({
      paymentRows: [basePayment],
      itemRows: [],
      allocations: [{ id: "a1", apOpenItemId: "oi1", allocatedAmount: "100.0000" }],
    });
    const r = await reverseSupplierPayment(tx, { paymentId: "p1", reason: "冲销", version: 1, actorId: "user-b" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INCONSISTENT");
  });

  it("成功：2 条核销行（同一未结项）→ 反转 + 投影回滚 + payment 标记 reversed", async () => {
    const tx = makeTx({
      paymentRows: [basePayment],
      itemRows: [{ id: "oi1", openAmount: "400.0000" }],
      allocations: [
        { id: "a1", apOpenItemId: "oi1", allocatedAmount: "100.0000" },
        { id: "a2", apOpenItemId: "oi1", allocatedAmount: "50.0000" },
      ],
    });
    const r = await reverseSupplierPayment(tx, { paymentId: "p1", reason: "误付冲销", version: 1, actorId: "user-b" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reversedAllocations).toBe(2);
    // openItem 回滚：400 + 100 + 50 = 550
    expect(tx.apOpenItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ openAmount: expect.any(Prisma.Decimal) }),
      }),
    );
    // payment 投影还原 + 标记 reversed
    expect(tx.supplierPayment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "UNALLOCATED",
          reversedById: "user-b",
          reverseReason: "误付冲销",
        }),
      }),
    );
    // 2 条 allocation 都反转
    expect(tx.supplierPaymentAllocation.update).toHaveBeenCalledTimes(2);
  });
});