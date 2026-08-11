import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation, failConflict, failNotFound } from '@/lib/api/response';
import { ERROR_CODES, type ErrorCode } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { inventoryAdjustmentUpdateSchema } from '@/lib/api/schemas';
import { adjustmentLineDedupeKey } from '@/lib/inventory-adjustment/helpers';

export const dynamic = 'force-dynamic';

/** GET /api/inventory-adjustments/:id（详情：Header + 来源盘点单 + 审批/Apply 人 + Lines(Item/UOM/五维/direction/quantity)） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'inventory-adjustment:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'inventory-adjustment.get');

  const { id } = await params;
  const adjustment = await prisma.inventoryAdjustment.findFirst({
    where: { id, deletedAt: null },
    include: {
      sourceStockCount: { select: { id: true, countNo: true, status: true } },
      approvedBy: { select: { id: true, name: true, email: true } },
      appliedBy: { select: { id: true, name: true, email: true } },
      lines: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
        include: {
          warehouse: { select: { id: true, code: true, name: true } },
          location: { select: { id: true, code: true, name: true } },
          item: { select: { id: true, code: true, name: true, model: true } },
          uom: { select: { id: true, code: true, symbol: true } },
          sourceStockCountLine: { select: { id: true, countedQty: true, bookQtyAtCount: true, varianceQty: true } },
        },
      },
    },
  });
  if (!adjustment) return failNotFound(ERROR_CODES.INVENTORY_ADJUSTMENT_NOT_FOUND, '调整单不存在');

  return ok(adjustment);
}

/**
 * PATCH /api/inventory-adjustments/:id（更新头 + 可选行全量替换；**仅 DRAFT**；CAS `id + version + status=DRAFT`）
 * CTO 6B-3 规则：
 * - 仅 DRAFT 可编辑（INVALID_STATE）；CAS version 乐观锁（VERSION_CONFLICT）；
 * - reasonCode/sourceStockCountId 编辑时重新校验（Minor Hardening ②：非空 sourceStockCountLineId 必须属于该 Count）；
 * - 行全量替换：行去重 + item/warehouse/location 校验 + direction/quantity 校验；
 * - **红线：DRAFT 变更不发领域事件**（仅 AuditLog）；DRAFT 不落账。
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'inventory-adjustment:edit');
  if (denied) return denied;
  requestLog(request, user?.id, 'inventory-adjustment.update');

  const { id } = await params;
  const parsed = inventoryAdjustmentUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version, lines, ...fields } = parsed.data;
  const meta = requestMeta(request);
  const actorId = user!.id;

  const existing = await prisma.inventoryAdjustment.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, status: true, version: true, sourceStockCountId: true },
  });
  if (!existing) return failNotFound(ERROR_CODES.INVENTORY_ADJUSTMENT_NOT_FOUND, '调整单不存在');
  if (existing.status !== 'DRAFT') {
    return failConflict(
      ERROR_CODES.INVENTORY_ADJUSTMENT_INVALID_STATE,
      `仅 DRAFT 状态可编辑（当前 ${existing.status}）；已提交/已审批/已落账的调整事实不可修改`,
    );
  }
  if (existing.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, '版本冲突，请刷新后重试');
  }

  let result:
    | { ok: true; adjustment: NonNullable<Awaited<ReturnType<typeof prisma.inventoryAdjustment.findFirst>>> }
    | { ok: false; error: string }
    | undefined;

  try {
    result = await prisma.$transaction(async (tx) => {
      // ① 重新读（事务内）+ CAS 锁
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "InventoryAdjustment" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
      );
      if (locked.length === 0) return { ok: false as const, error: 'NOT_FOUND' };

      const cur = await tx.inventoryAdjustment.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, status: true, version: true, sourceStockCountId: true, createdById: true },
      });
      if (!cur) return { ok: false as const, error: 'NOT_FOUND' };
      if (cur.status !== 'DRAFT') return { ok: false as const, error: 'INVALID_STATE' };
      if (cur.version !== version) return { ok: false as const, error: 'VERSION_CONFLICT' };

      // ② sourceStockCountId 本轮不支持编辑（来源事实不可改，保留原值）——直接使用 cur.sourceStockCountId

      // ③ 行处理（lines 提供 → 全量替换）
      let lineCreate: Array<Prisma.InventoryAdjustmentLineCreateManyInput> | undefined;
      if (lines) {
        const dedupeKeys = lines.map((l) =>
          adjustmentLineDedupeKey({
            warehouseId: l.warehouseId,
            locationId: l.locationId ?? null,
            itemId: l.itemId,
            batchNo: l.batchNo ?? null,
            serialNo: l.serialNo ?? null,
          }),
        );
        if (new Set(dedupeKeys).size !== dedupeKeys.length) {
          return { ok: false as const, error: 'DUPLICATE_LINE' };
        }
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
          // Minor Hardening ②：非空 sourceStockCountLineId 必须属于来源盘点单
          if (l.sourceStockCountLineId) {
            if (!cur.sourceStockCountId) {
              return { ok: false as const, error: 'SOURCE_COUNT_INVALID' };
            }
            const countLine = await tx.stockCountLine.findFirst({
              where: { id: l.sourceStockCountLineId, countHeaderId: cur.sourceStockCountId, deletedAt: null },
              select: { id: true },
            });
            if (!countLine) return { ok: false as const, error: 'SOURCE_COUNT_INVALID' };
          }
        }
        lineCreate = lines.map((l) => ({
          adjustmentHeaderId: id,
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
        }));
      }

      // ④ CAS 更新（id + version + status=DRAFT 同时命中）
      const cas = await tx.inventoryAdjustment.updateMany({
        where: { id, version, status: 'DRAFT', deletedAt: null },
        data: {
          ...(fields.reasonCode !== undefined ? { reasonCode: fields.reasonCode } : {}),
          ...(fields.remark !== undefined ? { remark: fields.remark } : {}),
          updatedById: actorId,
          version: { increment: 1 },
        },
      });
      if (cas.count !== 1) return { ok: false as const, error: 'VERSION_CONFLICT' };

      // 行全量替换（仅 DRAFT；CASCADE 删除旧行）
      if (lineCreate) {
        await tx.inventoryAdjustmentLine.deleteMany({ where: { adjustmentHeaderId: id, deletedAt: null } });
        await tx.inventoryAdjustmentLine.createMany({
          data: lineCreate,
        });
      }

      const adjustment = await tx.inventoryAdjustment.findFirst({
        where: { id, deletedAt: null },
        include: {
          sourceStockCount: { select: { id: true, countNo: true, status: true } },
          lines: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
        },
      });
      if (!adjustment) return { ok: false as const, error: 'NOT_FOUND' };
      return { ok: true as const, adjustment };
    });
  } catch (err) {
    console.error('[inventory-adjustment.update]', err);
    return fail(ERROR_CODES.INTERNAL_ERROR, '更新调整单失败', 500);
  }

  if (!result || result.ok === false) {
    const codeMap: Record<string, { code: ErrorCode; msg: string; status: number }> = {
      NOT_FOUND: { code: ERROR_CODES.INVENTORY_ADJUSTMENT_NOT_FOUND, msg: '调整单不存在', status: 404 },
      INVALID_STATE: { code: ERROR_CODES.INVENTORY_ADJUSTMENT_INVALID_STATE, msg: '仅 DRAFT 状态可编辑', status: 409 },
      VERSION_CONFLICT: { code: ERROR_CODES.VERSION_CONFLICT, msg: '版本冲突，请刷新后重试', status: 409 },
      DUPLICATE_LINE: { code: ERROR_CODES.INVENTORY_ADJUSTMENT_DUPLICATE_LINE, msg: '同一调整单内相同五维组合只能出现一次', status: 400 },
      WAREHOUSE_INVALID: { code: ERROR_CODES.INVENTORY_ADJUSTMENT_WAREHOUSE_INVALID, msg: '仓库不存在或已停用', status: 400 },
      LOCATION_INVALID: { code: ERROR_CODES.INVENTORY_ADJUSTMENT_LOCATION_INVALID, msg: '库位不存在或不属于对应仓库', status: 400 },
      ITEM_INVALID: { code: ERROR_CODES.INVENTORY_ADJUSTMENT_ITEM_INVALID, msg: '物料不存在或已停用', status: 400 },
      SOURCE_COUNT_INVALID: { code: ERROR_CODES.INVENTORY_ADJUSTMENT_SOURCE_COUNT_INVALID, msg: '来源盘点单无效或盘点差异行不属于该盘点单（跨单引用拒绝）', status: 400 },
    };
    const entry = result?.ok === false ? codeMap[result.error] : undefined;
    if (entry) return fail(entry.code, entry.msg, entry.status);
    return fail(ERROR_CODES.INTERNAL_ERROR, '更新调整单失败', 500);
  }

  await writeAuditLog({
    actorId,
    action: 'inventory-adjustment:update',
    entityType: 'inventory-adjustment',
    entityId: result.adjustment.id,
    afterData: { adjustmentNo: result.adjustment.adjustmentNo, status: result.adjustment.status, version: result.adjustment.version },
    meta,
  });

  return ok({ adjustment: result.adjustment });
}
