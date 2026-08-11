import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation } from '@/lib/api/response';
import { ERROR_CODES, type ErrorCode } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { stockCountCompleteSchema } from '@/lib/api/schemas';
import { computeVarianceQty } from '@/lib/stock-count/helpers';
import { publishStockCountEvent } from '@/lib/stock-count/events';

export const dynamic = 'force-dynamic';

/**
 * POST /api/stock-counts/:id/complete —— 完成盘点（COUNTING → COMPLETED / ADJUSTED）
 * CTO 6B-3 Count + Adjustment 事实链核心：
 * - 校验：至少一条有效行；所有行已 snapshot（bookQtyAtCount 非空）；varianceQty 服务端计算
 *   （countedQty - bookQtyAtCount，**无动态补偿公式**——盘点期间正常 Movement 同时改变物理与账面库存）；
 * - **差异处理（Architecture Gate §4.2）**：零差异行 → 不生成 Movement；非零差异行 →
 *   自动生成 COUNT_VARIANCE InventoryAdjustment（sourceStockCountId 指向本盘点单，
 *   lines 引用 sourceStockCountLineId @unique 防双重入账；正差异 = IN 补账，负差异 = OUT 冲减，
 *   quantity=|variance|；createdById = 盘点完成人——明确 actor，maker-checker 闭环）；
 * - Count 状态：有非零差异 → ADJUSTED；零差异 → COMPLETED；
 * - **红线：Count 本身不产生 Movement、不更新 StockProjection**——只有 Adjustment Apply
 *   才经 Shared LedgerCommand 落账；生成的 Adjustment 仍需审批（System Default 非零差异需审批，P7 Final）；
 * - 幂等：已 COMPLETED/ADJUSTED → 409 ALREADY_COMPLETED（不重复生成 Adjustment）。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'stock-count:edit');
  if (denied) return denied;
  requestLog(request, user?.id, 'stock-count.complete');

  const { id } = await params;
  const parsed = stockCountCompleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version } = parsed.data;
  const meta = requestMeta(request);
  const actorId = user!.id;

  let result:
    | {
        ok: true;
        count: NonNullable<Awaited<ReturnType<typeof prisma.stockCount.findFirst>>> & {
          lines: Array<{
            id: string;
            warehouseId: string;
            locationId: string | null;
            itemId: string;
            batchNo: string | null;
            serialNo: string | null;
            countedQty: Prisma.Decimal;
            bookQtyAtCount: Prisma.Decimal;
            varianceQty: Prisma.Decimal | null;
          }>;
        };
        adjustment: { id: string; adjustmentNo: string } | null;
      }
    | { ok: false; error: string }
    | undefined;

  try {
    result = await prisma.$transaction(async (tx) => {
      // ① 锁盘点单（FOR UPDATE）
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "StockCount" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
      );
      if (locked.length === 0) return { ok: false as const, error: 'NOT_FOUND' };

      const count = await tx.stockCount.findFirst({
        where: { id, deletedAt: null },
        include: { lines: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } } },
      });
      if (!count) return { ok: false as const, error: 'NOT_FOUND' };

      // ② 状态门禁：DRAFT/COUNTING 可 complete
      if (count.status === 'COMPLETED' || count.status === 'ADJUSTED') {
        return { ok: false as const, error: 'ALREADY_COMPLETED' };
      }
      if (count.status === 'CANCELLED') {
        return { ok: false as const, error: 'INVALID_STATE' };
      }
      // ③ CAS version
      if (count.version !== version) {
        return { ok: false as const, error: 'VERSION_CONFLICT' };
      }
      // ④ 至少一条有效行
      if (count.lines.length === 0) {
        return { ok: false as const, error: 'NO_LINES' };
      }
      // ⑤ 所有行已 snapshot（bookQtyAtCount 非空；countedQty >= 0 由 DB CHECK 兜底）
      const missingSnapshot = count.lines.some((l) => l.bookQtyAtCount === null);
      if (missingSnapshot) {
        return { ok: false as const, error: 'SNAPSHOT_MISSING' };
      }

      // ⑥ 计算/固化 varianceQty（服务端；行录入时已算，此处确认）
      for (const l of count.lines) {
        const variance = computeVarianceQty(l.countedQty, l.bookQtyAtCount);
        if (!l.varianceQty || !l.varianceQty.equals(variance)) {
          await tx.stockCountLine.update({
            where: { id: l.id },
            data: { varianceQty: variance, updatedById: actorId },
          });
        }
      }

      const completedAt = new Date();
      // ⑦ 非零差异行（varianceQty 可空——DB 列 Decimal?；用 ?? 0 兜底防御）
      const diffLines = count.lines.filter((l) => !(l.varianceQty ?? new Prisma.Decimal(0)).isZero());

      // ⑧ 锁定盘点（COUNTING → COMPLETED 先置；若有差异随后置 ADJUSTED）
      await tx.stockCount.update({
        where: { id },
        data: {
          status: diffLines.length > 0 ? 'ADJUSTED' : 'COMPLETED',
          countedById: actorId,
          completedAt,
          updatedById: actorId,
          version: { increment: 1 },
        },
      });

      // ⑨ 非零差异 → 自动生成 COUNT_VARIANCE Adjustment（DRAFT；仍需审批；绝不自动 APPLIED）
      let adjustment: { id: string; adjustmentNo: string } | null = null;
      if (diffLines.length > 0) {
        // 取号 ADJ（创建即取号；Sequence 缺失 = 配置错误，由外层 catch 映射 500）
        const seq = await tx.documentSequence.findFirst({
          where: { docType: 'INVENTORY_ADJUSTMENT', isActive: true, deletedAt: null },
        });
        if (!seq) {
          throw new Error('INVENTORY_ADJUSTMENT_SEQUENCE_MISSING');
        }
        const updated = await tx.documentSequence.update({
          where: { id: seq.id },
          data: { nextNo: { increment: 1 } },
        });
        const adjustmentNo = `${seq.prefix}${String(updated.nextNo - 1).padStart(seq.padLength, '0')}`;

        adjustment = await tx.inventoryAdjustment.create({
          data: {
            adjustmentNo,
            status: 'DRAFT',
            reasonCode: 'COUNT_VARIANCE',
            sourceStockCountId: count.id,
            // createdById NOT NULL：明确 actor（盘点完成人——系统自动创建也必须带明确 actor，maker-checker 闭环）
            createdById: actorId,
            updatedById: actorId,
            lines: {
              create: diffLines.map((l) => ({
                warehouseId: l.warehouseId,
                locationId: l.locationId,
                itemId: l.itemId,
                batchNo: l.batchNo,
                serialNo: l.serialNo,
                direction: (l.varianceQty ?? new Prisma.Decimal(0)).gt(0) ? 'IN' : 'OUT', // 正差异 = IN 补账，负差异 = OUT 冲减
                quantity: (l.varianceQty ?? new Prisma.Decimal(0)).abs(),
                sourceStockCountLineId: l.id, // @unique 防双重入账（一个 CountLine 最多一次正式结算）
                createdById: actorId,
                updatedById: actorId,
              })),
            },
          },
          select: { id: true, adjustmentNo: true },
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
      return { ok: true as const, count: finalCount, adjustment };
    });
  } catch (err) {
    // ADJ DocumentSequence 缺失 = 部署配置错误（fail closed，禁 fallback——CTO Blocking ① 同款治理）
    if (err instanceof Error && err.message === 'INVENTORY_ADJUSTMENT_SEQUENCE_MISSING') {
      return fail(ERROR_CODES.INVENTORY_ADJUSTMENT_SEQUENCE_MISSING, 'INVENTORY_ADJUSTMENT DocumentSequence 缺失——部署配置错误，请先执行 seed 初始化', 500);
    }
    console.error('[stock-count.complete]', err);
    return fail(ERROR_CODES.INTERNAL_ERROR, '完成盘点失败（事务已回滚）', 500);
  }

  if (!result || result.ok === false) {
    const codeMap: Record<string, { code: ErrorCode; msg: string; status: number }> = {
      NOT_FOUND: { code: ERROR_CODES.STOCK_COUNT_NOT_FOUND, msg: '盘点单不存在', status: 404 },
      ALREADY_COMPLETED: { code: ERROR_CODES.STOCK_COUNT_ALREADY_COMPLETED, msg: '盘点单已完成/已生成差异调整，禁止重复 complete', status: 409 },
      INVALID_STATE: { code: ERROR_CODES.STOCK_COUNT_INVALID_STATE, msg: '已取消的盘点单不可完成', status: 409 },
      VERSION_CONFLICT: { code: ERROR_CODES.VERSION_CONFLICT, msg: '版本冲突，请刷新后重试', status: 409 },
      NO_LINES: { code: ERROR_CODES.STOCK_COUNT_NO_LINES, msg: '盘点单至少需要一条有效盘点行', status: 400 },
      SNAPSHOT_MISSING: { code: ERROR_CODES.STOCK_COUNT_SNAPSHOT_MISSING, msg: '存在未完成快照的盘点行（bookQtyAtCount 缺失）', status: 400 },
    };
    const entry = result?.ok === false ? codeMap[result.error] : undefined;
    if (entry) return fail(entry.code, entry.msg, entry.status);
    return fail(ERROR_CODES.INTERNAL_ERROR, '完成盘点失败', 500);
  }

  await writeAuditLog({
    actorId,
    action: 'stock-count:complete',
    entityType: 'stock-count',
    entityId: result.count.id,
    afterData: {
      countNo: result.count.countNo,
      status: result.count.status,
      completedAt: result.count.completedAt?.toISOString(),
      countedById: result.count.countedById,
      adjustmentId: result.adjustment?.id ?? null,
      adjustmentNo: result.adjustment?.adjustmentNo ?? null,
    },
    meta,
  });

  // 事务提交后 best-effort 发布 InventoryCountCompleted（EVENTS v1.28 已注册；不含库存余额）
  publishStockCountEvent({
    eventType: 'InventoryCountCompleted',
    actorId,
    entityId: result.count.id,
    payload: {
      countId: result.count.id,
      countNo: result.count.countNo,
      freezeStrategy: result.count.freezeStrategy,
      lines: result.count.lines.map((l) => ({
        lineId: l.id,
        warehouseId: l.warehouseId,
        locationId: l.locationId,
        itemId: l.itemId,
        batchNo: l.batchNo,
        serialNo: l.serialNo,
        countedQty: l.countedQty.toString(),
        bookQtyAtCount: l.bookQtyAtCount.toString(),
        varianceQty: (l.varianceQty ?? new Prisma.Decimal(0)).toString(),
      })),
      countedById: actorId,
      completedAt: result.count.completedAt?.toISOString() ?? new Date().toISOString(),
    },
    meta,
  }).catch(() => undefined);

  return ok({ count: result.count, adjustment: result.adjustment });
}
