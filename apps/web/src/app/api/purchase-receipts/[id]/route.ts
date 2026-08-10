import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation, failConflict, failNotFound } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { purchaseReceiptUpdateSchema } from '@/lib/api/schemas';

export const dynamic = 'force-dynamic';

const EDITABLE_STATUSES = ['DRAFT'] as const;

/** GET /api/purchase-receipts/:id（详情：Header + PO + Supplier + Warehouse + Lines(Item/UOM/PO Line)） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'purchase-receipt:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'purchase-receipt.get');

  const { id } = await params;
  const receipt = await prisma.purchaseReceipt.findFirst({
    where: { id, deletedAt: null },
    include: {
      purchaseOrder: {
        select: { id: true, code: true, status: true, confirmedAt: true, totalAmount: true },
      },
      supplier: { select: { id: true, code: true, name: true } },
      warehouse: { select: { id: true, code: true, name: true } },
      receivedBy: { select: { id: true, name: true, email: true } },
      lines: {
        where: { deletedAt: null },
        orderBy: { lineNo: 'asc' },
        include: {
          item: { select: { id: true, code: true, name: true, model: true } },
          uom: { select: { id: true, code: true, name: true, symbol: true } },
          purchaseOrderLine: {
            select: {
              id: true,
              lineNo: true,
              quantity: true,
              receivedQty: true,
              remainingReceiveQty: true,
              fulfillmentType: true,
              projectId: true,
              overReceiptToleranceRate: true,
            },
          },
        },
      },
    },
  });
  if (!receipt) return failNotFound(ERROR_CODES.PURCHASE_RECEIPT_NOT_FOUND, '收货单不存在');

  return ok(receipt);
}

/**
 * PATCH /api/purchase-receipts/:id（更新头 + 可选行全量替换；仅 DRAFT；原子 CAS 乐观锁）
 * 红线（CTO #6923 Receive 规则）：
 * - **receivedQty / remainingReceiveQty 禁止客户端传入**（服务端唯一回写，规则⑦）；
 * - fulfillmentType 不在此层（以 PO Line 已确认的 fulfillmentType 为准，规则③）；
 * - 行更新时服务端校验：PO Line 属于同一 PO（规则②）+ 数量公式（规则④：quantity>0、0<=rejectedOnReceiptQty<=quantity）；
 * - **DRAFT 变更不发布 PurchaseReceiptReceived**（规则⑧：只有 Receive 事务成功后发布）；
 * - warehouseId 可改（仅 WAREHOUSE 场景；DIRECT_PROJECT 不要求，规则③）。
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'purchase-receipt:edit');
  if (denied) return denied;
  requestLog(request, user?.id, 'purchase-receipt.update');

  const { id } = await params;
  const parsed = purchaseReceiptUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version, lines, ...fields } = parsed.data;
  const meta = requestMeta(request);
  const actorId = user!.id;

  const existing = await prisma.purchaseReceipt.findFirst({
    where: { id, deletedAt: null },
    include: {
      purchaseOrder: { select: { id: true, status: true } },
      lines: { where: { deletedAt: null }, orderBy: { lineNo: 'asc' } },
    },
  });
  if (!existing) return failNotFound(ERROR_CODES.PURCHASE_RECEIPT_NOT_FOUND, '收货单不存在');
  if ((EDITABLE_STATUSES as readonly string[]).includes(existing.status) === false) {
    return failConflict(
      ERROR_CODES.PURCHASE_RECEIPT_INVALID_STATE,
      `仅 DRAFT 状态可编辑（当前 ${existing.status}）`,
    );
  }
  if (existing.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, '版本冲突，请刷新后重试');
  }

  // 行替换时服务端校验：PO Line 属于同一 PO（规则②）+ 数量公式（规则④）
  let validatedLines: Array<{
    purchaseOrderLineId: string;
    quantity: Prisma.Decimal;
    visibleDamageQty: Prisma.Decimal;
    rejectedOnReceiptQty: Prisma.Decimal;
    deliveryAddress: string | null;
    receiver: string | null;
    proof: string | null;
    remark: string | null;
  }> | null = null;
  if (lines) {
    // **B②（CTO #6963/#7014）**：同一 Receipt 内一个 PO Line 只能出现一次（防重复引用导致 receivedQty 少记）
    const rawPoLineIds = lines.map((l) => l.purchaseOrderLineId);
    if (new Set(rawPoLineIds).size !== rawPoLineIds.length) {
      return fail(
        ERROR_CODES.PURCHASE_RECEIPT_DUPLICATE_PO_LINE,
        '同一收货单内一个 PO Line 只能出现一次（防重复引用导致 receivedQty 少记）',
        400,
      );
    }
    const poLineIds = [...new Set(rawPoLineIds)];
    const poLines = await prisma.purchaseOrderLine.findMany({
      where: { id: { in: poLineIds }, purchaseOrderId: existing.purchaseOrderId, deletedAt: null },
      select: { id: true, purchaseOrderId: true, fulfillmentType: true, itemId: true, uomId: true },
    });
    if (poLines.length !== poLineIds.length) {
      return fail(
        ERROR_CODES.PURCHASE_RECEIPT_LINE_PO_MISMATCH,
        '存在不属于该采购订单（PO）的收货行',
        400,
      );
    }
    const poLineById = new Map(poLines.map((l) => [l.id, l]));
    // **非阻塞（CTO #6963/#7014）**：与 Create 一致的 WAREHOUSE 校验——行替换后 WAREHOUSE 行必须有有效 warehouseId（禁止 PATCH 清空）
    const effectiveWarehouseId =
      fields.warehouseId !== undefined ? fields.warehouseId : existing.warehouseId;
    const hasWarehouseLines = lines.some(
      (l) => poLineById.get(l.purchaseOrderLineId)?.fulfillmentType === 'WAREHOUSE',
    );
    if (hasWarehouseLines && !effectiveWarehouseId) {
      return fail(
        ERROR_CODES.PURCHASE_RECEIPT_WAREHOUSE_REQUIRED,
        'WAREHOUSE 收货行必须提供有效 warehouseId（DIRECT_PROJECT 行不要求）',
        400,
      );
    }
    for (const line of lines) {
      if (line.quantity <= 0 || line.rejectedOnReceiptQty > line.quantity) {
        return fail(ERROR_CODES.PURCHASE_RECEIPT_QUANTITY_INVALID, '收货数量不合法', 400);
      }
      const poLine = poLineById.get(line.purchaseOrderLineId)!;
      validatedLines = validatedLines ?? [];
      validatedLines.push({
        purchaseOrderLineId: line.purchaseOrderLineId,
        quantity: new Prisma.Decimal(line.quantity),
        visibleDamageQty: new Prisma.Decimal(line.visibleDamageQty ?? 0),
        rejectedOnReceiptQty: new Prisma.Decimal(line.rejectedOnReceiptQty ?? 0),
        deliveryAddress: line.deliveryAddress ?? null,
        receiver: line.receiver ?? null,
        proof: line.proof ?? null,
        remark: line.remark ?? null,
      });
      void poLine; // itemId/uomId 由服务端从 PO Line 快照（字段保留在模型，创建时已复制；此处仅校验行归属）
    }
  }

  // **非阻塞（CTO #6963/#7014）**：warehouseId 若提供则必须有效（与 Create 一致；含仅更新头不换行场景）
  const proposedWarehouseId =
    fields.warehouseId !== undefined ? fields.warehouseId : existing.warehouseId;
  if (proposedWarehouseId) {
    const wh = await prisma.warehouse.findFirst({
      where: { id: proposedWarehouseId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!wh) {
      return fail(ERROR_CODES.PURCHASE_RECEIPT_WAREHOUSE_INVALID, '仓库不存在或已停用', 400);
    }
  }

  const updated = await prisma
    .$transaction(async (tx) => {
      // 原子 CAS 乐观锁（Phase 3 教训沿用）：仅当 id + version + status=DRAFT 同时命中才更新（**B③：CAS 成功必须递增 version**）
      const cas = await tx.purchaseReceipt.updateMany({
        where: { id, version, status: 'DRAFT', deletedAt: null },
        data: {
          ...(fields.warehouseId !== undefined ? { warehouseId: fields.warehouseId } : {}),
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
        await tx.purchaseReceiptLine.updateMany({
          where: { purchaseReceiptId: id, deletedAt: null },
          data: { deletedAt: new Date(), updatedById: actorId },
        });
        let lineNo = 10;
        for (const line of validatedLines) {
          const poLine = await tx.purchaseOrderLine.findFirstOrThrow({
            where: { id: line.purchaseOrderLineId, deletedAt: null },
            select: { id: true, itemId: true, uomId: true },
          });
          await tx.purchaseReceiptLine.create({
            data: {
              purchaseReceiptId: id,
              purchaseOrderLineId: line.purchaseOrderLineId,
              lineNo,
              itemId: poLine.itemId,
              quantity: line.quantity,
              uomId: poLine.uomId,
              visibleDamageQty: line.visibleDamageQty,
              rejectedOnReceiptQty: line.rejectedOnReceiptQty,
              deliveryAddress: line.deliveryAddress,
              receiver: line.receiver,
              proof: line.proof,
              remark: line.remark,
              createdById: actorId,
              updatedById: actorId,
            },
          });
          lineNo += 10;
        }
      }

      return tx.purchaseReceipt.findFirstOrThrow({
        where: { id, deletedAt: null },
        include: { lines: { where: { deletedAt: null }, orderBy: { lineNo: 'asc' } } },
      });
    })
    .catch((e) => {
      if (e instanceof Error && e.message === 'VERSION_CONFLICT')
        return { error: 'VERSION_CONFLICT' as const };
      throw e;
    });

  if ('error' in updated && updated.error === 'VERSION_CONFLICT') {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, '版本冲突，请刷新后重试（并发修改）');
  }

  // DRAFT 变更不发布 PurchaseReceiptReceived（规则⑧）——仅 AuditLog 留痕
  await writeAuditLog({
    actorId,
    action: 'PurchaseReceiptUpdated',
    entityType: 'purchase-receipt',
    entityId: id,
    afterData: { purchaseReceiptId: id, version: version + 1, updatedById: actorId },
    meta,
  });

  return ok(updated);
}
