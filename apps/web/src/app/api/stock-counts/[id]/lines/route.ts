import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation } from '@/lib/api/response';
import { ERROR_CODES, type ErrorCode } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { stockCountLinesSchema } from '@/lib/api/schemas';
import { countLineDedupeKey, readProjectionSnapshot, computeVarianceQty } from '@/lib/stock-count/helpers';

export const dynamic = 'force-dynamic';

/**
 * POST /api/stock-counts/:id/lines —— 录入盘点行（**per-line atomic snapshot——CTO #7975 Blocking ① 核心**）
 * CTO 6B-3 Count + Adjustment 事实链规则：
 * - 状态：DRAFT/COUNTING 可录入；**首次录入自动转 COUNTING（开始盘点）**；
 * - 每行：五维（warehouse/location/item/batch/serial）+ countedQty（>= 0）；
 * - **同事务读取五维 StockProjection** → bookQtyAtCount / countedAt / ledgerWatermark（仅审计）；
 *   varianceQty = countedQty - bookQtyAtCount（服务端计算，**无动态补偿公式**）；
 * - 行去重：同一 Count 内五维唯一（API 校验 + DB UNIQUE NULLS NOT DISTINCT 兜底）；
 * - warehouse/location 组合 FK + item 有效校验；
 * - **红线：Count 本身不产生 Movement、不更新 StockProjection**（实盘事实 ≠ 库存账事实；差异经 Adjustment 落账）。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'stock-count:edit');
  if (denied) return denied;
  requestLog(request, user?.id, 'stock-count.lines');

  const { id } = await params;
  const parsed = stockCountLinesSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { lines } = parsed.data;
  const meta = requestMeta(request);
  const actorId = user!.id;

  // ① 行去重（同一盘点单内五维组合只能出现一次）
  const dedupeKeys = lines.map((l) =>
    countLineDedupeKey({
      warehouseId: l.warehouseId,
      locationId: l.locationId ?? null,
      itemId: l.itemId,
      batchNo: l.batchNo ?? null,
      serialNo: l.serialNo ?? null,
    }),
  );
  if (new Set(dedupeKeys).size !== dedupeKeys.length) {
    return fail(ERROR_CODES.STOCK_COUNT_DUPLICATE_LINE, '同一盘点单内相同五维（仓库/库位/物料/批次/序列号）只能盘一次', 400);
  }

  let result:
    | { ok: true; count: NonNullable<Awaited<ReturnType<typeof prisma.stockCount.findFirst>>> }
    | { ok: false; error: string }
    | undefined;

  try {
    result = await prisma.$transaction(async (tx) => {
      // ② 锁盘点单（FOR UPDATE）
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "StockCount" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
      );
      if (locked.length === 0) return { ok: false as const, error: 'NOT_FOUND' };

      const count = await tx.stockCount.findFirst({ where: { id, deletedAt: null }, select: { id: true, status: true } });
      if (!count) return { ok: false as const, error: 'NOT_FOUND' };
      // ③ 状态门禁：DRAFT/COUNTING 可录入
      if (count.status !== 'DRAFT' && count.status !== 'COUNTING') {
        return { ok: false as const, error: 'INVALID_STATE' };
      }

      // ④ 每行：warehouse/location 组合 FK + item 校验 → 五维快照 → 创建盘点行
      for (const l of lines) {
        const wh = await tx.warehouse.findFirst({ where: { id: l.warehouseId, deletedAt: null } });
        if (!wh) return { ok: false as const, error: 'WAREHOUSE_INVALID' };
        if (l.locationId) {
          const loc = await tx.warehouseLocation.findFirst({
            where: { id: l.locationId, warehouseId: l.warehouseId, deletedAt: null },
          });
          if (!loc) return { ok: false as const, error: 'LOCATION_INVALID' };
        }
        const item = await tx.item.findFirst({ where: { id: l.itemId, deletedAt: null } });
        if (!item) return { ok: false as const, error: 'ITEM_INVALID' };

        // per-line atomic snapshot：同事务读取五维 StockProjection
        const snapshot = await readProjectionSnapshot(tx, {
          warehouseId: l.warehouseId,
          locationId: l.locationId ?? null,
          itemId: l.itemId,
          batchNo: l.batchNo ?? null,
          serialNo: l.serialNo ?? null,
        });

        const countedAt = new Date();
        const varianceQty = computeVarianceQty(new Prisma.Decimal(l.countedQty), snapshot.bookQtyAtCount);

        await tx.stockCountLine.create({
          data: {
            countHeaderId: id,
            warehouseId: l.warehouseId,
            locationId: l.locationId ?? null,
            itemId: l.itemId,
            batchNo: l.batchNo ?? null,
            serialNo: l.serialNo ?? null,
            countedQty: l.countedQty,
            bookQtyAtCount: snapshot.bookQtyAtCount,
            countedAt,
            ledgerWatermark: snapshot.ledgerWatermark,
            varianceQty,
            remark: l.remark ?? null,
            createdById: actorId,
            updatedById: actorId,
          },
        });
      }

      // ⑤ 首次录入 → 自动转 COUNTING（开始盘点）
      if (count.status === 'DRAFT') {
        await tx.stockCount.update({
          where: { id },
          data: { status: 'COUNTING', updatedById: actorId, version: { increment: 1 } },
        });
      }

      const finalCount = await tx.stockCount.findFirst({
        where: { id, deletedAt: null },
        include: {
          countedBy: { select: { id: true, name: true, email: true } },
          lines: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
        },
      });
      if (!finalCount) return { ok: false as const, error: 'NOT_FOUND' };
      return { ok: true as const, count: finalCount };
    });
  } catch (err) {
    console.error('[stock-count.lines]', err);
    return fail(ERROR_CODES.INTERNAL_ERROR, '录入盘点行失败', 500);
  }

  if (!result || result.ok === false) {
    const codeMap: Record<string, { code: ErrorCode; msg: string; status: number }> = {
      NOT_FOUND: { code: ERROR_CODES.STOCK_COUNT_NOT_FOUND, msg: '盘点单不存在', status: 404 },
      INVALID_STATE: { code: ERROR_CODES.STOCK_COUNT_INVALID_STATE, msg: '仅 DRAFT/COUNTING 状态可录入盘点行', status: 409 },
      WAREHOUSE_INVALID: { code: ERROR_CODES.STOCK_COUNT_WAREHOUSE_INVALID, msg: '仓库不存在或已停用', status: 400 },
      LOCATION_INVALID: { code: ERROR_CODES.STOCK_COUNT_LOCATION_INVALID, msg: '库位不存在或不属于对应仓库', status: 400 },
      ITEM_INVALID: { code: ERROR_CODES.STOCK_COUNT_ITEM_INVALID, msg: '物料不存在或已停用', status: 400 },
    };
    const entry = result?.ok === false ? codeMap[result.error] : undefined;
    if (entry) return fail(entry.code, entry.msg, entry.status);
    return fail(ERROR_CODES.INTERNAL_ERROR, '录入盘点行失败', 500);
  }

  await writeAuditLog({
    actorId,
    action: 'stock-count:lines',
    entityType: 'stock-count',
    entityId: result.count.id,
    afterData: { countNo: result.count.countNo, status: result.count.status, lineCount: result.count.lines.length },
    meta,
  });

  return ok({ count: result.count });
}
