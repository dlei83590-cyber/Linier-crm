import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation } from '@/lib/api/response';
import { ERROR_CODES, type ErrorCode } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { inventoryConversionCancelSchema } from '@/lib/api/schemas';

export const dynamic = 'force-dynamic';

/**
 * POST /api/inventory-conversions/:id/cancel —— 取消转换（DRAFT/SUBMITTED → CANCELLED）
 * CTO 6B-4 规则：
 * - DRAFT/SUBMITTED 可取消（未落账）；**EXECUTED 禁**（已落账，纠错未来走 Reversal/Correction，不允许 Cancel 回滚库存）；
 * - CAS version 乐观锁；
 * - 事件：取消不发领域事件（仅 AuditLog）；**取消不触碰库存账**（从未 EXECUTED，无 Movement 可回滚）。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'inventory-conversion:close');
  if (denied) return denied;
  requestLog(request, user?.id, 'inventory-conversion.cancel');

  const { id } = await params;
  const parsed = inventoryConversionCancelSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version } = parsed.data;
  const meta = requestMeta(request);
  const actorId = user!.id;

  let result:
    | { ok: true; conversion: NonNullable<Awaited<ReturnType<typeof prisma.inventoryConversion.findFirst>>> }
    | { ok: false; error: string }
    | undefined;

  try {
    result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "InventoryConversion" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
      );
      if (locked.length === 0) return { ok: false as const, error: 'NOT_FOUND' };

      const conversion = await tx.inventoryConversion.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, status: true, version: true },
      });
      if (!conversion) return { ok: false as const, error: 'NOT_FOUND' };
      // 状态门禁：EXECUTED 禁取消（已落账——纠错走 Reversal/Correction，不允许 Cancel 回滚库存）
      if (conversion.status === 'EXECUTED') {
        return { ok: false as const, error: 'EXECUTED_FORBIDDEN' };
      }
      if (conversion.status === 'CANCELLED') {
        return { ok: false as const, error: 'INVALID_STATE' };
      }
      if (conversion.version !== version) {
        return { ok: false as const, error: 'VERSION_CONFLICT' };
      }

      const cas = await tx.inventoryConversion.updateMany({
        where: { id, version, deletedAt: null, status: { notIn: ['EXECUTED', 'CANCELLED'] } },
        data: { status: 'CANCELLED', updatedById: actorId, version: { increment: 1 } },
      });
      if (cas.count !== 1) {
        return { ok: false as const, error: 'VERSION_CONFLICT' };
      }

      const finalConversion = await tx.inventoryConversion.findFirstOrThrow({
        where: { id, deletedAt: null },
        include: {
          item: { select: { id: true, code: true, name: true, model: true } },
          baseUom: { select: { id: true, code: true, symbol: true } },
        },
      });
      return { ok: true as const, conversion: finalConversion };
    });
  } catch (err) {
    console.error('[inventory-conversion.cancel]', err);
    return fail(ERROR_CODES.INTERNAL_ERROR, '取消转换单失败', 500);
  }

  if (!result || result.ok === false) {
    const codeMap: Record<string, { code: ErrorCode; msg: string; status: number }> = {
      NOT_FOUND: { code: ERROR_CODES.INVENTORY_CONVERSION_NOT_FOUND, msg: '转换单不存在', status: 404 },
      EXECUTED_FORBIDDEN: { code: ERROR_CODES.INVENTORY_CONVERSION_INVALID_STATE, msg: '已 EXECUTED 的转换单不可取消（已落账，纠错走 Reversal/Correction）', status: 409 },
      INVALID_STATE: { code: ERROR_CODES.INVENTORY_CONVERSION_INVALID_STATE, msg: '已取消的转换单不可重复取消', status: 409 },
      VERSION_CONFLICT: { code: ERROR_CODES.VERSION_CONFLICT, msg: '版本冲突，请刷新后重试', status: 409 },
    };
    const entry = result?.ok === false ? codeMap[result.error] : undefined;
    if (entry) return fail(entry.code, entry.msg, entry.status);
    return fail(ERROR_CODES.INTERNAL_ERROR, '取消转换单失败', 500);
  }

  await writeAuditLog({
    actorId,
    action: 'inventory-conversion:cancel',
    entityType: 'inventory-conversion',
    entityId: result.conversion.id,
    afterData: { conversionNo: result.conversion.conversionNo, status: result.conversion.status },
    meta,
  });

  return ok({ conversion: result.conversion });
}
