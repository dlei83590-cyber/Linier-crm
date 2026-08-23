import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation, failConflict, failNotFound } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { warehouseReceiptUpdateSchema } from '@/lib/api/schemas';
import {
  computeInspectionUsedQty,
  computeInspectionAvailableQty,
} from '@/lib/warehouse-receipt/helpers';

export const dynamic = 'force-dynamic';

/** GET /api/warehouse-receipts/:id（详情：Header + 来源收货单 + 仓库/库位 + Lines(收货行/Item/UOM/PO Line/Inspection) + 过账人） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'warehouse-receipt:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'warehouse-receipt.get');

  const { id } = await params;
  const receipt = await prisma.warehouseReceipt.findFirst({
    where: { id, deletedAt: null },
    include: {
      purchaseReceipt: { select: { id: true, code: true, status: true, receivedAt: true } },
      warehouse: { select: { id: true, code: true, name: true } },
      location: { select: { id: true, code: true, name: true } },
      postedBy: { select: { id: true, name: true, email: true } },
      lines: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
        include: {
          item: { select: { id: true, code: true, name: true, model: true } },
          uom: { select: { id: true, code: true, symbol: true } },
          purchaseReceiptLine: {
            select: {
              id: true,
              lineNo: true,
              quantity: true,
              purchaseOrderLine: { select: { id: true, lineNo: true, fulfillmentType: true } },
            },
          },
          inspection: {
            select: { id: true, inspectionMode: true, result: true, qualifiedQty: true },
          },
        },
      },
    },
  });
  if (!receipt) return failNotFound(ERROR_CODES.WAREHOUSE_RECEIPT_NOT_FOUND, '入库单不存在');

  // 核销闭环（用户指令 2026-08-21）：每行已 RETURNED 退货量（WAREHOUSE_RECEIPT_LINE 来源；可退余额 = quantity - 已退）
  const lineIds = receipt.lines.map((l) => l.id);
  const returnedRows = await prisma.purchaseReturnLine.groupBy({
    by: ['sourceWarehouseReceiptLineId'],
    where: {
      sourceRefType: 'WAREHOUSE_RECEIPT_LINE',
      sourceWarehouseReceiptLineId: { in: lineIds },
      purchaseReturn: { status: 'RETURNED', deletedAt: null },
      deletedAt: null,
    },
    _sum: { quantity: true },
  });
  const returnedMap = new Map(returnedRows.map((r) => [r.sourceWarehouseReceiptLineId ?? '', r._sum.quantity ?? new Prisma.Decimal(0)]));
  const linesWithBalance = receipt.lines.map((l) => ({
    ...l,
    returnedQty: (returnedMap.get(l.id) ?? new Prisma.Decimal(0)).toString(),
    returnableQty: Prisma.Decimal.max(
      new Prisma.Decimal(l.quantity.toString()).minus(returnedMap.get(l.id) ?? new Prisma.Decimal(0)),
      new Prisma.Decimal(0),
    ).toString(),
  }));

  return ok({ ...receipt, lines: linesWithBalance });
}

/**
 * PATCH /api/warehouse-receipts/:id（更新头 + 可选行全量替换；**仅 DRAFT**；原子 CAS 乐观锁 + version 递增）
 * CTO #7135 核心 Gate（第一版锁死，与 Create 同口径）：
 * - 仅 DRAFT 可编辑（INVALID_STATE）；CAS `id + version + status=DRAFT` 同时命中才更新；
 * - warehouseId/locationId 可改，但 location 必须属于同一 warehouse（组合 FK）；
 * - 行替换时重新校验：收货行属于该收货单 / Inspection 已完成 + qualifiedQty > 0 / Inspection 属于同一收货行 /
 *   DIRECT_PROJECT 禁入库 / quantity ≤ 可入库余额（排除本单自身已占用的行——本单未过账不占额度）；
 * - **DRAFT 变更不发领域事件**（D10：Created ≠ Posted）——仅 AuditLog 留痕；
 * - 红线：**禁写 Stock / InventoryMovement**（6A 唯一事实源）。
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'warehouse-receipt:edit');
  if (denied) return denied;
  requestLog(request, user?.id, 'warehouse-receipt.update');

  const { id } = await params;
  const parsed = warehouseReceiptUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version, lines, ...fields } = parsed.data;
  const meta = requestMeta(request);
  const actorId = user!.id;

  const existing = await prisma.warehouseReceipt.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, status: true, version: true, purchaseReceiptId: true, warehouseId: true, locationId: true },
  });
  if (!existing) return failNotFound(ERROR_CODES.WAREHOUSE_RECEIPT_NOT_FOUND, '入库单不存在');
  if (existing.status !== 'DRAFT') {
    return failConflict(
      ERROR_CODES.WAREHOUSE_RECEIPT_INVALID_STATE,
      `仅 DRAFT 状态可编辑（当前 ${existing.status}）；已过账的入库事实不可修改`,
    );
  }
  if (existing.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, '版本冲突，请刷新后重试');
  }

  // 头字段预校验（warehouse / location 组合 FK；**Minor（CTO #7192）：effective 值 = incoming ?? existing，
  // 只改 locationId 不重提 warehouseId 时不得误拒**——DB 组合 FK 是最终防线，API 给稳定业务错误）
  const effectiveWarehouseId = fields.warehouseId !== undefined ? fields.warehouseId : existing.warehouseId;
  const effectiveLocationId = fields.locationId !== undefined ? fields.locationId : existing.locationId;
  if (effectiveWarehouseId) {
    const wh = await prisma.warehouse.findFirst({
      where: { id: effectiveWarehouseId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!wh) {
      return fail(ERROR_CODES.WAREHOUSE_RECEIPT_WAREHOUSE_INVALID, '仓库不存在或已停用', 400);
    }
  }
  if (effectiveLocationId) {
    if (!effectiveWarehouseId) {
      return fail(
        ERROR_CODES.WAREHOUSE_RECEIPT_LOCATION_INVALID,
        '库位必须属于一个有效仓库（请同时提供 warehouseId）',
        400,
      );
    }
    const loc = await prisma.warehouseLocation.findFirst({
      where: {
        id: effectiveLocationId,
        warehouseId: effectiveWarehouseId,
        deletedAt: null,
        isActive: true,
      },
      select: { id: true },
    });
    if (!loc) {
      return fail(
        ERROR_CODES.WAREHOUSE_RECEIPT_LOCATION_INVALID,
        '库位不存在、已停用或不属于该仓库',
        400,
      );
    }
  }

  // 行替换校验（与 Create 同口径；批量取收货行 + Inspection）
  let validatedLines: Array<{
    purchaseReceiptLineId: string;
    inspectionId: string;
    quantity: Prisma.Decimal;
    batchNo: string | null;
    serialNos: string[];
    mfgDate: Date | null;
    expDate: Date | null;
    remark: string | null;
  }> | null = null;
  if (lines) {
    const rawLineIds = lines.map((l) => l.purchaseReceiptLineId);
    if (new Set(rawLineIds).size !== rawLineIds.length) {
      return fail(
        ERROR_CODES.WAREHOUSE_RECEIPT_DUPLICATE_LINE,
        '同一入库单内一个收货行只能出现一次（防重复入库占用）',
        400,
      );
    }
    const inspectionIds = [...new Set(lines.map((l) => l.inspectionId))];

    const receiptLines = await prisma.purchaseReceiptLine.findMany({
      where: { id: { in: rawLineIds }, purchaseReceiptId: existing.purchaseReceiptId, deletedAt: null },
      select: {
        id: true,
        itemId: true,
        uomId: true,
        purchaseOrderLine: { select: { fulfillmentType: true } },
      },
    });
    if (receiptLines.length !== rawLineIds.length) {
      return fail(
        ERROR_CODES.WAREHOUSE_RECEIPT_LINE_MISMATCH,
        '存在不属于该收货单的入库行（行必须属于同一收货单）',
        409,
      );
    }
    const lineById = new Map(receiptLines.map((l) => [l.id, l]));
    for (const rl of receiptLines) {
      if (rl.purchaseOrderLine.fulfillmentType === 'DIRECT_PROJECT') {
        return fail(
          ERROR_CODES.WAREHOUSE_RECEIPT_DIRECT_PROJECT_FORBIDDEN,
          'DIRECT_PROJECT（直送）行禁止入库（P4 Final：直送不入库、无 InventoryMovement(IN)）',
          409,
        );
      }
    }

    const inspections = await prisma.inspection.findMany({
      where: { id: { in: inspectionIds }, deletedAt: null },
      select: { id: true, purchaseReceiptLineId: true, result: true, qualifiedQty: true },
    });
    const inspectionById = new Map(inspections.map((i) => [i.id, i]));

    // 可入库余额：postedUsedQty（CTO #7192：只有 POSTED 消耗正式额度；本单 DRAFT 未过账不占额度，不双计）
    validatedLines = [];
    for (const line of lines) {
      const inspection = inspectionById.get(line.inspectionId);
      if (!inspection) {
        return fail(ERROR_CODES.WAREHOUSE_RECEIPT_INSPECTION_NOT_FOUND, '质检记录不存在或已删除', 400);
      }
      if (inspection.result === 'PENDING') {
        return fail(
          ERROR_CODES.WAREHOUSE_RECEIPT_INSPECTION_NOT_COMPLETED,
          '来源 Inspection 必须已完成（result ≠ PENDING）才能入库',
          409,
        );
      }
      if (inspection.qualifiedQty.lte(0)) {
        return fail(
          ERROR_CODES.WAREHOUSE_RECEIPT_INSPECTION_NO_QUALIFIED,
          '来源 Inspection 无合格数量（qualifiedQty <= 0）',
          409,
        );
      }
      if (inspection.purchaseReceiptLineId !== line.purchaseReceiptLineId) {
        return fail(
          ERROR_CODES.WAREHOUSE_RECEIPT_INSPECTION_MISMATCH,
          'Inspection 不属于该收货行（组合 FK 语义）',
          409,
        );
      }
      const usedQty = await computeInspectionUsedQty(prisma, inspection.id, id);
      const availableQty = computeInspectionAvailableQty(inspection.qualifiedQty, usedQty);
      const qty = new Prisma.Decimal(line.quantity);
      if (qty.lte(0) || qty.gt(availableQty)) {
        return fail(
          ERROR_CODES.WAREHOUSE_RECEIPT_OVER_INSPECTION_BALANCE,
          '入库数量超过 Inspection 可入库余额（qualifiedQty - 已占用）',
          409,
        );
      }
      validatedLines.push({
        purchaseReceiptLineId: line.purchaseReceiptLineId,
        inspectionId: inspection.id,
        quantity: qty,
        batchNo: line.batchNo ?? null,
        serialNos: line.serialNos ?? [],
        mfgDate: line.mfgDate ? new Date(line.mfgDate) : null,
        expDate: line.expDate ? new Date(line.expDate) : null,
        remark: line.remark ?? null,
      });
      void lineById;
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    // 原子 CAS 乐观锁（Phase 3 教训沿用）：仅当 id + version + status=DRAFT 同时命中才更新（CAS 成功递增 version）
    const cas = await tx.warehouseReceipt.updateMany({
      where: { id, version, status: 'DRAFT', deletedAt: null },
      data: {
        ...(fields.warehouseId !== undefined ? { warehouseId: fields.warehouseId } : {}),
        ...(fields.locationId !== undefined ? { locationId: fields.locationId } : {}),
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
      await tx.warehouseReceiptLine.updateMany({
        where: { warehouseReceiptId: id, deletedAt: null },
        data: { deletedAt: new Date(), updatedById: actorId },
      });
      for (const line of validatedLines) {
        const rl = await tx.purchaseReceiptLine.findFirstOrThrow({
          where: { id: line.purchaseReceiptLineId, deletedAt: null },
          select: { id: true, itemId: true, uomId: true },
        });
        await tx.warehouseReceiptLine.create({
          data: {
            warehouseReceiptId: id,
            purchaseReceiptLineId: line.purchaseReceiptLineId,
            inspectionId: line.inspectionId,
            itemId: rl.itemId,
            quantity: line.quantity,
            uomId: rl.uomId,
            batchNo: line.batchNo,
            serialNos: line.serialNos,
            mfgDate: line.mfgDate,
            expDate: line.expDate,
            remark: line.remark,
            createdById: actorId,
            updatedById: actorId,
          },
        });
      }
    }

    return tx.warehouseReceipt.findFirstOrThrow({
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

  // DRAFT 变更不发领域事件（D10：Created ≠ Posted）——仅 AuditLog 留痕
  await writeAuditLog({
    actorId,
    action: 'WarehouseReceiptUpdated',
    entityType: 'warehouse-receipt',
    entityId: id,
    afterData: {
      warehouseReceiptId: id,
      version: updated.version,
      warehouseId: updated.warehouseId,
      locationId: updated.locationId,
      updatedById: actorId,
    },
    meta,
  });

  return ok(updated);
}
