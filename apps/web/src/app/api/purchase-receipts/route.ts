import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation, failServer, parsePagination } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { purchaseReceiptCreateSchema } from '@/lib/api/schemas';
import { nextPurchaseReceiptCode } from '@/lib/purchase-receipt/helpers';

export const dynamic = 'force-dynamic';

/** GET /api/purchase-receipts（分页 + code/purchaseOrderId/supplierId/status/dateFrom/dateTo 过滤 + createdAt desc 排序） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'purchase-receipt:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'purchase-receipt.list');

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const code = searchParams.get('code')?.trim();
  const purchaseOrderId = searchParams.get('purchaseOrderId')?.trim();
  const supplierId = searchParams.get('supplierId')?.trim();
  const status = searchParams.get('status')?.trim();
  const dateFrom = searchParams.get('dateFrom')?.trim();
  const dateTo = searchParams.get('dateTo')?.trim();

  const where = {
    deletedAt: null,
    ...(code ? { code: { contains: code, mode: 'insensitive' as const } } : {}),
    ...(purchaseOrderId ? { purchaseOrderId } : {}),
    ...(supplierId ? { supplierId } : {}),
    ...(status ? { status: status as never } : {}),
    ...(dateFrom || dateTo
      ? {
          receivedAt: {
            ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
            ...(dateTo ? { lte: new Date(dateTo) } : {}),
          },
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.purchaseReceipt.count({ where }),
    prisma.purchaseReceipt.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        purchaseOrder: { select: { id: true, code: true, status: true } },
        supplier: { select: { id: true, code: true, name: true } },
        warehouse: { select: { id: true, code: true, name: true } },
        _count: { select: { lines: true } },
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/**
 * POST /api/purchase-receipts（创建 DRAFT 收货单；普通收货不走审批——P1b Final）
 * 设计依据：ADR-0024 + Sprint5B Field Matrix §1 + CTO #6923 Receive 8 条硬规则：
 * - **收货单创建只是"到货/收货现场事实"的登记（DRAFT），不触发任何库存动作**；只有 Receive 事务（POST /{id}/receive）才完成收货；
 * - **事件纪律（规则⑧）**：DRAFT 创建**不发布** PurchaseReceiptReceived；只有 Receive 事务成功后发布；
 * - 服务端校验：PO 必须存在（CONFIRMED/PARTIALLY_RECEIVED 才可建收货单——规则①）；行必须属于同一 PO（规则②）；
 *   WAREHOUSE 行必须有有效 warehouseId、DIRECT_PROJECT 行不要求（规则③）；quantity>0 且 0<=rejectedOnReceiptQty<=quantity（规则④）；
 * - **5B 永不直接写库存余额 / Stock / InventoryMovement**（6A 唯一事实源）。
 */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'purchase-receipt:create');
  if (denied) return denied;
  requestLog(request, user?.id, 'purchase-receipt.create');

  const parsed = purchaseReceiptCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const data = parsed.data;
  const meta = requestMeta(request);
  const actorId = user!.id;

  // 服务端验证：PO 存在 + 状态可收（规则①：仅 CONFIRMED / PARTIALLY_RECEIVED 可建收货单；RECEIVED 禁普通新增收货）
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: data.purchaseOrderId, deletedAt: null },
    include: { supplier: { select: { id: true, isActive: true } } },
  });
  if (!po) {
    return fail(ERROR_CODES.PURCHASE_RECEIPT_PO_NOT_FOUND, '采购订单不存在', 400);
  }
  if (po.status !== 'CONFIRMED' && po.status !== 'PARTIALLY_RECEIVED') {
    return fail(
      ERROR_CODES.PURCHASE_RECEIPT_PO_STATE_FORBIDDEN,
      `仅 CONFIRMED / PARTIALLY_RECEIVED PO 可收货（当前 ${po.status}）`,
      409,
    );
  }
  if (!po.supplier || po.supplier.isActive === false) {
    return fail(ERROR_CODES.PURCHASE_ORDER_SUPPLIER_NOT_FOUND, '供应商不存在或已停用', 400);
  }

  // 行校验：PO Line 存在 + 属于同一 PO（规则②）
  const poLineIds = [...new Set(data.lines.map((l) => l.purchaseOrderLineId))];
  const poLines = await prisma.purchaseOrderLine.findMany({
    where: { id: { in: poLineIds }, purchaseOrderId: po.id, deletedAt: null },
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

  // warehouse 校验（规则③）：若提供 warehouseId 必须有效；WAREHOUSE 行必须有 warehouseId
  const hasWarehouseLines = data.lines.some(
    (l) => poLineById.get(l.purchaseOrderLineId)?.fulfillmentType === 'WAREHOUSE',
  );
  if (hasWarehouseLines && !data.warehouseId) {
    return fail(
      ERROR_CODES.PURCHASE_RECEIPT_WAREHOUSE_REQUIRED,
      'WAREHOUSE 收货行必须提供有效 warehouseId（DIRECT_PROJECT 行不要求）',
      400,
    );
  }
  if (data.warehouseId) {
    const wh = await prisma.warehouse.findFirst({
      where: { id: data.warehouseId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!wh) {
      return fail(ERROR_CODES.PURCHASE_RECEIPT_WAREHOUSE_INVALID, '仓库不存在或已停用', 400);
    }
  }

  // 事务：取号 + Header（DRAFT）+ Lines
  let created: { id: string; code: string } | null = null;
  try {
    created = await prisma.$transaction(async (tx) => {
      const code = await nextPurchaseReceiptCode(tx);
      const header = await tx.purchaseReceipt.create({
        data: {
          code,
          purchaseOrderId: po.id,
          supplierId: po.supplierId,
          warehouseId: data.warehouseId ?? null,
          status: 'DRAFT',
          remark: data.remark ?? null,
          createdById: actorId,
          updatedById: actorId,
        },
        select: { id: true, code: true },
      });

      let lineNo = 10;
      for (const line of data.lines) {
        const poLine = poLineById.get(line.purchaseOrderLineId)!;
        if (line.quantity <= 0) throw new Error('RECEIPT_QUANTITY_INVALID');
        if (line.rejectedOnReceiptQty > line.quantity) {
          throw new Error('RECEIPT_QUANTITY_INVALID');
        }
        await tx.purchaseReceiptLine.create({
          data: {
            purchaseReceiptId: header.id,
            purchaseOrderLineId: poLine.id,
            lineNo,
            itemId: poLine.itemId,
            quantity: new Prisma.Decimal(line.quantity),
            uomId: poLine.uomId,
            visibleDamageQty: new Prisma.Decimal(line.visibleDamageQty ?? 0),
            rejectedOnReceiptQty: new Prisma.Decimal(line.rejectedOnReceiptQty ?? 0),
            deliveryAddress: line.deliveryAddress ?? null,
            receiver: line.receiver ?? null,
            proof: line.proof ?? null,
            remark: line.remark ?? null,
            createdById: actorId,
            updatedById: actorId,
          },
        });
        lineNo += 10;
      }

      return header;
    });
  } catch (e) {
    if (e instanceof Error && e.message === 'RECEIPT_QUANTITY_INVALID') {
      return fail(ERROR_CODES.PURCHASE_RECEIPT_QUANTITY_INVALID, '收货数量不合法', 400);
    }
    return failServer();
  }

  // DRAFT 创建不发布 PurchaseReceiptReceived（规则⑧：只有 Receive 事务成功后发布）——仅 AuditLog 留痕
  await writeAuditLog({
    actorId,
    action: 'PurchaseReceiptCreated',
    entityType: 'purchase-receipt',
    entityId: created.id,
    afterData: {
      purchaseReceiptId: created.id,
      purchaseReceiptCode: created.code,
      purchaseOrderId: po.id,
      supplierId: po.supplierId,
      warehouseId: data.warehouseId ?? null,
      createdById: actorId,
    },
    meta,
  });

  return ok({ id: created.id, code: created.code });
}
