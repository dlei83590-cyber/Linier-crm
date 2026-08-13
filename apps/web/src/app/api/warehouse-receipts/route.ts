import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation, parsePagination } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { warehouseReceiptCreateSchema } from '@/lib/api/schemas';
import {
import { handleServerError } from "@/lib/api/server-error";
  nextWarehouseReceiptCode,
  computeInspectionUsedQty,
  computeInspectionAvailableQty,
} from '@/lib/warehouse-receipt/helpers';

export const dynamic = 'force-dynamic';

/** GET /api/warehouse-receipts（分页 + code/purchaseReceiptId/warehouseId/status 过滤 + createdAt desc 排序） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'warehouse-receipt:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'warehouse-receipt.list');

  try {

    const { searchParams } = new URL(request.url);
    const { page, pageSize, skip, take } = parsePagination(searchParams);
    const code = searchParams.get('code')?.trim();
    const purchaseReceiptId = searchParams.get('purchaseReceiptId')?.trim();
    const warehouseId = searchParams.get('warehouseId')?.trim();
    const status = searchParams.get('status')?.trim();

    const where = {
      deletedAt: null,
      ...(code ? { code: { contains: code, mode: 'insensitive' as const } } : {}),
      ...(purchaseReceiptId ? { purchaseReceiptId } : {}),
      ...(warehouseId ? { warehouseId } : {}),
      ...(status ? { status: status as never } : {}),
    };

    const [total, items] = await Promise.all([
      prisma.warehouseReceipt.count({ where }),
      prisma.warehouseReceipt.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          purchaseReceipt: { select: { id: true, code: true, status: true } },
          warehouse: { select: { id: true, code: true, name: true } },
          location: { select: { id: true, code: true, name: true } },
          _count: { select: { lines: true } },
        },
      }),
    ]);

    return ok({ total, page, pageSize, items });
  } catch (error) {
    return handleServerError(request, user?.id, "warehouse-receipt.list", error);
  }

}

/**
 * POST /api/warehouse-receipts —— 创建入库单（DRAFT；**D10：Created ≠ Posted，DRAFT 不发领域事件**）
 * CTO #7135 核心 Gate（第一版锁死）：
 * - 来源收货单必须已 RECEIVED（PURCHASE_RECEIPT_NOT_RECEIVED）；
 * - 入库行只能消费**已完成（result ≠ PENDING）且 qualifiedQty > 0** 的 Inspection（INSPECTION_NOT_COMPLETED / INSPECTION_NO_QUALIFIED）；
 * - Inspection 必须属于同一收货行（组合 FK 语义，INSPECTION_MISMATCH）；
 * - **DIRECT_PROJECT（直送）禁入库**（DIRECT_PROJECT_FORBIDDEN，P4）；
 * - quantity > 0 且 ≤ 可入库余额（QUANTITY_INVALID / OVER_INSPECTION_BALANCE）；累计入库 ≤ qualifiedQty；
 * - warehouse 必须有效；location 若提供必须属于同一 warehouse（组合 FK，LOCATION_INVALID）；
 * - 同一入库单内一个收货行只能出现一次（DUPLICATE_LINE）；
 * - 红线：**禁写 Stock / InventoryMovement**（6A 唯一事实源；只有 POSTED 才触发 6A InventoryMovement(IN)）。
 */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'warehouse-receipt:create');
  if (denied) return denied;
  requestLog(request, user?.id, 'warehouse-receipt.create');

  const parsed = warehouseReceiptCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const data = parsed.data;
  const meta = requestMeta(request);
  const actorId = user!.id;

  // ① 来源收货单必须 RECEIVED
  const receipt = await prisma.purchaseReceipt.findFirst({
    where: { id: data.purchaseReceiptId, deletedAt: null },
    select: { id: true, status: true },
  });
  if (!receipt) {
    return fail(ERROR_CODES.PURCHASE_RECEIPT_NOT_FOUND, '来源收货单不存在', 400);
  }
  if (receipt.status !== 'RECEIVED') {
    return fail(
      ERROR_CODES.WAREHOUSE_RECEIPT_PURCHASE_RECEIPT_NOT_RECEIVED,
      `只有已 RECEIVED 的收货单才能入库（当前 ${receipt.status}）`,
      409,
    );
  }

  // ② 行去重（同一入库单内一个收货行只能出现一次，防重复占用）
  const rawLineIds = data.lines.map((l) => l.purchaseReceiptLineId);
  if (new Set(rawLineIds).size !== rawLineIds.length) {
    return fail(
      ERROR_CODES.WAREHOUSE_RECEIPT_DUPLICATE_LINE,
      '同一入库单内一个收货行只能出现一次（防重复入库占用）',
      400,
    );
  }
  const inspectionIds = [...new Set(data.lines.map((l) => l.inspectionId))];

  // ③ 收货行存在 + 属于该收货单 + DIRECT_PROJECT 禁入库（P4）
  const receiptLines = await prisma.purchaseReceiptLine.findMany({
    where: { id: { in: rawLineIds }, purchaseReceiptId: data.purchaseReceiptId, deletedAt: null },
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

  // ④ Warehouse / Location 校验（组合 FK：location 必须属于同一 warehouse）
  const warehouse = await prisma.warehouse.findFirst({
    where: { id: data.warehouseId, deletedAt: null, isActive: true },
    select: { id: true },
  });
  if (!warehouse) {
    return fail(ERROR_CODES.WAREHOUSE_RECEIPT_WAREHOUSE_INVALID, '仓库不存在或已停用', 400);
  }
  if (data.locationId) {
    const location = await prisma.warehouseLocation.findFirst({
      where: { id: data.locationId, warehouseId: data.warehouseId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!location) {
      return fail(
        ERROR_CODES.WAREHOUSE_RECEIPT_LOCATION_INVALID,
        '库位不存在、已停用或不属于该仓库',
        400,
      );
    }
  }

  // ⑤ 事务：取号 + Header(DRAFT) + Lines（Inspection 完成/合格/余额校验）
  let created: { id: string; code: string } | null = null;
  try {
    created = await prisma.$transaction(async (tx) => {
      const code = await nextWarehouseReceiptCode(tx);
      const header = await tx.warehouseReceipt.create({
        data: {
          code,
          purchaseReceiptId: data.purchaseReceiptId,
          warehouseId: data.warehouseId,
          locationId: data.locationId ?? null,
          status: 'DRAFT',
          remark: data.remark ?? null,
          createdById: actorId,
          updatedById: actorId,
        },
        select: { id: true, code: true },
      });

      const inspections = await tx.inspection.findMany({
        where: { id: { in: inspectionIds }, deletedAt: null },
        select: { id: true, purchaseReceiptLineId: true, result: true, qualifiedQty: true },
      });
      const inspectionById = new Map(inspections.map((i) => [i.id, i]));

      for (const line of data.lines) {
        const inspection = inspectionById.get(line.inspectionId);
        if (!inspection) {
          throw new Error('INSPECTION_NOT_FOUND');
        }
        if (inspection.result === 'PENDING') {
          throw new Error('INSPECTION_NOT_COMPLETED');
        }
        if (inspection.qualifiedQty.lte(0)) {
          throw new Error('INSPECTION_NO_QUALIFIED');
        }
        // 组合 FK 语义：Inspection 必须属于同一收货行（Schema Integrity B①）
        if (inspection.purchaseReceiptLineId !== line.purchaseReceiptLineId) {
          throw new Error('INSPECTION_MISMATCH');
        }
        // 可入库余额 = qualifiedQty - **已 POSTED 占用**（CTO #7192：只有 POSTED 消耗正式额度；本单 DRAFT 未过账不占额度，不双计）
        const usedQty = await computeInspectionUsedQty(tx, inspection.id);
        const availableQty = computeInspectionAvailableQty(inspection.qualifiedQty, usedQty);
        const qty = new Prisma.Decimal(line.quantity);
        if (qty.lte(0) || qty.gt(availableQty)) {
          throw new Error('OVER_INSPECTION_BALANCE');
        }

        const rl = lineById.get(line.purchaseReceiptLineId)!;
        await tx.warehouseReceiptLine.create({
          data: {
            warehouseReceiptId: header.id,
            purchaseReceiptLineId: line.purchaseReceiptLineId,
            inspectionId: inspection.id,
            itemId: rl.itemId,
            quantity: qty,
            uomId: rl.uomId,
            batchNo: line.batchNo ?? null,
            serialNos: line.serialNos ?? [],
            mfgDate: line.mfgDate ? new Date(line.mfgDate) : null,
            expDate: line.expDate ? new Date(line.expDate) : null,
            remark: line.remark ?? null,
            createdById: actorId,
            updatedById: actorId,
          },
        });
      }

      return { id: header.id, code: header.code };
    });
  } catch (e) {
    if (e instanceof Error) {
      const map: Record<string, { code: string; msg: string }> = {
        INSPECTION_NOT_FOUND: {
          code: ERROR_CODES.WAREHOUSE_RECEIPT_INSPECTION_NOT_FOUND,
          msg: '质检记录不存在或已删除',
        },
        INSPECTION_NOT_COMPLETED: {
          code: ERROR_CODES.WAREHOUSE_RECEIPT_INSPECTION_NOT_COMPLETED,
          msg: '来源 Inspection 必须已完成（result ≠ PENDING）才能入库',
        },
        INSPECTION_NO_QUALIFIED: {
          code: ERROR_CODES.WAREHOUSE_RECEIPT_INSPECTION_NO_QUALIFIED,
          msg: '来源 Inspection 无合格数量（qualifiedQty <= 0）',
        },
        INSPECTION_MISMATCH: {
          code: ERROR_CODES.WAREHOUSE_RECEIPT_INSPECTION_MISMATCH,
          msg: 'Inspection 不属于该收货行（组合 FK 语义）',
        },
        OVER_INSPECTION_BALANCE: {
          code: ERROR_CODES.WAREHOUSE_RECEIPT_OVER_INSPECTION_BALANCE,
          msg: '入库数量超过 Inspection 可入库余额（qualifiedQty - 已占用）',
        },
      };
      const hit = map[e.message];
      if (hit) {
        return fail(hit.code as never, hit.msg, 409);
      }
    }
    throw e;
  }

  // DRAFT 创建不发领域事件（D10：Created ≠ Posted）——仅 AuditLog 留痕
  await writeAuditLog({
    actorId,
    action: 'WarehouseReceiptCreated',
    entityType: 'warehouse-receipt',
    entityId: created.id,
    afterData: {
      warehouseReceiptId: created.id,
      warehouseReceiptCode: created.code,
      purchaseReceiptId: data.purchaseReceiptId,
      warehouseId: data.warehouseId,
      locationId: data.locationId ?? null,
      createdById: actorId,
    },
    meta,
  });

  return ok(created);
}
