import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation, parsePagination } from '@/lib/api/response';
import { ERROR_CODES, type ErrorCode } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { inventoryAdjustmentCreateSchema } from '@/lib/api/schemas';
import {
  nextAdjustmentNo,
  InventoryAdjustmentSequenceMissingError,
  adjustmentLineDedupeKey,
} from '@/lib/inventory-adjustment/helpers';

export const dynamic = 'force-dynamic';

/** GET /api/inventory-adjustments（分页 + adjustmentNo/status/reasonCode/sourceStockCountId 过滤 + createdAt desc） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'inventory-adjustment:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'inventory-adjustment.list');

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const adjustmentNo = searchParams.get('adjustmentNo')?.trim();
  const status = searchParams.get('status')?.trim();
  const reasonCode = searchParams.get('reasonCode')?.trim();
  const sourceStockCountId = searchParams.get('sourceStockCountId')?.trim();

  const where = {
    deletedAt: null,
    ...(adjustmentNo ? { adjustmentNo: { contains: adjustmentNo, mode: 'insensitive' as const } } : {}),
    ...(status ? { status: status as never } : {}),
    ...(reasonCode ? { reasonCode } : {}),
    ...(sourceStockCountId ? { sourceStockCountId } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.inventoryAdjustment.count({ where }),
    prisma.inventoryAdjustment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        sourceStockCount: { select: { id: true, countNo: true, status: true } },
        approvedBy: { select: { id: true, name: true, email: true } },
        appliedBy: { select: { id: true, name: true, email: true } },
        _count: { select: { lines: true } },
      },
    }),
  ]);

  return ok({ total, page, pageSize, items });
}

/**
 * POST /api/inventory-adjustments —— 创建调整单（DRAFT；**创建即取号 ADJ**；Manual 或引用 Count 差异）
 * CTO 6B-3 Count + Adjustment 事实链规则：
 * - reasonCode（P8 Final）：系统保留码（COUNT_VARIANCE/DAMAGE/LOSS/GIFT/SYSTEM_CORRECTION/MANUAL）+ 可扩展字典（不写死 enum）；
 * - sourceStockCountId 可空（Manual 无盘点来源）；**Minor Hardening ②**：非空 sourceStockCountId ⇒
 *   每个非空 sourceStockCountLineId 必须属于该 StockCount（service Gate 事务内校验，拒绝跨单引用）；
 * - **sourceStockCountLineId @unique（Blocking ②）**：一个 StockCountLine 最多被一个正式 AdjustmentLine 结算
 *   （防双重入账；PG 普通 UNIQUE 允许多个 NULL——Manual 不受影响）；
 * - maker-checker（P9 Final + Integrity ②）：createdById NOT NULL（创建人）；批准/Apply 人必须 ≠ 创建人
 *   （DB CHECK 兜底）；系统自动创建的 Count Adjustment 由 Count complete 生成（本端点主要服务 Manual）；
 * - 行：direction 行级（IN/OUT）+ quantity 恒正（>0）；serial-managed 逐 serial（serialNo 单值原子化）；
 * - **红线：DRAFT 不落账**（不创建 InventoryMovement / 不更新 StockProjection——只有 Apply 经 Shared Core）。
 */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'inventory-adjustment:create');
  if (denied) return denied;
  requestLog(request, user?.id, 'inventory-adjustment.create');

  const parsed = inventoryAdjustmentCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const data = parsed.data;
  const meta = requestMeta(request);
  const actorId = user!.id;

  // ① 行去重（同一调整单内五维组合只能出现一次）
  const dedupeKeys = data.lines.map((l) =>
    adjustmentLineDedupeKey({
      warehouseId: l.warehouseId,
      locationId: l.locationId ?? null,
      itemId: l.itemId,
      batchNo: l.batchNo ?? null,
      serialNo: l.serialNo ?? null,
    }),
  );
  if (new Set(dedupeKeys).size !== dedupeKeys.length) {
    return fail(ERROR_CODES.INVENTORY_ADJUSTMENT_DUPLICATE_LINE, '同一调整单内相同五维组合只能出现一次', 400);
  }

  let result:
    | { ok: true; adjustment: NonNullable<Awaited<ReturnType<typeof prisma.inventoryAdjustment.findFirst>>> }
    | { ok: false; error: string }
    | undefined;

  try {
    result = await prisma.$transaction(async (tx) => {
      // ② warehouse/location 组合 FK + item 校验 + Minor Hardening ② 来源一致性
      for (const l of data.lines) {
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

        // Minor Hardening ②：非空 sourceStockCountLineId 必须属于 sourceStockCountId 指向的盘点单
        if (l.sourceStockCountLineId) {
          if (!data.sourceStockCountId) {
            return { ok: false as const, error: 'SOURCE_COUNT_INVALID' };
          }
          const countLine = await tx.stockCountLine.findFirst({
            where: { id: l.sourceStockCountLineId, countHeaderId: data.sourceStockCountId, deletedAt: null },
            select: { id: true },
          });
          if (!countLine) {
            return { ok: false as const, error: 'SOURCE_COUNT_INVALID' };
          }
        }
      }
      // ③ 若声明来源盘点单，其必须存在且为已锁定的差异事实（COMPLETED/ADJUSTED）
      if (data.sourceStockCountId) {
        const src = await tx.stockCount.findFirst({
          where: { id: data.sourceStockCountId, deletedAt: null, status: { in: ['COMPLETED', 'ADJUSTED'] } },
          select: { id: true },
        });
        if (!src) return { ok: false as const, error: 'SOURCE_COUNT_INVALID' };
      }

      // ④ 创建（创建即取号 ADJ；DRAFT；createdById NOT NULL maker-checker）
      const adjustmentNo = await nextAdjustmentNo(tx);
      const adjustment = await tx.inventoryAdjustment.create({
        data: {
          adjustmentNo,
          status: 'DRAFT',
          reasonCode: data.reasonCode,
          sourceStockCountId: data.sourceStockCountId ?? null,
          remark: data.remark ?? null,
          createdById: actorId,
          updatedById: actorId,
          lines: {
            create: data.lines.map((l) => ({
              warehouseId: l.warehouseId,
              locationId: l.locationId ?? null,
              itemId: l.itemId,
              batchNo: l.batchNo ?? null,
              serialNo: l.serialNo ?? null,
              direction: l.direction,
              quantity: l.quantity,
              uomId: l.uomId ?? null,
              sourceStockCountLineId: l.sourceStockCountLineId ?? null,
              remark: l.remark ?? null,
              createdById: actorId,
              updatedById: actorId,
            })),
          },
        },
        include: {
          sourceStockCount: { select: { id: true, countNo: true, status: true } },
          lines: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
        },
      });
      return { ok: true as const, adjustment };
    });
  } catch (err) {
    // CTO Transfer Review Blocking ① 同款治理：ADJ DocumentSequence 缺失 = 部署配置错误（fail closed）
    if (err instanceof InventoryAdjustmentSequenceMissingError) {
      return fail(ERROR_CODES.INVENTORY_ADJUSTMENT_SEQUENCE_MISSING, err.message, 500);
    }
    // sourceStockCountLineId @unique 冲突 = 该盘点行已被其他 Adjustment 结算（防双重入账）
    if (err instanceof Error && 'code' in err && (err as { code?: string }).code === 'P2002') {
      return fail(
        ERROR_CODES.INVENTORY_ADJUSTMENT_SOURCE_LINE_ALREADY_SETTLED,
        '盘点差异行已被其他调整单结算（一条盘点差异只能正式结算一次）',
        409,
      );
    }
    console.error('[inventory-adjustment.create]', err);
    return fail(ERROR_CODES.INTERNAL_ERROR, '创建调整单失败', 500);
  }

  if (!result || result.ok === false) {
    const codeMap: Record<string, { code: ErrorCode; msg: string; status: number }> = {
      WAREHOUSE_INVALID: { code: ERROR_CODES.INVENTORY_ADJUSTMENT_WAREHOUSE_INVALID, msg: '仓库不存在或已停用', status: 400 },
      LOCATION_INVALID: { code: ERROR_CODES.INVENTORY_ADJUSTMENT_LOCATION_INVALID, msg: '库位不存在或不属于对应仓库', status: 400 },
      ITEM_INVALID: { code: ERROR_CODES.INVENTORY_ADJUSTMENT_ITEM_INVALID, msg: '物料不存在或已停用', status: 400 },
      SOURCE_COUNT_INVALID: { code: ERROR_CODES.INVENTORY_ADJUSTMENT_SOURCE_COUNT_INVALID, msg: '来源盘点单无效或盘点差异行不属于该盘点单（跨单引用拒绝）', status: 400 },
    };
    const entry = result?.ok === false ? codeMap[result.error] : undefined;
    if (entry) return fail(entry.code, entry.msg, entry.status);
    return fail(ERROR_CODES.INTERNAL_ERROR, '创建调整单失败', 500);
  }

  await writeAuditLog({
    actorId,
    action: 'inventory-adjustment:create',
    entityType: 'inventory-adjustment',
    entityId: result.adjustment.id,
    afterData: {
      adjustmentNo: result.adjustment.adjustmentNo,
      status: result.adjustment.status,
      reasonCode: result.adjustment.reasonCode,
      sourceStockCountId: result.adjustment.sourceStockCountId,
    },
    meta,
  });

  return ok({ adjustment: result.adjustment }, undefined, 201);
}
