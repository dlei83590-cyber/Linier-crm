import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation, failConflict, failNotFound } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { purchaseReturnUpdateSchema } from '@/lib/api/schemas';
import { computeSourceReturnedQty, computeSourceAvailableQty } from '@/lib/purchase-return/helpers';

export const dynamic = 'force-dynamic';

/** GET /api/purchase-returns/:id（详情：Header + PO + Supplier + Lines(来源三选一/Item/UOM/处置/原因) + 退货人） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'purchase-return:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'purchase-return.get');

  const { id } = await params;
  const pr = await prisma.purchaseReturn.findFirst({
    where: { id, deletedAt: null },
    include: {
      purchaseOrder: { select: { id: true, code: true, status: true } },
      supplier: { select: { id: true, code: true, name: true } },
      returnedBy: { select: { id: true, name: true, email: true } },
      lines: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
        include: {
          sourcePurchaseReceiptLine: {
            select: { id: true, lineNo: true, quantity: true, purchaseReceipt: { select: { id: true, code: true } } },
          },
          sourceWarehouseReceiptLine: {
            select: { id: true, quantity: true, warehouseReceipt: { select: { id: true, code: true, status: true } } },
          },
          sourceInspection: {
            select: { id: true, inspectionMode: true, result: true, qualifiedQty: true },
          },
          item: { select: { id: true, code: true, name: true, model: true } },
          uom: { select: { id: true, code: true, symbol: true } },
        },
      },
    },
  });
  if (!pr) return failNotFound(ERROR_CODES.PURCHASE_RETURN_NOT_FOUND, '退货单不存在');

  return ok(pr);
}

/**
 * PATCH /api/purchase-returns/:id（更新头 + 可选行全量替换；**仅 DRAFT**；原子 CAS 乐观锁 + version 递增）
 * CTO #7219 核心 Gate（与 Create 同口径）：
 * - 仅 DRAFT 可编辑（INVALID_STATE）；CAS `id + version + status=DRAFT` 同时命中才更新；
 * - 行替换重新校验：来源三选一 exactly-one / 来源属于该 PO / WAREHOUSE_RECEIPT_LINE 必须来自 POSTED 入库事实 /
 *   quantity > 0 且 ≤ 来源可退上限（预检查；**最终防线在 return Gate 锁内重算累计 RETURNED，防并发超退**）；
 * - **DRAFT 变更不发领域事件**——仅 AuditLog 留痕；
 * - 红线：**禁写 Stock / InventoryMovement**（6A 唯一事实源）；已入库退货也不写库存 OUT。
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'purchase-return:edit');
  if (denied) return denied;
  requestLog(request, user?.id, 'purchase-return.update');

  const { id } = await params;
  const parsed = purchaseReturnUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version, lines, ...fields } = parsed.data;
  const meta = requestMeta(request);
  const actorId = user!.id;

  const existing = await prisma.purchaseReturn.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, status: true, version: true, purchaseOrderId: true },
  });
  if (!existing) return failNotFound(ERROR_CODES.PURCHASE_RETURN_NOT_FOUND, '退货单不存在');
  if (existing.status !== 'DRAFT') {
    return failConflict(
      ERROR_CODES.PURCHASE_RETURN_INVALID_STATE,
      `仅 DRAFT 状态可编辑（当前 ${existing.status}）；已退货事实不可修改`,
    );
  }
  if (existing.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, '版本冲突，请刷新后重试');
  }

  // 行替换校验（与 Create 同口径）
  let validatedLines: Array<{
    sourceRefType: 'RECEIPT_LINE' | 'WAREHOUSE_RECEIPT_LINE' | 'INSPECTION';
    sourcePurchaseReceiptLineId: string | null;
    sourceWarehouseReceiptLineId: string | null;
    sourceInspectionId: string | null;
    itemId: string | null;
    uomId: string | null;
    quantity: Prisma.Decimal;
    batchNo: string | null;
    serialNos: string[];
    disposition: 'REPLACE_REQUIRED' | 'CREDIT_ONLY';
    returnReason: string;
    remark: string | null;
  }> | null = null;
  if (lines) {
    const sourceKeys = lines.map(
      (l) =>
        `${l.sourceRefType}:${
          l.sourceRefType === 'RECEIPT_LINE'
            ? l.sourcePurchaseReceiptLineId
            : l.sourceRefType === 'WAREHOUSE_RECEIPT_LINE'
              ? l.sourceWarehouseReceiptLineId
              : l.sourceInspectionId
        }`,
    );
    if (new Set(sourceKeys).size !== sourceKeys.length) {
      return fail(
        ERROR_CODES.PURCHASE_RETURN_DUPLICATE_LINE,
        '同一退货单内一个来源只能出现一次（防并发超退）',
        400,
      );
    }

    // 来源校验（与 Create 同口径；预检查可退上限，最终防线在 return Gate）
    const receiptLineIds = lines
      .filter((l) => l.sourceRefType === 'RECEIPT_LINE')
      .map((l) => l.sourcePurchaseReceiptLineId!);
    const warehouseLineIds = lines
      .filter((l) => l.sourceRefType === 'WAREHOUSE_RECEIPT_LINE')
      .map((l) => l.sourceWarehouseReceiptLineId!);
    const inspectionIds = lines
      .filter((l) => l.sourceRefType === 'INSPECTION')
      .map((l) => l.sourceInspectionId!);

    const [receiptLines, warehouseLines, inspections] = await Promise.all([
      receiptLineIds.length
        ? prisma.purchaseReceiptLine.findMany({
            where: { id: { in: receiptLineIds }, deletedAt: null },
            select: {
              id: true,
              itemId: true,
              uomId: true,
              quantity: true,
              purchaseReceipt: { select: { purchaseOrderId: true } },
            },
          })
        : Promise.resolve([]),
      warehouseLineIds.length
        ? prisma.warehouseReceiptLine.findMany({
            where: { id: { in: warehouseLineIds }, deletedAt: null },
            select: {
              id: true,
              itemId: true,
              uomId: true,
              quantity: true,
              warehouseReceipt: {
                select: { status: true, purchaseReceipt: { select: { purchaseOrderId: true } } },
              },
            },
          })
        : Promise.resolve([]),
      inspectionIds.length
        ? prisma.inspection.findMany({
            where: { id: { in: inspectionIds }, deletedAt: null },
            select: {
              id: true,
              result: true,
              qualifiedQty: true,
              purchaseReceiptLine: {
                select: {
                  itemId: true,
                  uomId: true,
                  purchaseReceipt: { select: { purchaseOrderId: true } },
                },
              },
            },
          })
        : Promise.resolve([]),
    ]);

    const rlById = new Map(receiptLines.map((r) => [r.id, r]));
    const wlById = new Map(warehouseLines.map((w) => [w.id, w]));
    const insById = new Map(inspections.map((i) => [i.id, i]));

    validatedLines = [];
    for (const line of lines) {
      let itemId: string | null = null;
      let uomId: string | null = null;
      let returnableQty: Prisma.Decimal;
      if (line.sourceRefType === 'RECEIPT_LINE') {
        const src = rlById.get(line.sourcePurchaseReceiptLineId!);
        if (!src) {
          return fail(ERROR_CODES.PURCHASE_RETURN_SOURCE_INVALID, '来源收货行不存在或已删除', 400);
        }
        if (src.purchaseReceipt.purchaseOrderId !== existing.purchaseOrderId) {
          return fail(ERROR_CODES.PURCHASE_RETURN_SOURCE_MISMATCH, '来源收货行不属于该采购订单', 409);
        }
        itemId = src.itemId;
        uomId = src.uomId;
        returnableQty = src.quantity;
      } else if (line.sourceRefType === 'WAREHOUSE_RECEIPT_LINE') {
        const src = wlById.get(line.sourceWarehouseReceiptLineId!);
        if (!src) {
          return fail(ERROR_CODES.PURCHASE_RETURN_SOURCE_INVALID, '来源入库行不存在或已删除', 400);
        }
        if (src.warehouseReceipt.status !== 'POSTED') {
          return fail(
            ERROR_CODES.PURCHASE_RETURN_SOURCE_NOT_RETURNABLE,
            '已入库退货来源必须是 POSTED 入库事实（DRAFT 未过账不可退）',
            409,
          );
        }
        if (src.warehouseReceipt.purchaseReceipt.purchaseOrderId !== existing.purchaseOrderId) {
          return fail(ERROR_CODES.PURCHASE_RETURN_SOURCE_MISMATCH, '来源入库行不属于该采购订单', 409);
        }
        itemId = src.itemId;
        uomId = src.uomId;
        returnableQty = src.quantity;
      } else {
        const src = insById.get(line.sourceInspectionId!);
        if (!src) {
          return fail(ERROR_CODES.PURCHASE_RETURN_SOURCE_INVALID, '来源质检记录不存在或已删除', 400);
        }
        if (src.result === 'PENDING') {
          return fail(
            ERROR_CODES.PURCHASE_RETURN_SOURCE_NOT_RETURNABLE,
            '来源 Inspection 必须已完成（result ≠ PENDING）才能退货',
            409,
          );
        }
        if (src.purchaseReceiptLine.purchaseReceipt.purchaseOrderId !== existing.purchaseOrderId) {
          return fail(ERROR_CODES.PURCHASE_RETURN_SOURCE_MISMATCH, '来源质检记录不属于该采购订单', 409);
        }
        itemId = src.purchaseReceiptLine.itemId;
        uomId = src.purchaseReceiptLine.uomId;
        returnableQty = src.qualifiedQty;
      }
      // 预检查（Create/PATCH：DRAFT 单不占额度，仅与来源可退上限比较；return Gate 才做最终累计校验）
      const usedQty = await computeSourceReturnedQty(prisma, line.sourceRefType, line.sourcePurchaseReceiptLineId ?? line.sourceWarehouseReceiptLineId ?? line.sourceInspectionId!);
      const availableQty = computeSourceAvailableQty(returnableQty, usedQty);
      const qty = new Prisma.Decimal(line.quantity);
      if (qty.lte(0) || qty.gt(availableQty)) {
        return fail(
          ERROR_CODES.PURCHASE_RETURN_OVER_SOURCE_BALANCE,
          '退货数量超过来源可退余额（来源可退 - 已 RETURNED）',
          409,
        );
      }
      validatedLines.push({
        sourceRefType: line.sourceRefType,
        sourcePurchaseReceiptLineId: line.sourceRefType === 'RECEIPT_LINE' ? line.sourcePurchaseReceiptLineId! : null,
        sourceWarehouseReceiptLineId: line.sourceRefType === 'WAREHOUSE_RECEIPT_LINE' ? line.sourceWarehouseReceiptLineId! : null,
        sourceInspectionId: line.sourceRefType === 'INSPECTION' ? line.sourceInspectionId! : null,
        itemId,
        uomId,
        quantity: qty,
        batchNo: line.batchNo ?? null,
        serialNos: line.serialNos ?? [],
        disposition: line.disposition,
        returnReason: line.returnReason,
        remark: line.remark ?? null,
      });
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    // 原子 CAS 乐观锁（Phase 3 教训沿用）：仅当 id + version + status=DRAFT 同时命中才更新（CAS 成功递增 version）
    const cas = await tx.purchaseReturn.updateMany({
      where: { id, version, status: 'DRAFT', deletedAt: null },
      data: {
        ...(fields.returnType !== undefined ? { returnType: fields.returnType } : {}),
        ...(fields.remark !== undefined ? { remark: fields.remark } : {}),
        updatedById: actorId,
        version: { increment: 1 },
      },
    });
    if (cas.count !== 1) {
      throw new Error('VERSION_CONFLICT');
    }

    // 行整体替换（软删旧行 + 重建；行由头单据驱动，无独立 Line CRUD）
    if (validatedLines) {
      await tx.purchaseReturnLine.updateMany({
        where: { purchaseReturnId: id, deletedAt: null },
        data: { deletedAt: new Date(), updatedById: actorId },
      });
      for (const line of validatedLines) {
        await tx.purchaseReturnLine.create({
          data: {
            purchaseReturnId: id,
            sourceRefType: line.sourceRefType,
            sourcePurchaseReceiptLineId: line.sourcePurchaseReceiptLineId,
            sourceWarehouseReceiptLineId: line.sourceWarehouseReceiptLineId,
            sourceInspectionId: line.sourceInspectionId,
            itemId: line.itemId,
            quantity: line.quantity,
            uomId: line.uomId,
            batchNo: line.batchNo,
            serialNos: line.serialNos,
            disposition: line.disposition,
            returnReason: line.returnReason,
            remark: line.remark,
            createdById: actorId,
            updatedById: actorId,
          },
        });
      }
    }

    return tx.purchaseReturn.findFirstOrThrow({
      where: { id, deletedAt: null },
      include: { lines: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } } },
    });
  }).catch((e) => {
    if (e instanceof Error && e.message === 'VERSION_CONFLICT') return { error: 'VERSION_CONFLICT' as const };
    throw e;
  });

  if ('error' in updated) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, '版本冲突，请刷新后重试（并发修改）');
  }

  // DRAFT 变更不发领域事件（对齐规则⑧事件纪律）——仅 AuditLog 留痕
  await writeAuditLog({
    actorId,
    action: 'PurchaseReturnUpdated',
    entityType: 'purchase-return',
    entityId: id,
    afterData: {
      purchaseReturnId: id,
      version: updated.version,
      returnType: updated.returnType,
      updatedById: actorId,
    },
    meta,
  });

  return ok(updated);
}
