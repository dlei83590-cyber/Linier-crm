import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation, parsePagination } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { inspectionCreateSchema } from '@/lib/api/schemas';
import { computeInspectableQty } from '@/lib/inspection/helpers';

export const dynamic = 'force-dynamic';

/** GET /api/inspections（分页 + purchaseReceiptLineId/purchaseReceiptId/result/inspectionMode/inspectedById 过滤 + createdAt desc 排序） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'inspection:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'inspection.list');

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const purchaseReceiptLineId = searchParams.get('purchaseReceiptLineId')?.trim();
  const purchaseReceiptId = searchParams.get('purchaseReceiptId')?.trim();
  const result = searchParams.get('result')?.trim();
  const inspectionMode = searchParams.get('inspectionMode')?.trim();
  const inspectedById = searchParams.get('inspectedById')?.trim();

  const where = {
    deletedAt: null,
    ...(purchaseReceiptLineId ? { purchaseReceiptLineId } : {}),
    ...(purchaseReceiptId ? { purchaseReceiptLine: { purchaseReceiptId } } : {}),
    ...(result ? { result: result as never } : {}),
    ...(inspectionMode ? { inspectionMode: inspectionMode as never } : {}),
    ...(inspectedById ? { inspectedById } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.inspection.count({ where }),
    prisma.inspection.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        purchaseReceiptLine: {
          select: {
            id: true,
            lineNo: true,
            quantity: true,
            rejectedOnReceiptQty: true,
            purchaseReceipt: { select: { id: true, code: true, status: true } },
            item: { select: { id: true, code: true, name: true } },
            uom: { select: { id: true, code: true, symbol: true } },
          },
        },
        inspectedBy: { select: { id: true, name: true, email: true } },
      },
    }),
  ]);

  return ok({ total, page, pageSize, items });
}

/**
 * POST /api/inspections —— 创建质检记录（result=PENDING；**不发领域事件**——只有 complete 才发 InspectionCompleted）
 * CTO #7045 硬约束：
 * - 来源必须是已经 **RECEIVED** 的 PurchaseReceiptLine（INSPECTION_LINE_NOT_RECEIVED）；
 * - 同一 PurchaseReceiptLine 至多一个有效 Inspection（一次检验即最终结果，INSPECTION_ALREADY_EXISTS）；
 * - 可检数量 `inspectableQty = quantity - rejectedOnReceiptQty` 必须 > 0（INSPECTION_NO_INSPECTABLE_QTY）；
 * - 红线：Inspection **禁写 Stock / InventoryMovement / WarehouseReceipt**（6A 唯一事实源）。
 */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'inspection:create');
  if (denied) return denied;
  requestLog(request, user?.id, 'inspection.create');

  const parsed = inspectionCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const data = parsed.data;
  const meta = requestMeta(request);
  const actorId = user!.id;

  const line = await prisma.purchaseReceiptLine.findFirst({
    where: { id: data.purchaseReceiptLineId, deletedAt: null },
    select: {
      id: true,
      quantity: true,
      rejectedOnReceiptQty: true,
      purchaseReceipt: { select: { id: true, status: true } },
    },
  });
  if (!line) {
    return fail(ERROR_CODES.INSPECTION_LINE_NOT_FOUND, '收货行不存在', 400);
  }
  if (line.purchaseReceipt.status !== 'RECEIVED') {
    return fail(
      ERROR_CODES.INSPECTION_LINE_NOT_RECEIVED,
      '只有已 RECEIVED 的收货行才能创建质检记录（当前未收货）',
      409,
    );
  }
  const existing = await prisma.inspection.findFirst({
    where: { purchaseReceiptLineId: data.purchaseReceiptLineId, deletedAt: null },
    select: { id: true },
  });
  if (existing) {
    return fail(
      ERROR_CODES.INSPECTION_ALREADY_EXISTS,
      '该收货行已存在有效质检记录（一次检验即最终结果）',
      409,
    );
  }
  // 可检数量 = 物理到货 - 现场拒收（CTO #7045：最大可检数量不应再次包含现场拒收部分）
  const inspectableQty = computeInspectableQty(line.quantity, line.rejectedOnReceiptQty);
  if (inspectableQty.lte(0)) {
    return fail(
      ERROR_CODES.INSPECTION_NO_INSPECTABLE_QTY,
      '无可检数量（quantity - rejectedOnReceiptQty <= 0，全部现场拒收）',
      400,
    );
  }

  const created = await prisma.inspection.create({
    data: {
      purchaseReceiptLineId: data.purchaseReceiptLineId,
      inspectionMode: data.inspectionMode,
      remark: data.remark ?? null,
      createdById: actorId,
      updatedById: actorId,
    },
    select: {
      id: true,
      purchaseReceiptLineId: true,
      inspectionMode: true,
      result: true,
      createdAt: true,
    },
  });

  // DRAFT/PENDING 创建不发领域事件（对齐规则⑧事件纪律）——仅 AuditLog 留痕
  await writeAuditLog({
    actorId,
    action: 'InspectionCreated',
    entityType: 'inspection',
    entityId: created.id,
    afterData: {
      inspectionId: created.id,
      purchaseReceiptLineId: created.purchaseReceiptLineId,
      inspectionMode: created.inspectionMode,
      result: created.result,
    },
    meta,
  });

  return ok(created);
}
