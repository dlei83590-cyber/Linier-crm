import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation, failConflict, failNotFound } from '@/lib/api/response';
import { ERROR_CODES, type ErrorCode } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { inventoryTransferUpdateSchema } from '@/lib/api/schemas';
import { transferLineDedupeKey } from '@/lib/inventory-transfer/helpers';

export const dynamic = 'force-dynamic';

/** GET /api/inventory-transfers/:id（详情：Header + 源/目标仓库库位 + Lines(Item/UOM) + 审批/执行人） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'inventory-transfer:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'inventory-transfer.get');

  const { id } = await params;
  const transfer = await prisma.inventoryTransfer.findFirst({
    where: { id, deletedAt: null },
    include: {
      sourceWarehouse: { select: { id: true, code: true, name: true } },
      sourceLocation: { select: { id: true, code: true, name: true } },
      destinationWarehouse: { select: { id: true, code: true, name: true } },
      destinationLocation: { select: { id: true, code: true, name: true } },
      approvedBy: { select: { id: true, name: true, email: true } },
      executedBy: { select: { id: true, name: true, email: true } },
      lines: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
        include: {
          item: { select: { id: true, code: true, name: true, model: true } },
          uom: { select: { id: true, code: true, symbol: true } },
        },
      },
    },
  });
  if (!transfer) return failNotFound(ERROR_CODES.INVENTORY_TRANSFER_NOT_FOUND, '调拨单不存在');

  return ok(transfer);
}

/**
 * PATCH /api/inventory-transfers/:id（更新头 + 可选行全量替换；**仅 DRAFT**；CAS `id + version + status=DRAFT`）
 * CTO 6B-2 Transfer Vertical Slice 规则：
 * - 仅 DRAFT 可编辑（INVALID_STATE）；CAS version 乐观锁（VERSION_CONFLICT）；
 * - source/destination warehouse/location 重新校验（组合 FK 同属）；
 * - **自调拨防护**：同仓同库位（含都 NULL）→ 拒绝；
 * - 行全量替换：行去重 + item 校验 + serial 守恒；
 * - transferType 由 service 重新推导（源/目标 warehouse 关系）；
 * - **DRAFT 变更不发领域事件**（仅 AuditLog）；红线 DRAFT 不落账。
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'inventory-transfer:edit');
  if (denied) return denied;
  requestLog(request, user?.id, 'inventory-transfer.update');

  const { id } = await params;
  const parsed = inventoryTransferUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version, lines, ...fields } = parsed.data;
  const meta = requestMeta(request);
  const actorId = user!.id;

  const existing = await prisma.inventoryTransfer.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, status: true, version: true },
  });
  if (!existing) return failNotFound(ERROR_CODES.INVENTORY_TRANSFER_NOT_FOUND, '调拨单不存在');
  if (existing.status !== 'DRAFT') {
    return failConflict(
      ERROR_CODES.INVENTORY_TRANSFER_INVALID_STATE,
      `仅 DRAFT 状态可编辑（当前 ${existing.status}）；已提交/已执行的调拨事实不可修改`,
    );
  }
  if (existing.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, '版本冲突，请刷新后重试');
  }

  let result:
    | { ok: true; transfer: NonNullable<Awaited<ReturnType<typeof prisma.inventoryTransfer.findFirst>>> }
    | { ok: false; error: string }
    | undefined;

  try {
    result = await prisma.$transaction(async (tx) => {
      // ① 重新读（事务内）+ CAS 锁
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "InventoryTransfer" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
      );
      if (locked.length === 0) return { ok: false as const, error: 'NOT_FOUND' };

      const cur = await tx.inventoryTransfer.findFirst({
        where: { id, deletedAt: null },
        select: { status: true, version: true },
      });
      if (!cur) return { ok: false as const, error: 'NOT_FOUND' };
      if (cur.status !== 'DRAFT') return { ok: false as const, error: 'INVALID_STATE' };
      if (cur.version !== version) return { ok: false as const, error: 'VERSION_CONFLICT' };

      // ② effective 值（只改部分字段时保留原值）
      const srcWhId = fields.sourceWarehouseId ?? (await tx.inventoryTransfer.findUniqueOrThrow({ where: { id } })).sourceWarehouseId;
      const srcLocId = fields.sourceLocationId !== undefined ? fields.sourceLocationId : (await tx.inventoryTransfer.findUniqueOrThrow({ where: { id } })).sourceLocationId;
      const dstWhId = fields.destinationWarehouseId ?? (await tx.inventoryTransfer.findUniqueOrThrow({ where: { id } })).destinationWarehouseId;
      const dstLocId = fields.destinationLocationId !== undefined ? fields.destinationLocationId : (await tx.inventoryTransfer.findUniqueOrThrow({ where: { id } })).destinationLocationId;

      // ③ warehouse / location 组合 FK 校验
      const [sourceWh, destWh] = await Promise.all([
        tx.warehouse.findFirst({ where: { id: srcWhId, deletedAt: null } }),
        tx.warehouse.findFirst({ where: { id: dstWhId, deletedAt: null } }),
      ]);
      if (!sourceWh) return { ok: false as const, error: 'SOURCE_WAREHOUSE_INVALID' };
      if (!destWh) return { ok: false as const, error: 'DESTINATION_WAREHOUSE_INVALID' };
      if (srcLocId) {
        const loc = await tx.warehouseLocation.findFirst({ where: { id: srcLocId, warehouseId: srcWhId, deletedAt: null } });
        if (!loc) return { ok: false as const, error: 'SOURCE_LOCATION_INVALID' };
      }
      if (dstLocId) {
        const loc = await tx.warehouseLocation.findFirst({ where: { id: dstLocId, warehouseId: dstWhId, deletedAt: null } });
        if (!loc) return { ok: false as const, error: 'DESTINATION_LOCATION_INVALID' };
      }

      // ④ 自调拨防护
      if (srcWhId === dstWhId && (srcLocId ?? null) === (dstLocId ?? null)) {
        return { ok: false as const, error: 'SELF_TRANSFER' };
      }

      // ⑤ 行处理（lines 提供 → 全量替换）
      let lineCreate: Array<Prisma.InventoryTransferLineCreateManyInput> | undefined;
      if (lines) {
        const dedupeKeys = lines.map((l) => transferLineDedupeKey({ itemId: l.itemId, batchNo: l.batchNo ?? null, serialNos: l.serialNos }));
        if (new Set(dedupeKeys).size !== dedupeKeys.length) {
          return { ok: false as const, error: 'DUPLICATE_LINE' };
        }
        for (const l of lines) {
          const item = await tx.item.findFirst({ where: { id: l.itemId, deletedAt: null } });
          if (!item) return { ok: false as const, error: 'ITEM_NOT_FOUND' };
          if (l.serialNos.length > 0) {
            // zod quantity 是 number（非 Prisma.Decimal）——用 Number.isInteger + 直接比较
            if (!Number.isInteger(l.quantity)) return { ok: false as const, error: 'SERIAL_QTY_MISMATCH' };
            if (l.quantity !== l.serialNos.length) {
              return { ok: false as const, error: 'SERIAL_QTY_MISMATCH' };
            }
            if (new Set(l.serialNos).size !== l.serialNos.length) {
              return { ok: false as const, error: 'SERIAL_DUPLICATE' };
            }
          }
        }
        lineCreate = lines.map((l) => ({
          transferHeaderId: id,
          itemId: l.itemId,
          uomId: l.uomId ?? null,
          quantity: l.quantity,
          batchNo: l.batchNo ?? null,
          serialNos: l.serialNos,
          mfgDate: l.mfgDate ?? null,
          expDate: l.expDate ?? null,
          remark: l.remark ?? null,
          createdById: actorId,
          updatedById: actorId,
        }));
      }

      // ⑥ CAS 更新（id + version + status=DRAFT 同时命中）
      const transferType = srcWhId === dstWhId ? 'INTRA_WAREHOUSE' : 'INTER_WAREHOUSE';
      const cas = await tx.inventoryTransfer.updateMany({
        where: { id, version, status: 'DRAFT', deletedAt: null },
        data: {
          transferType,
          ...(fields.sourceWarehouseId !== undefined ? { sourceWarehouseId: fields.sourceWarehouseId } : {}),
          ...(fields.sourceLocationId !== undefined ? { sourceLocationId: fields.sourceLocationId } : {}),
          ...(fields.destinationWarehouseId !== undefined ? { destinationWarehouseId: fields.destinationWarehouseId } : {}),
          ...(fields.destinationLocationId !== undefined ? { destinationLocationId: fields.destinationLocationId } : {}),
          ...(fields.remark !== undefined ? { remark: fields.remark } : {}),
          updatedById: actorId,
          version: { increment: 1 },
        },
      });
      if (cas.count !== 1) return { ok: false as const, error: 'VERSION_CONFLICT' };

      // 行全量替换（仅 DRAFT；CASCADE 删除旧行）
      if (lineCreate) {
        await tx.inventoryTransferLine.deleteMany({ where: { transferHeaderId: id, deletedAt: null } });
        await tx.inventoryTransferLine.createMany({
          data: lineCreate,
        });
      }

      const transfer = await tx.inventoryTransfer.findFirst({
        where: { id, deletedAt: null },
        include: {
          sourceWarehouse: { select: { id: true, code: true, name: true } },
          destinationWarehouse: { select: { id: true, code: true, name: true } },
          lines: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
        },
      });
      if (!transfer) return { ok: false as const, error: 'NOT_FOUND' };
      return { ok: true as const, transfer };
    });
  } catch (err) {
    console.error('[inventory-transfer.update]', err);
    return fail(ERROR_CODES.INTERNAL_ERROR, '更新调拨单失败', 500);
  }

  if (!result || result.ok === false) {
    const codeMap: Record<string, { code: ErrorCode; msg: string; status: number }> = {
      NOT_FOUND: { code: ERROR_CODES.INVENTORY_TRANSFER_NOT_FOUND, msg: '调拨单不存在', status: 404 },
      INVALID_STATE: { code: ERROR_CODES.INVENTORY_TRANSFER_INVALID_STATE, msg: '仅 DRAFT 状态可编辑', status: 409 },
      VERSION_CONFLICT: { code: ERROR_CODES.VERSION_CONFLICT, msg: '版本冲突，请刷新后重试', status: 409 },
      SOURCE_WAREHOUSE_INVALID: { code: ERROR_CODES.INVENTORY_TRANSFER_WAREHOUSE_INVALID, msg: '源仓库不存在或已停用', status: 400 },
      DESTINATION_WAREHOUSE_INVALID: { code: ERROR_CODES.INVENTORY_TRANSFER_WAREHOUSE_INVALID, msg: '目标仓库不存在或已停用', status: 400 },
      SOURCE_LOCATION_INVALID: { code: ERROR_CODES.INVENTORY_TRANSFER_LOCATION_INVALID, msg: '源库位不存在或不属于源仓库', status: 400 },
      DESTINATION_LOCATION_INVALID: { code: ERROR_CODES.INVENTORY_TRANSFER_LOCATION_INVALID, msg: '目标库位不存在或不属于目标仓库', status: 400 },
      SELF_TRANSFER: { code: ERROR_CODES.INVENTORY_TRANSFER_SELF_TRANSFER, msg: '不能向同一仓库同一库位调拨（五维全等无实际转移）', status: 409 },
      DUPLICATE_LINE: { code: ERROR_CODES.INVENTORY_TRANSFER_DUPLICATE_LINE, msg: '同一调拨单内相同物料/批次/序列号组合只能出现一次', status: 400 },
      ITEM_NOT_FOUND: { code: ERROR_CODES.INVENTORY_TRANSFER_ITEM_INVALID, msg: '物料不存在或已停用', status: 400 },
      SERIAL_QTY_MISMATCH: { code: ERROR_CODES.INVENTORY_TRANSFER_SERIAL_QTY_MISMATCH, msg: 'serial 数量必须 = quantity 且为整数', status: 400 },
      SERIAL_DUPLICATE: { code: ERROR_CODES.INVENTORY_TRANSFER_SERIAL_DUPLICATE, msg: '序列号列表内存在重复 serial', status: 400 },
    };
    const entry = result?.ok === false ? codeMap[result.error] : undefined;
    if (entry) return fail(entry.code, entry.msg, entry.status);
    return fail(ERROR_CODES.INTERNAL_ERROR, '更新调拨单失败', 500);
  }

  await writeAuditLog({
    actorId,
    action: 'inventory-transfer:update',
    entityType: 'inventory-transfer',
    entityId: result.transfer.id,
    afterData: { transferNo: result.transfer.transferNo, status: result.transfer.status, version: result.transfer.version },
    meta,
  });

  return ok({ transfer: result.transfer });
}
/** DELETE /api/inventory-transfers/:id（层层回退-层层可删除，用户指令 2026-08-21）
 * 可删状态：DRAFT/CANCELLED；EXECUTED 禁止（已产生库存双边 Movement）。
 * 防御：movementGroupId 非空（已执行）禁止删除。软删 header + lines。
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "inventory-transfer:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "inventory-transfer.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const existing = await prisma.inventoryTransfer.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.INVENTORY_TRANSFER_NOT_FOUND, "调拨单不存在");
  if (!["DRAFT", "CANCELLED"].includes(existing.status)) {
    return failConflict(ERROR_CODES.INVENTORY_TRANSFER_INVALID_STATE, "仅 DRAFT/CANCELLED 状态可删除（已执行调拨禁止删除）");
  }
  if (existing.movementGroupId) {
    return failConflict(ERROR_CODES.INVENTORY_TRANSFER_INVALID_STATE, "调拨单已执行（已产生库存移动），禁止删除");
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.inventoryTransfer.update({ where: { id }, data: { deletedAt: now, isActive: false, updatedById: user!.id } });
    await tx.inventoryTransferLine.updateMany({ where: { transferHeaderId: id, deletedAt: null }, data: { deletedAt: now, isActive: false } });
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "inventory-transfer.delete",
    entityType: "inventory-transfer",
    entityId: id,
    afterData: { transferNo: existing.transferNo },
    ...meta,
  });

  return ok({ id, deleted: true });
}

