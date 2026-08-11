import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation, failConflict, failNotFound } from '@/lib/api/response';
import { ERROR_CODES } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { stockCountUpdateSchema } from '@/lib/api/schemas';

export const dynamic = 'force-dynamic';

/** GET /api/stock-counts/:id（详情：Header + 盘点人 + Lines(Item/UOM/五维/快照/variance)） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'stock-count:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'stock-count.get');

  const { id } = await params;
  const count = await prisma.stockCount.findFirst({
    where: { id, deletedAt: null },
    include: {
      countedBy: { select: { id: true, name: true, email: true } },
      lines: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
        include: {
          warehouse: { select: { id: true, code: true, name: true } },
          location: { select: { id: true, code: true, name: true } },
          item: { select: { id: true, code: true, name: true, model: true } },
        },
      },
    },
  });
  if (!count) return failNotFound(ERROR_CODES.STOCK_COUNT_NOT_FOUND, '盘点单不存在');

  return ok(count);
}

/**
 * PATCH /api/stock-counts/:id（更新 header remark；**仅 DRAFT**；CAS `id + version + status=DRAFT`）
 * CTO 6B-3 Count + Adjustment 事实链规则：
 * - 仅 DRAFT 可编辑（INVALID_STATE）；CAS version 乐观锁（VERSION_CONFLICT）；
 * - **红线：DRAFT 变更不发领域事件**（仅 AuditLog）；Count 永不直接改 StockProjection；
 * - 盘点行由 POST /:id/lines 独立录入（per-line atomic snapshot），不在此端点。
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'stock-count:edit');
  if (denied) return denied;
  requestLog(request, user?.id, 'stock-count.update');

  const { id } = await params;
  const parsed = stockCountUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version, ...fields } = parsed.data;
  const meta = requestMeta(request);
  const actorId = user!.id;

  const existing = await prisma.stockCount.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, status: true, version: true },
  });
  if (!existing) return failNotFound(ERROR_CODES.STOCK_COUNT_NOT_FOUND, '盘点单不存在');
  if (existing.status !== 'DRAFT') {
    return failConflict(
      ERROR_CODES.STOCK_COUNT_INVALID_STATE,
      `仅 DRAFT 状态可编辑（当前 ${existing.status}）；已开始/已完成的盘点事实不可修改`,
    );
  }
  if (existing.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, '版本冲突，请刷新后重试');
  }

  try {
    const cas = await prisma.stockCount.updateMany({
      where: { id, version, status: 'DRAFT', deletedAt: null },
      data: {
        ...(fields.remark !== undefined ? { remark: fields.remark } : {}),
        updatedById: actorId,
        version: { increment: 1 },
      },
    });
    if (cas.count !== 1) {
      return failConflict(ERROR_CODES.VERSION_CONFLICT, '版本冲突，请刷新后重试');
    }

    const count = await prisma.stockCount.findFirstOrThrow({
      where: { id, deletedAt: null },
      include: {
        countedBy: { select: { id: true, name: true, email: true } },
      },
    });

    await writeAuditLog({
      actorId,
      action: 'stock-count:update',
      entityType: 'stock-count',
      entityId: count.id,
      afterData: { countNo: count.countNo, status: count.status, version: count.version },
      meta,
    });

    return ok({ count });
  } catch (err) {
    console.error('[stock-count.update]', err);
    return fail(ERROR_CODES.INTERNAL_ERROR, '更新盘点单失败', 500);
  }
}
