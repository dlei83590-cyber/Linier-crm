import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation, parsePagination } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { purchaseReturnCreateSchema } from '@/lib/api/schemas';
import { nextPurchaseReturnCode } from '@/lib/purchase-return/helpers';

export const dynamic = 'force-dynamic';

/** GET /api/purchase-returns（分页 + code/purchaseOrderId/supplierId/status/returnType 过滤 + createdAt desc 排序） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'purchase-return:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'purchase-return.list');

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const code = searchParams.get('code')?.trim();
  const purchaseOrderId = searchParams.get('purchaseOrderId')?.trim();
  const supplierId = searchParams.get('supplierId')?.trim();
  const status = searchParams.get('status')?.trim();
  const returnType = searchParams.get('returnType')?.trim();

  const where = {
    deletedAt: null,
    ...(code ? { code: { contains: code, mode: 'insensitive' as const } } : {}),
    ...(purchaseOrderId ? { purchaseOrderId } : {}),
    ...(supplierId ? { supplierId } : {}),
    ...(status ? { status: status as never } : {}),
    ...(returnType ? { returnType: returnType as never } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.purchaseReturn.count({ where }),
    prisma.purchaseReturn.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        purchaseOrder: { select: { id: true, code: true, status: true } },
        supplier: { select: { id: true, code: true, name: true } },
        _count: { select: { lines: true } },
      },
    }),
  ]);

  return ok({ total, page, pageSize, items });
}

/**
 * POST /api/purchase-returns —— 创建退货单（DRAFT；**创建不发领域事件**——只有 return 成功才发 PurchaseReturned）
 * CTO #7219 核心 Gate（第一版锁死）：
 * - **必须有真实来源**：RECEIPT_LINE / INSPECTION = 未入库退货（不碰库存）；WAREHOUSE_RECEIPT_LINE = 已入库退货
 *   （必须来自 **POSTED** 入库事实，SOURCE_NOT_RETURNABLE）；本 API **不得写 InventoryMovement(OUT)**（6A 唯一事实源）；
 * - 来源必须属于该 PO（SOURCE_MISMATCH）；quantity > 0（QUANTITY_INVALID）；
 * - 预检查 quantity ≤ 来源可退余额（OVER_SOURCE_BALANCE）——**最终防线在 return Gate（锁内重算，防并发超退）**；
 * - **来源可退余额（CTO Re-review Blocking ①）**：RECEIPT_LINE = `rejectedOnReceiptQty`（现场即拒收）/ INSPECTION = `rejectedQty`（质检拒收）/
 *   WAREHOUSE_RECEIPT_LINE = 已 POSTED 入库行 `quantity`；**Create 预检查与 Return Gate 同步同源，防分叉**；
 * - disposition 必填：REPLACE_REQUIRED（供应商仍欠货，Return Gate 同一事务内真正 reopen PO 履约）/ CREDIT_ONLY（不自动重开待交）；
 * - 红线：**5B 禁写 Stock / InventoryMovement**（6A 唯一事实源）；已入库退货也只记录事实，不写库存 OUT；财务冲减/红字发票/AP 属 5C。
 */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'purchase-return:create');
  if (denied) return denied;
  requestLog(request, user?.id, 'purchase-return.create');

  const parsed = purchaseReturnCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const data = parsed.data;
  const meta = requestMeta(request);
  const actorId = user!.id;

  // ① PO 必须存在（供应商快照自 PO，不单独校验）
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: data.purchaseOrderId, deletedAt: null },
    select: { id: true, supplierId: true },
  });
  if (!po) {
    return fail(ERROR_CODES.PURCHASE_ORDER_NOT_FOUND, '采购订单不存在', 400);
  }

  // ② 行去重（同一退货单内一个来源只能出现一次，防并发超退）
  const sourceKeys = data.lines.map(
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

  // ③ 来源校验（批量取三来源 → 归属该 PO + WAREHOUSE_RECEIPT_LINE 必须 POSTED）
  const receiptLineIds = data.lines
    .filter((l) => l.sourceRefType === 'RECEIPT_LINE')
    .map((l) => l.sourcePurchaseReceiptLineId!);
  const warehouseLineIds = data.lines
    .filter((l) => l.sourceRefType === 'WAREHOUSE_RECEIPT_LINE')
    .map((l) => l.sourceWarehouseReceiptLineId!);
  const inspectionIds = data.lines
    .filter((l) => l.sourceRefType === 'INSPECTION')
    .map((l) => l.sourceInspectionId!);

  const [receiptLines, warehouseLines, inspections] = await Promise.all([
    receiptLineIds.length
      ? prisma.purchaseReceiptLine.findMany({
          where: { id: { in: receiptLineIds }, deletedAt: null },
          select: { id: true, purchaseReceipt: { select: { purchaseOrderId: true } } },
        })
      : Promise.resolve([]),
    warehouseLineIds.length
      ? prisma.warehouseReceiptLine.findMany({
          where: { id: { in: warehouseLineIds }, deletedAt: null },
          select: {
            id: true,
            warehouseReceipt: {
              select: {
                status: true,
                purchaseReceipt: { select: { purchaseOrderId: true } },
              },
            },
          },
        })
      : Promise.resolve([]),
    inspectionIds.length
      ? prisma.inspection.findMany({
          where: { id: { in: inspectionIds }, deletedAt: null },
          select: { id: true, result: true, purchaseReceiptLine: { select: { purchaseReceipt: { select: { purchaseOrderId: true } } } } },
        })
      : Promise.resolve([]),
  ]);

  const rlById = new Map(receiptLines.map((r) => [r.id, r]));
  const wlById = new Map(warehouseLines.map((w) => [w.id, w]));
  const insById = new Map(inspections.map((i) => [i.id, i]));

  for (const line of data.lines) {
    if (line.sourceRefType === 'RECEIPT_LINE') {
      const src = rlById.get(line.sourcePurchaseReceiptLineId!);
      if (!src) {
        return fail(ERROR_CODES.PURCHASE_RETURN_SOURCE_INVALID, '来源收货行不存在或已删除', 400);
      }
      if (src.purchaseReceipt.purchaseOrderId !== po.id) {
        return fail(ERROR_CODES.PURCHASE_RETURN_SOURCE_MISMATCH, '来源收货行不属于该采购订单', 409);
      }
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
      if (src.warehouseReceipt.purchaseReceipt.purchaseOrderId !== po.id) {
        return fail(ERROR_CODES.PURCHASE_RETURN_SOURCE_MISMATCH, '来源入库行不属于该采购订单', 409);
      }
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
      if (src.purchaseReceiptLine.purchaseReceipt.purchaseOrderId !== po.id) {
        return fail(ERROR_CODES.PURCHASE_RETURN_SOURCE_MISMATCH, '来源质检记录不属于该采购订单', 409);
      }
    }
  }

  // ④ 事务：取号 + Header(DRAFT) + Lines（预检查可退余额；最终防线在 return Gate 锁内重算）
  let created: { id: string; code: string } | null = null;
  try {
    created = await prisma.$transaction(async (tx) => {
      const code = await nextPurchaseReturnCode(tx, new Date());
      const header = await tx.purchaseReturn.create({
        data: {
          code,
          purchaseOrderId: po.id,
          supplierId: po.supplierId,
          returnType: data.returnType,
          status: 'DRAFT',
          remark: data.remark ?? null,
          createdById: actorId,
          updatedById: actorId,
        },
        select: { id: true, code: true },
      });

      for (const line of data.lines) {
        // 来源可退上限（CTO Re-review Blocking ①：RECEIPT_LINE=rejectedOnReceiptQty / INSPECTION=rejectedQty / WAREHOUSE=quantity）
        let sourceReturnableQty: { gte: (n: number) => boolean };
        if (line.sourceRefType === 'RECEIPT_LINE') {
          const src = await tx.purchaseReceiptLine.findFirstOrThrow({
            where: { id: line.sourcePurchaseReceiptLineId!, deletedAt: null },
            select: { id: true, itemId: true, uomId: true, rejectedOnReceiptQty: true },
          });
          sourceReturnableQty = src.rejectedOnReceiptQty;
        } else if (line.sourceRefType === 'WAREHOUSE_RECEIPT_LINE') {
          const src = await tx.warehouseReceiptLine.findFirstOrThrow({
            where: { id: line.sourceWarehouseReceiptLineId!, deletedAt: null },
            select: { id: true, itemId: true, uomId: true, quantity: true },
          });
          sourceReturnableQty = src.quantity;
        } else {
          const src = await tx.inspection.findFirstOrThrow({
            where: { id: line.sourceInspectionId!, deletedAt: null },
            select: { id: true, rejectedQty: true, purchaseReceiptLine: { select: { itemId: true, uomId: true } } },
          });
          sourceReturnableQty = src.rejectedQty;
        }
        const qty = new Prisma.Decimal(line.quantity);
        // 预检查（Create 阶段：DRAFT 单不占额度，仅与来源可退上限比较）；return Gate 才做最终累计校验
        if (qty.lte(0) || qty.gt(sourceReturnableQty as never)) {
          throw new Error('OVER_SOURCE_BALANCE');
        }

        await tx.purchaseReturnLine.create({
          data: {
            purchaseReturnId: header.id,
            sourceRefType: line.sourceRefType,
            sourcePurchaseReceiptLineId:
              line.sourceRefType === 'RECEIPT_LINE' ? line.sourcePurchaseReceiptLineId! : null,
            sourceWarehouseReceiptLineId:
              line.sourceRefType === 'WAREHOUSE_RECEIPT_LINE' ? line.sourceWarehouseReceiptLineId! : null,
            sourceInspectionId:
              line.sourceRefType === 'INSPECTION' ? line.sourceInspectionId! : null,
            itemId: null, // 服务端在 return Gate 重算来源时回填；此处保持 null 简化（或从来源取）
            quantity: qty,
            uomId: null,
            batchNo: line.batchNo ?? null,
            serialNos: line.serialNos ?? [],
            disposition: line.disposition,
            returnReason: line.returnReason,
            remark: line.remark ?? null,
            createdById: actorId,
            updatedById: actorId,
          },
        });
      }

      return { id: header.id, code: header.code };
    });
  } catch (e) {
    if (e instanceof Error && e.message === 'OVER_SOURCE_BALANCE') {
      return fail(
        ERROR_CODES.PURCHASE_RETURN_OVER_SOURCE_BALANCE,
        '退货数量超过来源可退上限',
        409,
      );
    }
    throw e;
  }

  // DRAFT 创建不发领域事件（对齐规则⑧事件纪律）——仅 AuditLog 留痕
  await writeAuditLog({
    actorId,
    action: 'PurchaseReturnCreated',
    entityType: 'purchase-return',
    entityId: created.id,
    afterData: {
      purchaseReturnId: created.id,
      purchaseReturnCode: created.code,
      purchaseOrderId: po.id,
      supplierId: po.supplierId,
      returnType: data.returnType,
      createdById: actorId,
    },
    meta,
  });

  return ok(created);
}
