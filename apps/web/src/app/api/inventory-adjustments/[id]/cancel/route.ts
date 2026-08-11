import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation } from '@/lib/api/response';
import { ERROR_CODES, type ErrorCode } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { inventoryAdjustmentCancelSchema } from '@/lib/api/schemas';

export const dynamic = 'force-dynamic';

/**
 * POST /api/inventory-adjustments/:id/cancel —— 取消调整（DRAFT/SUBMITTED/APPROVED → CANCELLED）
 * CTO 6B-3 规则：
 * - DRAFT/SUBMITTED/APPROVED 可取消（未落账）；**APPLIED 禁**（已落账，纠错未来走 Reversal/Correction，不允许 Cancel 回滚库存）；
 * - CAS version 乐观锁；
 * - 事件：取消不发领域事件（仅 AuditLog）；**取消不触碰库存账**（从未 APPLIED，无 Movement 可回滚）。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'inventory-adjustment:close');
  if (denied) return denied;
  requestLog(request, user?.id, 'inventory-adjustment.cancel');

  const { id } = await params;
  const parsed = inventoryAdjustmentCancelSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version } = parsed.data;
  const meta = requestMeta(request);
  const actorId = user!.id;

  let result:
    | { ok: true; adjustment: NonNullable<Awaited<ReturnType<typeof prisma.inventoryAdjustment.findFirst>>> }
    | { ok: false; error: string }
    | undefined;

  try {
    result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "InventoryAdjustment" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
      );
      if (locked.length === 0) return { ok: false as const, error: 'NOT_FOUND' };

      const adjustment = await tx.inventoryAdjustment.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, status: true, version: true },
      });
      if (!adjustment) return { ok: false as const, error: 'NOT_FOUND' };
      // 状态门禁：APPLIED 禁取消（已落账——纠错走 Reversal/Correction，不允许 Cancel 回滚库存）
      if (adjustment.status === 'APPLIED') {
        return { ok: false as const, error: 'APPLIED_FORBIDDEN' };
      }
      if (adjustment.status === 'CANCELLED') {
        return { ok: false as const, error: 'INVALID_STATE' };
      }
      if (adjustment.version !== version) {
        return { ok: false as const, error: 'VERSION_CONFLICT' };
      }

      const cas = await tx.inventoryAdjustment.updateMany({
        where: { id, version, deletedAt: null, status: { notIn: ['APPLIED', 'CANCELLED'] } },
        data: { status: 'CANCELLED', updatedById: actorId, version: { increment: 1 } },
      });
      if (cas.count !== 1) {
        return { ok: false as const, error: 'VERSION_CONFLICT' };
      }

      const finalAdjustment = await tx.inventoryAdjustment.findFirstOrThrow({
        where: { id, deletedAt: null },
        include: {
          sourceStockCount: { select: { id: true, countNo: true, status: true } },
        },
      });
      return { ok: true as const, adjustment: finalAdjustment };
    });
  } catch (err) {
    console.error('[inventory-adjustment.cancel]', err);
    return fail(ERROR_CODES.INTERNAL_ERROR, '取消调整单失败', 500);
  }

  if (!result || result.ok === false) {
    const codeMap: Record<string, { code: ErrorCode; msg: string; status: number }> = {
      NOT_FOUND: { code: ERROR_CODES.INVENTORY_ADJUSTMENT_NOT_FOUND, msg: '调整单不存在', status: 404 },
      APPLIED_FORBIDDEN: { code: ERROR_CODES.INVENTORY_ADJUSTMENT_INVALID_STATE, msg: '已 APPLIED 的调整单不可取消（已落账，纠错走 Reversal/Correction）', status: 409 },
      INVALID_STATE: { code: ERROR_CODES.INVENTORY_ADJUSTMENT_INVALID_STATE, msg: '已取消的调整单不可重复取消', status: 409 },
      VERSION_CONFLICT: { code: ERROR_CODES.VERSION_CONFLICT, msg: '版本冲突，请刷新后重试', status: 409 },
    };
    const entry = result?.ok === false ? codeMap[result.error] : undefined;
    if (entry) return fail(entry.code, entry.msg, entry.status);
    return fail(ERROR_CODES.INTERNAL_ERROR, '取消调整单失败', 500);
  }

  await writeAuditLog({
    actorId,
    action: 'inventory-adjustment:cancel',
    entityType: 'inventory-adjustment',
    entityId: result.adjustment.id,
    afterData: { adjustmentNo: result.adjustment.adjustmentNo, status: result.adjustment.status },
    meta,
  });

  return ok({ adjustment: result.adjustment });
}
