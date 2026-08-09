import { Prisma } from '@prisma/client';

/**
 * Sprint 5B - PurchaseReturn（采购退货独立事实，P5 Final）领域通用函数（**不放路由逻辑**；对齐 PO/PR/PurchaseReceipt/Inspection/WarehouseReceipt helpers 模式）
 * 设计依据：ADR-0024（Approved with Changes）+ CTO WarehouseReceipt Final Re-review 98/100 APPROVED（#7219）：
 * - **PurchaseReturn = 采购退货独立事实**（P5：非负 GR；必须有真实来源 + disposition；不反向修改 GR）；
 * - **三来源（exactly-one FK + API 强制匹配）**：RECEIPT_LINE / WAREHOUSE_RECEIPT_LINE / INSPECTION；
 *   - RECEIPT_LINE / INSPECTION = **未入库退货**（不碰库存）；
 *   - WAREHOUSE_RECEIPT_LINE = **已入库退货**（来源必须来自 POSTED 入库事实；**当前仍不得写 InventoryMovement(OUT)**——6A 唯一事实源）；
 * - **可退余额**：`quantity <= 来源可退余额`，且 **Return Gate 锁真实来源并在锁内重算累计 RETURNED**（防多张退货单并发超退，不能只在 Create/PATCH 预检查）；
 * - **disposition**：REPLACE_REQUIRED = 供应商仍欠货（重新打开 PO 履约剩余待交）；CREDIT_ONLY = 采购数量最终减少/财务冲减（不自动重开待交）；
 * - **红线**：5B 永不直接写库存余额 / Stock / InventoryMovement（6A 唯一事实源）；已入库退货也只记录 PurchaseReturn 事实，不写库存 OUT；财务冲减/红字发票/AP 属 5C。
 */

/** DocumentSequence 原子取号（docType=PURCHASE_RETURN，前缀 PRT，位数 6；创建即取号） */
export async function nextPurchaseReturnCode(tx: Prisma.TransactionClient): Promise<string> {
  const seq = await tx.documentSequence.findFirst({
    where: { docType: 'PURCHASE_RETURN', isActive: true, deletedAt: null },
  });
  const prefix = seq?.prefix ?? 'PRT';
  const padLength = seq?.padLength ?? 6;
  if (seq) {
    const updated = await tx.documentSequence.update({
      where: { id: seq.id },
      data: { nextNo: { increment: 1 } },
    });
    return `${prefix}${String(updated.nextNo - 1).padStart(padLength, '0')}`;
  }
  return `${prefix}${String(1).padStart(padLength, '0')}`;
}

/** 某来源已被 **RETURNED 退货单** 占用的累计退货数量（CTO #7219：Return Gate 锁内重算，防并发超退；DRAFT 不占额度） */
export async function computeSourceReturnedQty(
  tx: Prisma.TransactionClient,
  sourceRefType: 'RECEIPT_LINE' | 'WAREHOUSE_RECEIPT_LINE' | 'INSPECTION',
  sourceId: string,
  excludePurchaseReturnId?: string,
): Promise<Prisma.Decimal> {
  const base = {
    deletedAt: null,
    ...(excludePurchaseReturnId
      ? { purchaseReturnId: { not: excludePurchaseReturnId } }
      : {}),
    purchaseReturn: { deletedAt: null, status: 'RETURNED' },
  };
  const where =
    sourceRefType === 'RECEIPT_LINE'
      ? { ...base, sourcePurchaseReceiptLineId: sourceId }
      : sourceRefType === 'WAREHOUSE_RECEIPT_LINE'
        ? { ...base, sourceWarehouseReceiptLineId: sourceId }
        : { ...base, sourceInspectionId: sourceId };
  const agg = await tx.purchaseReturnLine.aggregate({
    where,
    _sum: { quantity: true },
  });
  return agg._sum.quantity ?? new Prisma.Decimal(0);
}

/** 可退余额 = 来源可退数量 - 已 RETURNED 占用（CTO #7219：退货数量不得超过来源可退余额） */
export function computeSourceAvailableQty(
  sourceReturnableQty: Prisma.Decimal,
  returnedQty: Prisma.Decimal,
): Prisma.Decimal {
  const available = sourceReturnableQty.minus(returnedQty);
  return available.isNegative() ? new Prisma.Decimal(0) : available;
}
