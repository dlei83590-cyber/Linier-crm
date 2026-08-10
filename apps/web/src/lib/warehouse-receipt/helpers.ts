import { Prisma } from '@prisma/client';

/**
 * Sprint 5B - WarehouseReceipt（采购入库事实）领域通用函数（**不放路由逻辑**；对齐 PO/PR/PurchaseReceipt/Inspection helpers 模式）
 * 设计依据：ADR-0024（Approved with Changes）+ CTO Inspection API Final Re-review 98/100 APPROVED（#7135）：
 * - **WarehouseReceipt = 采购入库事实**（D10：Created ≠ Posted，只有 POSTED 才触发 6A InventoryMovement(IN)）；
 * - **消费方 Gate**：入库行只能消费**已完成且 qualifiedQty > 0** 的 Inspection（组合 FK [inspectionId, purchaseReceiptLineId] 保证 Inspection 属于同一收货行——Schema Integrity B①）；
 * - **数量 ceiling**：`quantity <= qualifiedQty`，且**累计入库（仅 POSTED 单行——CTO #7192：只有 POSTED 消耗正式可入库额度，DRAFT 不占额度）不得超过该 Inspection 可入库余额**；
 * - **DIRECT_PROJECT 禁入库**（P4 Final：直送不入库、无 InventoryMovement(IN)）——仅 WAREHOUSE 履约行可建 WarehouseReceipt；
 * - **Warehouse-Location 同属**（组合 FK [locationId, warehouseId]——Schema Integrity B②）；
 * - **红线**：5B 永不直接写库存余额 / Stock / InventoryMovement（6A 唯一事实源；D10：只有 POSTED 才触发 6A InventoryMovement(IN)）。
 */

/** DocumentSequence 原子取号（docType=WAREHOUSE_RECEIPT，前缀 WHR，位数 6；创建即取号） */
export async function nextWarehouseReceiptCode(tx: Prisma.TransactionClient): Promise<string> {
  const seq = await tx.documentSequence.findFirst({
    where: { docType: 'WAREHOUSE_RECEIPT', isActive: true, deletedAt: null },
  });
  const prefix = seq?.prefix ?? 'WHR';
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

/** 某 Inspection 已被 **POSTED 入库单** 占用的累计数量（CTO #7192 Blocking：**只有 POSTED 才消耗正式可入库额度**，
 * 对齐 ADR-0024 Created ≠ Posted；DRAFT 单不占额度——否则 Post 会双计本单 DRAFT 数量导致正常入库被误拒）。
 * 可入库余额 = qualifiedQty - postedUsedQty。
 */
export async function computeInspectionUsedQty(
  tx: Prisma.TransactionClient,
  inspectionId: string,
  excludeWarehouseReceiptId?: string,
): Promise<Prisma.Decimal> {
  const agg = await tx.warehouseReceiptLine.aggregate({
    where: {
      inspectionId,
      deletedAt: null,
      ...(excludeWarehouseReceiptId
        ? { warehouseReceiptId: { not: excludeWarehouseReceiptId } }
        : {}),
      warehouseReceipt: { deletedAt: null, status: 'POSTED' },
    },
    _sum: { quantity: true },
  });
  return agg._sum.quantity ?? new Prisma.Decimal(0);
}

/** 可入库余额 = qualifiedQty - 已占用（CTO #7135：累计入库不得超过对应 Inspection 可入库余额） */
export function computeInspectionAvailableQty(
  qualifiedQty: Prisma.Decimal,
  usedQty: Prisma.Decimal,
): Prisma.Decimal {
  const available = qualifiedQty.minus(usedQty);
  return available.isNegative() ? new Prisma.Decimal(0) : available;
}
