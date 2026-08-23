import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, failConflict, failNotFound } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { recycleDocumentSequence } from '@/lib/document-sequence/recycle';

export const dynamic = 'force-dynamic';

/**
 * POST /api/warehouse-receipts/:id/unwind —— 一键全链条回退（用户指令 2026-08-21）
 * 错误入库反操作的整链回退（单事务）：
 *   退货单（软删+回收单号）→ 质检（软删）→ 反收货回滚（PO 行 receivedQty）→ 收货单（软删+回收）
 *   → 采购订单（软删+回收，无其他收货/退货下链时）→ 采购申请（CONVERTED→APPROVED→软删+回收）。
 * 前置：WHR 已 POSTED 且全部行已 RETURNED 退货（或 DRAFT/CANCELLED 无下链）。
 * 红线：GRIR/库存/财务历史事实保留（不删）；仅回退业务单据与投影并回收单号。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'warehouse-receipt:edit');
  if (denied) return denied;
  requestLog(request, user?.id, 'warehouse-receipt.unwind');

  const { id } = await params;
  const meta = requestMeta(request);
  const actorId = user!.id;

  const result = await prisma.$transaction(async (tx) => {
    // ① Lock WHR
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "WarehouseReceipt" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
    );
    if (locked.length === 0) return { error: 'NOT_FOUND' as const };
    const whr = await tx.warehouseReceipt.findFirst({
      where: { id, deletedAt: null },
      include: { lines: { where: { deletedAt: null } } },
    });
    if (!whr) return { error: 'NOT_FOUND' as const };
    const now = new Date();
    const zero = new Prisma.Decimal(0);

    // ② 前置：POSTED 必须全部行已 RETURNED 退货（错误入库反操作已闭环）
    if (whr.status === 'POSTED') {
      const whrLineIds = whr.lines.map((l) => l.id);
      const totalWhr = whr.lines.reduce((s, l) => s.plus(l.quantity), zero);
      const returnedAgg = await tx.purchaseReturnLine.aggregate({
        where: {
          sourceRefType: 'WAREHOUSE_RECEIPT_LINE',
          sourceWarehouseReceiptLineId: { in: whrLineIds },
          purchaseReturn: { status: 'RETURNED', deletedAt: null },
          deletedAt: null,
        },
        _sum: { quantity: true },
      });
      const totalReturned = returnedAgg._sum.quantity ?? zero;
      if (totalReturned.lt(totalWhr)) {
        return { error: 'NOT_FULLY_RETURNED' as const };
      }
    } else if (whr.status !== 'DRAFT' && whr.status !== 'CANCELLED') {
      return { error: 'INVALID_STATE' as const, status: whr.status };
    }

    // ③ 删除该 WHR 行的退货单（软删 + 回收单号）
    const whrLineIds = whr.lines.map((l) => l.id);
    const retLineRows = whrLineIds.length
      ? await tx.purchaseReturnLine.findMany({
          where: {
            sourceRefType: 'WAREHOUSE_RECEIPT_LINE',
            sourceWarehouseReceiptLineId: { in: whrLineIds },
            deletedAt: null,
          },
          select: { purchaseReturnId: true },
        })
      : [];
    const returnIds = [...new Set(retLineRows.map((l) => l.purchaseReturnId))];
    for (const rid of returnIds) {
      const rt = await tx.purchaseReturn.findFirst({ where: { id: rid, deletedAt: null }, select: { code: true } });
      await tx.purchaseReturn.update({ where: { id: rid }, data: { deletedAt: now, isActive: false, updatedById: actorId } });
      await tx.purchaseReturnLine.updateMany({ where: { purchaseReturnId: rid, deletedAt: null }, data: { deletedAt: now, isActive: false } });
      if (rt) await recycleDocumentSequence(tx, 'PURCHASE_RETURN', rt.code);
    }

    // ④ 删除该收货单的质检（软删；反质检）
    const inspRows = await tx.inspection.findMany({
      where: { purchaseReceiptLine: { purchaseReceiptId: whr.purchaseReceiptId }, deletedAt: null },
      select: { id: true },
    });
    for (const ins of inspRows) {
      await tx.inspection.update({ where: { id: ins.id }, data: { deletedAt: now, isActive: false, updatedById: actorId } });
    }

    // ⑤ 反收货回滚：PO 行 receivedQty -= accepted（收货单 RECEIVED → DRAFT）
    const rc = await tx.purchaseReceipt.findFirst({
      where: { id: whr.purchaseReceiptId, deletedAt: null },
      include: { lines: { where: { deletedAt: null } } },
    });
    if (!rc) return { error: 'RECEIPT_NOT_FOUND' as const };
    if (rc.status === 'RECEIVED') {
      const poLineIds = [...new Set(rc.lines.map((l) => l.purchaseOrderLineId).filter(Boolean))].sort();
      const poLines = await tx.purchaseOrderLine.findMany({
        where: { id: { in: poLineIds }, deletedAt: null },
        select: { id: true, quantity: true, receivedQty: true },
      });
      const lineById = new Map(poLines.map((l) => [l.id, l]));
      for (const rl of rc.lines) {
        const pol = lineById.get(rl.purchaseOrderLineId);
        if (!pol) continue;
        const accepted = new Prisma.Decimal(rl.quantity.toString()).minus(new Prisma.Decimal(rl.rejectedOnReceiptQty.toString()));
        const safeReceived = new Prisma.Decimal(pol.receivedQty.toString()).minus(accepted);
        const newReceived = safeReceived.isNegative() ? zero : safeReceived;
        const newRemaining = new Prisma.Decimal(pol.quantity.toString()).minus(newReceived);
        await tx.purchaseOrderLine.update({
          where: { id: pol.id },
          data: {
            receivedQty: newReceived,
            remainingReceiveQty: newRemaining.isNegative() ? zero : newRemaining,
            updatedById: actorId,
          },
        });
      }
      await tx.purchaseReceipt.update({
        where: { id: rc.id },
        data: { status: 'DRAFT', receivedAt: null, receivedById: null, updatedById: actorId, version: { increment: 1 } },
      });
    }

    // ⑥ 删除收货单（软删 + 回收单号）
    await tx.purchaseReceipt.update({ where: { id: rc.id }, data: { deletedAt: now, isActive: false, updatedById: actorId } });
    await tx.purchaseReceiptLine.updateMany({ where: { purchaseReceiptId: rc.id, deletedAt: null }, data: { deletedAt: now, isActive: false } });
    await recycleDocumentSequence(tx, 'PURCHASE_RECEIPT', rc.code);

    // ⑦ 删除采购订单（无其他收货/退货下链时；软删 + 回收单号）→ ⑧ 回退并删除采购申请
    const po = await tx.purchaseOrder.findFirst({ where: { id: rc.purchaseOrderId, deletedAt: null } });
    let prUnwound = false;
    if (po) {
      const otherRc = await tx.purchaseReceipt.count({ where: { purchaseOrderId: po.id, deletedAt: null } });
      const otherRt = await tx.purchaseReturn.count({ where: { purchaseOrderId: po.id, deletedAt: null } });
      if (otherRc === 0 && otherRt === 0) {
        await tx.purchaseOrder.update({ where: { id: po.id }, data: { deletedAt: now, isActive: false, updatedById: actorId } });
        await tx.purchaseOrderLine.updateMany({ where: { purchaseOrderId: po.id, deletedAt: null }, data: { deletedAt: now, isActive: false } });
        await recycleDocumentSequence(tx, 'PURCHASE_ORDER', po.code);
        if (po.requisitionId) {
          const pr = await tx.purchaseRequisition.findFirst({ where: { id: po.requisitionId, deletedAt: null } });
          if (pr && pr.status === 'CONVERTED') {
            await tx.purchaseRequisition.update({
              where: { id: pr.id },
              data: { status: 'APPROVED', version: { increment: 1 }, updatedById: actorId },
            });
          }
          if (pr) {
            await tx.purchaseRequisition.update({ where: { id: pr.id }, data: { deletedAt: now, isActive: false, updatedById: actorId } });
            await tx.purchaseRequisitionLine.updateMany({ where: { purchaseRequisitionId: pr.id, deletedAt: null }, data: { deletedAt: now, isActive: false } });
            await recycleDocumentSequence(tx, 'PURCHASE_REQUISITION', pr.code);
            prUnwound = true;
          }
        }
      }
    }

    // ⑨ 删除本入库单（软删 + 回收单号）
    await tx.warehouseReceipt.update({ where: { id }, data: { deletedAt: now, isActive: false, updatedById: actorId } });
    await tx.warehouseReceiptLine.updateMany({ where: { warehouseReceiptId: id, deletedAt: null }, data: { deletedAt: now, isActive: false } });
    await recycleDocumentSequence(tx, 'WAREHOUSE_RECEIPT', whr.code);

    return { ok: true as const, receiptUnwound: true, poUnwound: !!po, prUnwound };
  });

  if (result && 'error' in result) {
    if (result.error === 'NOT_FOUND') return failNotFound(ERROR_CODES.WAREHOUSE_RECEIPT_NOT_FOUND, '入库单不存在');
    if (result.error === 'NOT_FULLY_RETURNED')
      return failConflict(ERROR_CODES.WAREHOUSE_RECEIPT_INVALID_STATE, '入库行未全部退货，禁止回退整链（请先完成退货）');
    if (result.error === 'INVALID_STATE')
      return failConflict(ERROR_CODES.WAREHOUSE_RECEIPT_INVALID_STATE, '当前入库单状态不可回退整链');
    if (result.error === 'RECEIPT_NOT_FOUND')
      return failConflict(ERROR_CODES.PURCHASE_RECEIPT_NOT_FOUND, '来源收货单不存在');
  }

  await writeAuditLog({
    actorId: user?.id,
    action: 'warehouse-receipt.unwind',
    entityType: 'warehouse-receipt',
    entityId: id,
    afterData: { warehouseReceiptId: id, code: undefined, fullChainUnwound: true },
    ...meta,
  });

  return ok({ id, unwound: true, poUnwound: result?.poUnwound ?? false, prUnwound: result?.prUnwound ?? false });
}