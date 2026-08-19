import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { upsertInboundCost } from "@/lib/inventory-cost/moving-average";

/**
 * 移动加权平均成本层单测（ADR-0038；D9 HOLD 解除）
 * 覆盖：首笔入库 avg / 移动平均更新 / 幂等跳过 / 数量/金额校验。
 * 验证事实源 = GitHub CI（本地不运行测试）。
 */

const d = (v: string) => new Prisma.Decimal(v);

function makeTx(overrides: Record<string, unknown> = {}) {
  return {
    inventoryCostSource: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
    inventoryCostBalance: {
      findFirst: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
    ...overrides,
  } as unknown as Prisma.TransactionClient;
}

describe("upsertInboundCost — 移动加权平均", () => {
  it("首笔入库：avg = baseAmount / quantity", async () => {
    const tx = makeTx();
    const r = await upsertInboundCost(tx, {
      itemId: "it1",
      quantity: d("10"),
      baseAmount: d("100.00"),
      sourceKey: "COST:ACCRUAL:WAREHOUSE_RECEIPT_LINE:l1",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.avgUnitCost).toBe("10.0000");
    expect(r.totalCost).toBe("100.0000");
    const upsert = (tx.inventoryCostBalance.upsert as any).mock.calls[0][0];
    expect(upsert.where.itemId).toBe("it1");
    expect(upsert.create.avgUnitCost.toFixed(4)).toBe("10.0000");
  });

  it("移动平均更新：已有 avg 10/数量 10/总额 100 + 新入库 10 件 200 → avg 15", async () => {
    const tx = makeTx({
      inventoryCostBalance: {
        findFirst: vi.fn().mockResolvedValue({ itemId: "it1", onHandQty: d("10"), totalCost: d("100.00"), avgUnitCost: d("10.0000") }),
        upsert: vi.fn().mockResolvedValue({}),
      },
    });
    const r = await upsertInboundCost(tx, {
      itemId: "it1",
      quantity: d("10"),
      baseAmount: d("200.00"),
      sourceKey: "COST:ACCRUAL:WAREHOUSE_RECEIPT_LINE:l2",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.onHandQty).toBe("20.0000");
    expect(r.totalCost).toBe("300.0000");
    expect(r.avgUnitCost).toBe("15.0000");
  });

  it("幂等：sourceKey 已存在 → 跳过更新", async () => {
    const tx = makeTx({
      inventoryCostSource: { findFirst: vi.fn().mockResolvedValue({ id: "s1" }), create: vi.fn() },
      inventoryCostBalance: { findFirst: vi.fn(), upsert: vi.fn() },
    });
    const r = await upsertInboundCost(tx, {
      itemId: "it1",
      quantity: d("10"),
      baseAmount: d("100.00"),
      sourceKey: "COST:ACCRUAL:WAREHOUSE_RECEIPT_LINE:l1",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.idempotent).toBe(true);
    expect(tx.inventoryCostBalance.upsert).not.toHaveBeenCalled();
  });

  it("数量 ≤ 0 → COST_INVALID_QTY", async () => {
    const tx = makeTx();
    const r = await upsertInboundCost(tx, {
      itemId: "it1",
      quantity: d("0"),
      baseAmount: d("100.00"),
      sourceKey: "COST:x",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("COST_INVALID_QTY");
  });

  it("成本为负 → COST_INVALID_AMOUNT", async () => {
    const tx = makeTx();
    const r = await upsertInboundCost(tx, {
      itemId: "it1",
      quantity: d("10"),
      baseAmount: d("-1"),
      sourceKey: "COST:x",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("COST_INVALID_AMOUNT");
  });
});
