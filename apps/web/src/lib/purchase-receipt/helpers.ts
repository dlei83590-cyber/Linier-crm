import { Prisma } from '@prisma/client';

/**
 * Sprint 5B - PurchaseReceipt（采购收货事实）领域通用函数（**不放路由逻辑**；对齐 PO/PR/Invoice helpers 模式）
 * 设计依据：ADR-0024（Approved with Changes）+ CTO Phase 2 Review 98/100 APPROVED（2026-08-09）：
 * - **PurchaseReceipt = 到货/收货现场事实**（Blocking ③：只保留现场事实，不承载 QC——质量判定归 Inspection）；
 * - code DocumentSequence **创建即取号**（REC-2026-xxxx；docType=PURCHASE_RECEIPT 为 5B 新增，seed 已存在，不重复新增）；
 * - **生命周期**：DRAFT → RECEIVED（普通收货不走审批，P1b Final）；DRAFT → CANCELLED；超收/特殊退货才走 Workflow；
 * - **Receive 硬规则（CTO #6923）**：
 *   ① PO 状态 Gate：只允许 CONFIRMED / PARTIALLY_RECEIVED 进入正常收货；RECEIVED 拒绝普通新增收货；其余全拒；
 *   ② 收货对象必须属于同一个 PO（line.purchaseOrderLineId → PurchaseOrderLine.purchaseOrderId === receipt.purchaseOrderId）；
 *   ③ fulfillmentType 分流：WAREHOUSE 行必须有有效 warehouseId；DIRECT_PROJECT 行不要求 warehouse；禁静默改 fulfillmentType；
 *   ④ 数量公式：quantity = 物理到货毛数量（>0）；0 <= rejectedOnReceiptQty <= quantity；
 *      **acceptedReceiptQty = quantity - rejectedOnReceiptQty；receivedQty_new = receivedQty_old + acceptedReceiptQty**（禁 receivedQty += quantity）；
 *   ⑤ 超收 ceiling：PO quantity × (1 + effectiveToleranceRate)；overReceiptToleranceRate null → **System Default 0**（不伪造 Supplier/Item policy）；
 *   ⑥ **FOR UPDATE 锁 PO Line 防并发超收**（Receive 事务内）；⑦ remainingReceiveQty 服务端唯一 = max(quantity - receivedQty, 0)
 *     （tolerance 只用于 receive ceiling 校验；未来另算 receivableQtyWithTolerance）；⑧ Event 只在 Receive 成功后产生；
 * - **红线**：5B 永不直接写库存余额 / Stock / InventoryMovement（6A 唯一事实源）。
 */

/** DocumentSequence 原子取号（docType=PURCHASE_RECEIPT，前缀 REC，位数 6；创建即取号） */
export async function nextPurchaseReceiptCode(tx: Prisma.TransactionClient): Promise<string> {
  const seq = await tx.documentSequence.findFirst({
    where: { docType: 'PURCHASE_RECEIPT', isActive: true, deletedAt: null },
  });
  const prefix = seq?.prefix ?? 'REC';
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

/** 有效超收容差（rate 单位：0.050000 = 5%）：PO Line override 未配置 → System Default 0（CTO #6923 规则⑤，不伪造 Supplier/Item policy） */
export function effectiveToleranceRate(poLineTolerance: Prisma.Decimal | null): Prisma.Decimal {
  return poLineTolerance ?? new Prisma.Decimal(0);
}

/** Receive ceiling = PO 订购数量 × (1 + effectiveToleranceRate)（超收上限，仅用于校验，不改变 remainingReceiveQty 语义） */
export function computeReceiveCeiling(poQuantity: Prisma.Decimal, toleranceRate: Prisma.Decimal): Prisma.Decimal {
  return poQuantity.times(new Prisma.Decimal(1).plus(toleranceRate));
}

/** 被采购履约接受数量 = 物理到货毛数量 - 现场拒收数量（CTO #6923 规则④） */
export function acceptedReceiptQty(quantity: Prisma.Decimal, rejectedOnReceiptQty: Prisma.Decimal): Prisma.Decimal {
  return quantity.minus(rejectedOnReceiptQty);
}

/** remainingReceiveQty = max(quantity - receivedQty, 0)：采购订单**正常未交量**（服务端唯一计算，CTO #6923 规则⑦；
 * tolerance 只用于 receive ceiling 校验，未来如需展示"还能超收多少"另算 receivableQtyWithTolerance） */
export function computeRemainingReceiveQty(poQuantity: Prisma.Decimal, receivedQty: Prisma.Decimal): Prisma.Decimal {
  const remaining = poQuantity.minus(receivedQty);
  return remaining.isNegative() ? new Prisma.Decimal(0) : remaining;
}
