import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta } from '@/lib/api-helpers';
import { ok, fail, failConflict, failNotFound, failServer } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import {
  effectiveToleranceRate,
  computeReceiveCeiling,
  acceptedReceiptQty,
  computeRemainingReceiveQty,
} from '@/lib/purchase-receipt/helpers';
import {
  publishPurchaseReceiptEvent,
  publishPurchaseOrderReceiptProjectionEvent,
} from '@/lib/purchase-receipt/events';

export const dynamic = 'force-dynamic';

/**
 * POST /api/purchase-receipts/:id/receive —— **CTO Gate（Receive 事务）**
 * 最终验收口径（CTO #6941，8 条硬规则）：
 * ① **PO 状态**：仅 `CONFIRMED / PARTIALLY_RECEIVED` 可正常收货；`RECEIVED` 和其他状态一律拒绝；
 * ② **行归属**：每个 `purchaseOrderLineId` 必须属于当前 Receipt 对应 PO；
 * ③ **履约类型**：WAREHOUSE 行要求有效 warehouse；DIRECT_PROJECT 不要求 warehouse，且 Receipt 不得修改 PO Line 的 fulfillmentType；
 * ④ **数量事实**：`quantity`=物理到货毛数量；`acceptedQty = quantity - rejectedOnReceiptQty`；`0 <= rejectedOnReceiptQty <= quantity`；
 * ⑤ **并发**：所有涉及 PO Line 必须事务内 `FOR UPDATE` 后再算 ceiling、receivedQty、remainingReceiveQty；
 * ⑥ **超收**：`overReceiptToleranceRate` 统一用 rate，null 时按 **System Default 0**（不虚构 Supplier/Item policy）；
 * ⑦ **remainingReceiveQty 语义**：正常合同未交量 = `max(quantity - newReceivedQty, 0)`；tolerance 只用于 receive ceiling；
 * ⑧ **事件**：只有 receive 事务成功提交后才发 `PurchaseReceiptReceived`（DRAFT 创建不发）。
 * 红线：**5B 永不直接写库存余额 / Stock / InventoryMovement**（6A 唯一事实源）；PO 聚合状态：全部正常履约完成→RECEIVED，否则→PARTIALLY_RECEIVED。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  // receive 映射现有动作（普通收货是事实记录动作，不走审批 P1b → :edit；超收/特殊退货才走 Workflow + :approve）
  const denied = requirePermission(user, 'purchase-receipt:edit');
  if (denied) return denied;
  requestLog(request, user?.id, 'purchase-receipt.receive');

  const { id } = await params;
  const meta = requestMeta(request);
  const actorId = user!.id;

  const result = await prisma.$transaction(async (tx) => {
    // ① Lock PurchaseReceipt（FOR UPDATE）
    const lockedReceipt = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "PurchaseReceipt" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
    );
    if (lockedReceipt.length === 0) return { error: 'NOT_FOUND' as const };

    const receipt = await tx.purchaseReceipt.findFirst({
      where: { id, deletedAt: null },
      include: {
        lines: { where: { deletedAt: null }, orderBy: { lineNo: 'asc' } },
      },
    });
    if (!receipt) return { error: 'NOT_FOUND' as const };

    // ② 收货单状态门禁：仅 DRAFT 可执行 Receive（已 RECEIVED/CANCELLED 拒绝）
    if (receipt.status !== 'DRAFT') {
      return { error: 'INVALID_STATE' as const, status: receipt.status };
    }
    if (receipt.lines.length === 0) {
      return { error: 'NO_LINES' as const };
    }

    // ③ Lock PO（FOR UPDATE）
    const lockedPo = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "PurchaseOrder" WHERE "id" = ${receipt.purchaseOrderId} AND "deletedAt" IS NULL FOR UPDATE`,
    );
    if (lockedPo.length === 0) return { error: 'PO_NOT_FOUND' as const };

    const po = await tx.purchaseOrder.findFirst({
      where: { id: receipt.purchaseOrderId, deletedAt: null },
      include: { supplier: { select: { id: true, isActive: true } } },
    });
    if (!po) return { error: 'PO_NOT_FOUND' as const };

    // ④ PO 状态 Gate（规则①）
    if (po.status !== 'CONFIRMED' && po.status !== 'PARTIALLY_RECEIVED') {
      return { error: 'PO_STATE_FORBIDDEN' as const, status: po.status };
    }
    if (!po.supplier || po.supplier.isActive === false) {
      return { error: 'SUPPLIER_NOT_FOUND' as const };
    }

    // ⑤ WAREHOUSE 行必须有有效 warehouse（规则③；DIRECT_PROJECT 不要求）
    const poLineIds = [...new Set(receipt.lines.map((l) => l.purchaseOrderLineId))];
    const poLines = await tx.purchaseOrderLine.findMany({
      where: { id: { in: poLineIds }, deletedAt: null },
      select: {
        id: true,
        purchaseOrderId: true,
        fulfillmentType: true,
        quantity: true,
        receivedQty: true,
        remainingReceiveQty: true,
        overReceiptToleranceRate: true,
      },
    });
    if (poLines.length !== poLineIds.length) {
      return { error: 'LINE_PO_MISMATCH' as const }; // 行不属于该 PO（规则②）
    }
    const poLineById = new Map(poLines.map((l) => [l.id, l]));

    const needsWarehouse = receipt.lines.some(
      (rl) => poLineById.get(rl.purchaseOrderLineId)?.fulfillmentType === 'WAREHOUSE',
    );
    if (needsWarehouse) {
      if (!receipt.warehouseId) {
        return { error: 'WAREHOUSE_REQUIRED' as const };
      }
      const wh = await tx.warehouse.findFirst({
        where: { id: receipt.warehouseId, deletedAt: null, isActive: true },
        select: { id: true },
      });
      if (!wh) {
        return { error: 'WAREHOUSE_INVALID' as const };
      }
    }

    // ⑥ 逐行校验（规则②③④⑤⑥）：行归属 + 数量公式 + ceiling（均在 FOR UPDATE 锁内）
    const lineUpdates: Array<{ id: string; quantity: Prisma.Decimal; receivedQty: Prisma.Decimal; remainingReceiveQty: Prisma.Decimal }> = [];
    for (const rl of receipt.lines) {
      const poLine = poLineById.get(rl.purchaseOrderLineId);
      if (!poLine || poLine.purchaseOrderId !== receipt.purchaseOrderId) {
        return { error: 'LINE_PO_MISMATCH' as const }; // 规则②：行必须属于同一 PO
      }

      // 规则④：数量事实
      if (rl.quantity.lte(0)) {
        return { error: 'QUANTITY_INVALID' as const };
      }
      if (rl.rejectedOnReceiptQty.lt(0) || rl.rejectedOnReceiptQty.gt(rl.quantity)) {
        return { error: 'QUANTITY_INVALID' as const }; // 0 <= rejectedOnReceiptQty <= quantity
      }
      const accepted = acceptedReceiptQty(rl.quantity, rl.rejectedOnReceiptQty); // quantity - rejectedOnReceiptQty
      const newReceivedQty = poLine.receivedQty.plus(accepted); // receivedQty_new = receivedQty_old + accepted（不是 += quantity）

      // 规则⑥：超收 ceiling（rate 单位；null → System Default 0，不虚构 Supplier/Item policy）
      const tolerance = effectiveToleranceRate(poLine.overReceiptToleranceRate);
      const ceiling = computeReceiveCeiling(poLine.quantity, tolerance); // PO qty × (1 + rate)
      if (newReceivedQty.gt(ceiling)) {
        return { error: 'OVER_RECEIPT' as const, poLineId: poLine.id };
      }

      // 规则⑦：remainingReceiveQty = 正常合同未交量 max(quantity - newReceivedQty, 0)（服务端唯一计算）
      const remaining = computeRemainingReceiveQty(poLine.quantity, newReceivedQty);

      lineUpdates.push({ id: poLine.id, quantity: poLine.quantity, receivedQty: newReceivedQty, remainingReceiveQty: remaining });
    }

    // ⑦ 回写 PO Line 投影（receivedQty / remainingReceiveQty 服务端唯一回写）
    for (const u of lineUpdates) {
      await tx.purchaseOrderLine.update({
        where: { id: u.id },
        data: {
          receivedQty: u.receivedQty,
          remainingReceiveQty: u.remainingReceiveQty,
          updatedById: actorId,
        },
      });
    }

    // ⑧ Receipt → RECEIVED（收货完成事实；普通收货不走审批 P1b）
    await tx.purchaseReceipt.update({
      where: { id: receipt.id },
      data: { status: 'RECEIVED', receivedAt: new Date(), receivedById: actorId, updatedById: actorId },
    });

    // ⑨ PO 聚合状态（规则⑧）：全部正常履约数量完成 → RECEIVED；否则 PARTIALLY_RECEIVED
    const allPoLines = await tx.purchaseOrderLine.findMany({
      where: { purchaseOrderId: po.id, deletedAt: null },
      select: { quantity: true, receivedQty: true },
    });
    const allReceived = allPoLines.length > 0 && allPoLines.every((l) => l.receivedQty.gte(l.quantity));
    const newPoStatus = allReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
    await tx.purchaseOrder.update({
      where: { id: po.id },
      data: { status: newPoStatus, updatedById: actorId },
    });

    return {
      ok: true as const,
      receiptId: receipt.id,
      receiptCode: receipt.code,
      purchaseOrderId: po.id,
      purchaseOrderCode: po.code,
      poStatus: newPoStatus,
      supplierId: po.supplierId,
    };
  });

  if ('error' in result) {
    switch (result.error) {
      case 'NOT_FOUND':
        return failNotFound(ERROR_CODES.PURCHASE_RECEIPT_NOT_FOUND, '收货单不存在');
      case 'INVALID_STATE':
        return failConflict(
          ERROR_CODES.PURCHASE_RECEIPT_INVALID_STATE,
          `收货单状态不允许收货（当前 ${result.status}）`,
        );
      case 'NO_LINES':
        return fail(ERROR_CODES.PURCHASE_RECEIPT_NO_LINES, '收货单没有行', 400);
      case 'PO_NOT_FOUND':
        return fail(ERROR_CODES.PURCHASE_RECEIPT_PO_NOT_FOUND, '采购订单不存在', 400);
      case 'PO_STATE_FORBIDDEN':
        return failConflict(
          ERROR_CODES.PURCHASE_RECEIPT_PO_STATE_FORBIDDEN,
          `仅 CONFIRMED / PARTIALLY_RECEIVED PO 可收货（当前 ${result.status}）；RECEIVED 禁普通新增收货`,
        );
      case 'SUPPLIER_NOT_FOUND':
        return fail(ERROR_CODES.PURCHASE_ORDER_SUPPLIER_NOT_FOUND, '供应商不存在或已停用', 400);
      case 'LINE_PO_MISMATCH':
        return fail(
          ERROR_CODES.PURCHASE_RECEIPT_LINE_PO_MISMATCH,
          '收货行不属于该采购订单（PO），拒绝收货',
          409,
        );
      case 'WAREHOUSE_REQUIRED':
        return fail(
          ERROR_CODES.PURCHASE_RECEIPT_WAREHOUSE_REQUIRED,
          'WAREHOUSE 收货行必须有有效 warehouseId（DIRECT_PROJECT 行不要求）',
          400,
        );
      case 'WAREHOUSE_INVALID':
        return fail(ERROR_CODES.PURCHASE_RECEIPT_WAREHOUSE_INVALID, '仓库不存在或已停用', 400);
      case 'QUANTITY_INVALID':
        return fail(ERROR_CODES.PURCHASE_RECEIPT_QUANTITY_INVALID, '收货数量不合法（quantity>0 且 0<=rejectedOnReceiptQty<=quantity）', 400);
      case 'OVER_RECEIPT':
        return failConflict(
          ERROR_CODES.PURCHASE_RECEIPT_OVER_RECEIPT,
          `超收超过容差 ceiling（System Default 0%；PO Line rate 可配置），拒绝收货`,
        );
      default:
        return failServer();
    }
  }

  // ⑩ 事务成功提交后发布事件（规则⑧：只有 receive 成功后发 PurchaseReceiptReceived）
  try {
    await publishPurchaseReceiptEvent({
      eventType: 'PurchaseReceiptReceived',
      actorId,
      entityId: result.receiptId,
      payload: {
        purchaseReceiptId: result.receiptId,
        purchaseReceiptCode: result.receiptCode,
        purchaseOrderId: result.purchaseOrderId,
        supplierId: result.supplierId,
        warehouseId: null,
        receivedById: actorId,
        receivedAt: new Date().toISOString(),
      },
      meta,
    });
    await publishPurchaseOrderReceiptProjectionEvent({
      eventType: result.poStatus === 'RECEIVED' ? 'PurchaseOrderReceived' : 'PurchaseOrderPartiallyReceived',
      actorId,
      entityId: result.purchaseOrderId,
      payload: {
        purchaseOrderId: result.purchaseOrderId,
        purchaseOrderCode: result.purchaseOrderCode,
        supplierId: result.supplierId,
        receivedQty: undefined,
        remainingReceiveQty: undefined,
      },
      meta,
    });
  } catch {
    // 事件发布失败不影响业务事实（AuditLog 尽力而为；总线落地后替换为可靠投递）
  }

  return ok({ id: result.receiptId, code: result.receiptCode, poStatus: result.poStatus });
}
