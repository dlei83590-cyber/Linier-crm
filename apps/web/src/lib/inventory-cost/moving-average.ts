import { Prisma } from '@prisma/client';

/**
 * 移动加权平均成本层（D9 HOLD 解除，ADR-0038）
 * - upsertInboundCost：WHR POSTED 同事务（GRIR ACCRUAL 后）按 PO 未税单价更新：avg' = (totalCost + baseAmount) / (onHandQty + qty)
 * - 幂等：sourceKey（COST:WAREHOUSE_RECEIPT_LINE:{lineId}）@unique 兜底；成本层独立，不写 Movement/StockProjection（6A 红线）
 * - 出库结转/COGS 属后续 backlog（本文件不含 OUT 逻辑）
 */

export interface InboundCostParams {
  itemId: string;
  quantity: Prisma.Decimal;
  baseAmount: Prisma.Decimal; // 未税采购成本（GRIR baseAmount 口径，P9）
  sourceKey: string; // 幂等键：COST:WAREHOUSE_RECEIPT_LINE:{lineId}
  actorId?: string | null;
}

export type InboundCostResult =
  | { ok: true; onHandQty: string; totalCost: string; avgUnitCost: string; idempotent: boolean }
  | { ok: false; code: string; message: string; httpStatus: number };

/** WHR POSTED 事务内：入库移动平均更新（同事务；重复 sourceKey 幂等跳过） */
export async function upsertInboundCost(
  tx: Prisma.TransactionClient,
  params: InboundCostParams,
): Promise<InboundCostResult> {
  if (params.quantity.lte(0)) {
    return { ok: false, code: 'COST_INVALID_QTY', message: '入库数量必须大于 0', httpStatus: 400 };
  }
  if (params.baseAmount.isNegative()) {
    return { ok: false, code: 'COST_INVALID_AMOUNT', message: '入库成本不能为负', httpStatus: 400 };
  }

  // 幂等：sourceKey 唯一（与 GRIR ACCRUAL 同事务，重复 POST 不重复累计成本）
  const existing = await tx.inventoryCostSource.findFirst({ where: { sourceKey: params.sourceKey } });
  if (existing) return { ok: true, onHandQty: '0', totalCost: '0', avgUnitCost: '0', idempotent: true };

  const balance = await tx.inventoryCostBalance.findFirst({ where: { itemId: params.itemId } });

  let onHandQty: Prisma.Decimal;
  let totalCost: Prisma.Decimal;
  let avgUnitCost: Prisma.Decimal;
  if (!balance || balance.onHandQty.eq(0)) {
    // 首笔入库：avg = baseAmount / quantity
    onHandQty = params.quantity;
    totalCost = params.baseAmount;
    avgUnitCost = params.quantity.gt(0) ? params.baseAmount.div(params.quantity).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP) : new Prisma.Decimal(0);
  } else {
    // 移动平均：avg' = (totalCost + baseAmount) / (onHandQty + qty)
    onHandQty = balance.onHandQty.add(params.quantity);
    totalCost = balance.totalCost.add(params.baseAmount);
    avgUnitCost = onHandQty.gt(0) ? totalCost.div(onHandQty).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP) : new Prisma.Decimal(0);
  }

  await tx.inventoryCostBalance.upsert({
    where: { itemId: params.itemId },
    update: {
      onHandQty,
      totalCost,
      avgUnitCost,
      version: { increment: 1 },
      updatedById: params.actorId ?? null,
      updatedAt: new Date(),
    },
    create: {
      itemId: params.itemId,
      onHandQty,
      totalCost,
      avgUnitCost,
      createdById: params.actorId ?? null,
      updatedById: params.actorId ?? null,
    },
  });

  // 幂等源记录（防重复累计）
  await tx.inventoryCostSource.create({
    data: { sourceKey: params.sourceKey, itemId: params.itemId, quantity: params.quantity, baseAmount: params.baseAmount, createdById: params.actorId ?? null },
  });

  return {
    ok: true,
    onHandQty: onHandQty.toFixed(4),
    totalCost: totalCost.toFixed(4),
    avgUnitCost: avgUnitCost.toFixed(4),
    idempotent: false,
  };
}
