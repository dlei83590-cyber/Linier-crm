import { Prisma } from '@prisma/client';

/**
 * Sprint 5B - Inspection（质检唯一事实源）领域通用函数（**不放路由逻辑**；对齐 PO/PR/PurchaseReceipt helpers 模式）
 * 设计依据：ADR-0024（Approved with Changes）+ CTO PurchaseReceipt API Final Re-check 97/100 APPROVED（#7045）：
 * - **Inspection = QC 唯一事实源**（Blocking ③）：PurchaseReceipt 只留现场事实（quantity/visibleDamageQty/rejectedOnReceiptQty），
 *   质量判定归 Inspection；链 `PurchaseReceipt → Inspection → WarehouseReceipt → 6A InventoryMovement(IN)`；
 * - **来源 Gate**：只有已经 **RECEIVED** 的 PurchaseReceiptLine 才能被检验（CTO #7045：来源必须是已经 RECEIVED 的 PurchaseReceiptLine）；
 * - **可检数量**：`inspectableQty = quantity - rejectedOnReceiptQty`——PurchaseReceipt.quantity 已包含现场拒收部分，
 *   质检的最大可检数量**不得再次包含现场拒收**（CTO #7045 推荐公式）；
 * - **数量关系（一次 Inspection 即最终检验结果 → =）**：`qualifiedQty >= 0`、`rejectedQty >= 0`、
 *   `qualifiedQty + rejectedQty === inspectableQty`（CTO #7045：一次 Inspection 代表最终检验结果时用 `=`；
 *   未来允许多轮/抽检需先明确累计语义，本版不猜测）；
 * - **免检**：SKIP + QUALIFIED 是免检，**不允许绕开 Inspection**（SKIP 也要落 Inspection 记录并 complete 置 QUALIFIED，
 *   qualifiedQty = inspectableQty、rejectedQty = 0）；
 * - **消费方 Gate**：WarehouseReceipt 未来只能消费已经完成且具有 qualifiedQty 的 Inspection；
 * - **红线**：Inspection API **禁止写 Stock / InventoryMovement / WarehouseReceipt**（6A 唯一事实源；D10：只有 WarehouseReceipt Posted 才触发 6A）。
 */

/** 可检数量 = 物理到货毛数量 - 现场拒收数量（CTO #7045：最大可检数量不应再次包含现场拒收部分） */
export function computeInspectableQty(
  quantity: Prisma.Decimal,
  rejectedOnReceiptQty: Prisma.Decimal,
): Prisma.Decimal {
  return quantity.minus(rejectedOnReceiptQty);
}

/** 检验结论推导（服务端唯一，客户端不得传 result）：合格=可检数 → QUALIFIED；全部拒收 → REJECTED；部分 → PARTIAL */
export function deriveInspectionResult(
  qualifiedQty: Prisma.Decimal,
  inspectableQty: Prisma.Decimal,
): 'QUALIFIED' | 'PARTIAL' | 'REJECTED' {
  if (qualifiedQty.gte(inspectableQty)) return 'QUALIFIED';
  if (qualifiedQty.isZero()) return 'REJECTED';
  return 'PARTIAL';
}

/** 免检结论（SKIP）：qualifiedQty = inspectableQty、rejectedQty = 0、result = QUALIFIED（不绕开 Inspection 记录） */
export function skipInspectionVerdict(inspectableQty: Prisma.Decimal): {
  result: 'QUALIFIED';
  qualifiedQty: Prisma.Decimal;
  rejectedQty: Prisma.Decimal;
} {
  return { result: 'QUALIFIED', qualifiedQty: inspectableQty, rejectedQty: new Prisma.Decimal(0) };
}
