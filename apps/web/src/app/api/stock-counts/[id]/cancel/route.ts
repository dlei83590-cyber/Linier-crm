import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation } from '@/lib/api/response';
import { ERROR_CODES, type ErrorCode } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { stockCountCancelSchema } from '@/lib/api/schemas';

export const dynamic = 'force-dynamic';

/**
 * POST /api/stock-counts/:id/cancel —— 取消盘点（DRAFT/COUNTING → CANCELLED）
 * CTO 6B-3 规则：
 * - 仅 DRAFT/COUNTING 可取消（未锁定盘点事实）；COMPLETED/ADJUSTED 禁（已锁定/已生成差异 Adjustment）；
 * - CAS version 乐观锁；
 * - **红线：Count 本身不产生 Movement**——取消不触碰库存账（差异从未落账，无需 Reversal）；
 * - 事件：取消不发领域事件（仅 AuditLog）。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'stock-count:close');
  if (denied) return denied;
  requestLog(request, user?.id, 'stock-count.cancel');

  const { id } = await params;
  const parsed = stockCountCancelSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version } = parsed.data;
  const meta = requestMeta(request);
  const actorId = user!.id;

  let result:
    | { ok: true; count: NonNullable<Awaited<ReturnType<typeof prisma.stockCount.findFirst>>> }
    | { ok: false; error: string }
    | undefined;

  try {
    result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "StockCount" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
      );
      if (locked.length === 0) return { ok: false as const, error: 'NOT_FOUND' };

      const count = await tx.stockCount.findFirst({ where: { id, deletedAt: null }, select: { id: true, status: true, version: true } });
      if (!count) return { ok: false as const, error: 'NOT_FOUND' };
      if (count.status !== 'DRAFT' && count.status !== 'COUNTING') {
        return { ok: false as const, error: 'INVALID_STATE' };
      }
      if (count.version !== version) {
        return { ok: false as const, error: 'VERSION_CONFLICT' };
      }

      const cas = await tx.stockCount.updateMany({
        where: { id, version, deletedAt: null, status: { in: ['DRAFT', 'COUNTING'] } },
        data: { status: 'CANCELLED', updatedById: actorId, version: { increment: 1 } },
      });
      if (cas.count !== 1) {
        return { ok: false as const, error: 'VERSION_CONFLICT' };
      }

      const finalCount = await tx.stockCount.findFirstOrThrow({
        where: { id, deletedAt: null },
        include: { countedBy: { select: { id: true, name: true, email: true } } },
      });
      return { ok: true as const, count: finalCount };
    });
  } catch (err) {
    console.error('[stock-count.cancel]', err);
    return fail(ERROR_CODES.INTERNAL_ERROR, '取消盘点单失败', 500);
  }

  if (!result || result.ok === false) {
    const codeMap: Record<string, { code: ErrorCode; msg: string; status: number }> = {
      NOT_FOUND: { code: ERROR_CODES.STOCK_COUNT_NOT_FOUND, msg: '盘点单不存在', status: 404 },
      INVALID_STATE: { code: ERROR_CODES.STOCK_COUNT_INVALID_STATE, msg: '仅 DRAFT/COUNTING 状态可取消（已锁定盘点事实不可取消）', status: 409 },
      VERSION_CONFLICT: { code: ERROR_CODES.VERSION_CONFLICT, msg: '版本冲突，请刷新后重试', status: 409 },
    };
    const entry = result?.ok === false ? codeMap[result.error] : undefined;
    if (entry) return fail(entry.code, entry.msg, entry.status);
    return fail(ERROR_CODES.INTERNAL_ERROR, '取消盘点单失败', 500);
  }

  await writeAuditLog({
    actorId,
    action: 'stock-count:cancel',
    entityType: 'stock-count',
    entityId: result.count.id,
    afterData: { countNo: result.count.countNo, status: result.count.status },
    meta,
  });

  return ok({ count: result.count });
}
