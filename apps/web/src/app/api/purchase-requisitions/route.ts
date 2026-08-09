import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation, failServer, parsePagination } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { purchaseRequisitionCreateSchema } from '@/lib/api/schemas';
import {
  nextPurchaseRequisitionCode,
  validatePurchaseRequisitionQuantity,
} from '@/lib/purchase-requisition/helpers';
import { publishPurchaseRequisitionEvent } from '@/lib/purchase-requisition/events';

export const dynamic = 'force-dynamic';

/** GET /api/purchase-requisitions（分页 + code/status/requesterId/departmentId/dateFrom/dateTo 过滤 + createdAt desc 排序） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'purchase-requisition:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'purchase-requisition.list');

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const code = searchParams.get('code')?.trim();
  const status = searchParams.get('status')?.trim();
  const requesterId = searchParams.get('requesterId')?.trim();
  const departmentId = searchParams.get('departmentId')?.trim();
  const dateFrom = searchParams.get('dateFrom')?.trim();
  const dateTo = searchParams.get('dateTo')?.trim();

  const where = {
    deletedAt: null,
    ...(code ? { code: { contains: code, mode: 'insensitive' as const } } : {}),
    ...(status ? { status: status as never } : {}),
    ...(requesterId ? { requesterId } : {}),
    ...(departmentId ? { departmentId } : {}),
    ...(dateFrom || dateTo
      ? {
          createdAt: {
            ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
            ...(dateTo ? { lte: new Date(dateTo) } : {}),
          },
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.purchaseRequisition.count({ where }),
    prisma.purchaseRequisition.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        requester: { select: { id: true, email: true, name: true } },
        department: { select: { id: true, code: true, name: true } },
        _count: { select: { lines: true } },
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/**
 * POST /api/purchase-requisitions（创建 PR DRAFT，Header + Lines 单事务）
 * 红线（CTO Design Review + Phase 3 指令）：PR = 需求事实源，Header/Line 不得出现金额/单价/税额等采购承诺事实；
 * 创建即从 DocumentSequence(PURCHASE_REQUISITION) 原子取号（PR-2026-xxxx）；Line quantity 必须 > 0（Decimal 精确校验）；
 * Item/UOM 引用在服务端验证；创建不触发审批、不创建 PO。
 */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'purchase-requisition:create');
  if (denied) return denied;
  requestLog(request, user?.id, 'purchase-requisition.create');

  const parsed = purchaseRequisitionCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const data = parsed.data;
  const meta = requestMeta(request);

  // 服务端验证 Item/UOM 引用（红线：引用在服务端验证）
  const itemIds = [...new Set(data.lines.map((l) => l.itemId))];
  const uomIds = [...new Set(data.lines.filter((l) => l.uomId).map((l) => l.uomId!))];
  const [items, uoms] = await Promise.all([
    prisma.item.findMany({ where: { id: { in: itemIds }, deletedAt: null }, select: { id: true } }),
    uomIds.length > 0
      ? prisma.unitOfMeasure.findMany({
          where: { id: { in: uomIds }, deletedAt: null },
          select: { id: true },
        })
      : Promise.resolve([]),
  ]);
  if (items.length !== itemIds.length) {
    return fail(ERROR_CODES.PURCHASE_REQUISITION_ITEM_NOT_FOUND, '存在无效的 Item 引用', 400);
  }
  if (uoms.length !== uomIds.length) {
    return fail(ERROR_CODES.PURCHASE_REQUISITION_UOM_NOT_FOUND, '存在无效的 UOM 引用', 400);
  }

  // 事务：取号 + Header + Lines（创建即取号；任一步失败整体回滚）
  let created: { id: string; code: string } | null = null;
  try {
    created = await prisma.$transaction(async (tx) => {
      const code = await nextPurchaseRequisitionCode(tx);
      const header = await tx.purchaseRequisition.create({
        data: {
          code,
          requesterId: data.requesterId ?? user!.id,
          departmentId: data.departmentId ?? null,
          status: 'DRAFT',
          needDate: data.needDate ? new Date(data.needDate) : null,
          remark: data.remark ?? null,
          createdById: user!.id,
          updatedById: user!.id,
        },
        select: { id: true, code: true },
      });
      for (const [idx, line] of data.lines.entries()) {
        const quantity = new Prisma.Decimal(line.quantity);
        const q = validatePurchaseRequisitionQuantity(quantity);
        if (!q.ok) throw new Error(q.reason);
        await tx.purchaseRequisitionLine.create({
          data: {
            purchaseRequisitionId: header.id,
            lineNo: line.lineNo ?? (idx + 1) * 10,
            itemId: line.itemId,
            description: line.description ?? '',
            quantity,
            uomId: line.uomId ?? null,
            needDate: line.needDate ? new Date(line.needDate) : null,
            remark: line.remark ?? null,
            createdById: user!.id,
            updatedById: user!.id,
          },
        });
      }
      return header;
    });
  } catch (e) {
    if (e instanceof Error && e.message === 'PR_QUANTITY_INVALID') {
      return fail(ERROR_CODES.PURCHASE_REQUISITION_QUANTITY_INVALID, '需求数量必须大于 0', 400);
    }
    throw e;
  }

  if (!created) return failServer('创建采购申请失败');

  await publishPurchaseRequisitionEvent({
    eventType: 'PurchaseRequisitionCreated',
    actorId: user?.id,
    entityId: created.id,
    payload: {
      requisitionId: created.id,
      requisitionCode: created.code,
      requesterId: data.requesterId ?? user!.id,
      departmentId: data.departmentId ?? null,
      createdBy: user?.id,
    },
    meta,
  }).catch(() => undefined);
  await writeAuditLog({
    actorId: user?.id,
    action: 'purchase-requisition.create',
    entityType: 'purchase-requisition',
    entityId: created.id,
    afterData: { code: created.code, lineCount: data.lines.length },
    ...meta,
  });

  return ok(created);
}
