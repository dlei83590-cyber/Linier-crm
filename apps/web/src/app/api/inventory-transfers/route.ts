import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation, parsePagination } from '@/lib/api/response';
import { ERROR_CODES, type ErrorCode } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { inventoryTransferCreateSchema } from '@/lib/api/schemas';
import { nextTransferNo, transferLineDedupeKey } from '@/lib/inventory-transfer/helpers';

export const dynamic = 'force-dynamic';

/** GET /api/inventory-transfers（分页 + transferNo/sourceWarehouseId/destinationWarehouseId/status 过滤 + createdAt desc） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'inventory-transfer:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'inventory-transfer.list');

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const transferNo = searchParams.get('transferNo')?.trim();
  const sourceWarehouseId = searchParams.get('sourceWarehouseId')?.trim();
  const destinationWarehouseId = searchParams.get('destinationWarehouseId')?.trim();
  const status = searchParams.get('status')?.trim();

  const where = {
    deletedAt: null,
    ...(transferNo ? { transferNo: { contains: transferNo, mode: 'insensitive' as const } } : {}),
    ...(sourceWarehouseId ? { sourceWarehouseId } : {}),
    ...(destinationWarehouseId ? { destinationWarehouseId } : {}),
    ...(status ? { status: status as never } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.inventoryTransfer.count({ where }),
    prisma.inventoryTransfer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        sourceWarehouse: { select: { id: true, code: true, name: true } },
        destinationWarehouse: { select: { id: true, code: true, name: true } },
        _count: { select: { lines: true } },
      },
    }),
  ]);

  return ok({ total, page, pageSize, items });
}

/**
 * POST /api/inventory-transfers —— 创建调拨单（DRAFT；**创建即取号 TRF**；DRAFT 不发领域事件）
 * CTO 6B-2 Transfer Vertical Slice 规则：
 * - source/destination warehouse 必须有效（isActive）；location 若提供必须属于对应 warehouse（组合 FK）；
 * - **自调拨防护**：同仓同库位（含都 NULL）→ 拒绝（五维全等无实际转移）；
 * - 至少一条有效 Line；quantity > 0；行去重（itemId+batchNo+serialNos 组合）；
 * - serial-managed 守恒：quantity 必须 = serialNos.length 且整数（Execute 时最终校验）；
 * - transferType 由 service 推导：sourceWarehouseId === destinationWarehouseId ? INTRA_WAREHOUSE : INTER_WAREHOUSE
 *   （P3 Final：跨仓/同仓统一模型，不信任客户端传值）；
 * - **红线：DRAFT 不落账**（不创建 InventoryMovement / 不更新 StockProjection——6A 唯一事实源；
 *   只有 EXECUTE 才经共享 LedgerCommand 双 atom 落账）。
 */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'inventory-transfer:create');
  if (denied) return denied;
  requestLog(request, user?.id, 'inventory-transfer.create');

  const parsed = inventoryTransferCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const data = parsed.data;
  const meta = requestMeta(request);
  const actorId = user!.id;

  // ① 行去重（同一调拨单内 itemId+batchNo+serialNos 组合只能出现一次，防重复调拨同一维度）
  const dedupeKeys = data.lines.map((l) =>
    transferLineDedupeKey({ itemId: l.itemId, batchNo: l.batchNo ?? null, serialNos: l.serialNos }),
  );
  if (new Set(dedupeKeys).size !== dedupeKeys.length) {
    return fail(ERROR_CODES.INVENTORY_TRANSFER_DUPLICATE_LINE, '同一调拨单内相同物料/批次/序列号组合只能出现一次', 400);
  }

  let result:
    | { ok: true; transfer: NonNullable<Awaited<ReturnType<typeof prisma.inventoryTransfer.findFirst>>> }
    | { ok: false; error: string }
    | undefined;

  try {
    result = await prisma.$transaction(async (tx) => {
      // ② warehouse 校验（源/目标必须存在且 isActive）
      const [sourceWh, destWh] = await Promise.all([
        tx.warehouse.findFirst({ where: { id: data.sourceWarehouseId, deletedAt: null } }),
        tx.warehouse.findFirst({ where: { id: data.destinationWarehouseId, deletedAt: null } }),
      ]);
      if (!sourceWh) return { ok: false as const, error: 'SOURCE_WAREHOUSE_INVALID' };
      if (!destWh) return { ok: false as const, error: 'DESTINATION_WAREHOUSE_INVALID' };

      // ③ location 组合 FK 校验（若提供必须属于对应 warehouse）
      if (data.sourceLocationId) {
        const loc = await tx.warehouseLocation.findFirst({
          where: { id: data.sourceLocationId, warehouseId: data.sourceWarehouseId, deletedAt: null },
        });
        if (!loc) return { ok: false as const, error: 'SOURCE_LOCATION_INVALID' };
      }
      if (data.destinationLocationId) {
        const loc = await tx.warehouseLocation.findFirst({
          where: { id: data.destinationLocationId, warehouseId: data.destinationWarehouseId, deletedAt: null },
        });
        if (!loc) return { ok: false as const, error: 'DESTINATION_LOCATION_INVALID' };
      }

      // ④ 自调拨防护：同仓且同库位（含都 NULL）→ 拒绝（五维全等无实际转移）
      if (
        data.sourceWarehouseId === data.destinationWarehouseId &&
        (data.sourceLocationId ?? null) === (data.destinationLocationId ?? null)
      ) {
        return { ok: false as const, error: 'SELF_TRANSFER' };
      }

      // ⑤ item 校验 + serial 守恒（quantity == serialNos.length 且整数）
      for (const l of data.lines) {
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

      // ⑥ 创建（创建即取号 TRF；transferType 服务端推导）
      const transferNo = await nextTransferNo(tx);
      const transferType =
        data.sourceWarehouseId === data.destinationWarehouseId ? 'INTRA_WAREHOUSE' : 'INTER_WAREHOUSE';
      const transfer = await tx.inventoryTransfer.create({
        data: {
          transferNo,
          status: 'DRAFT',
          transferType,
          sourceWarehouseId: data.sourceWarehouseId,
          sourceLocationId: data.sourceLocationId ?? null,
          destinationWarehouseId: data.destinationWarehouseId,
          destinationLocationId: data.destinationLocationId ?? null,
          remark: data.remark ?? null,
          createdById: actorId,
          updatedById: actorId,
          lines: {
            create: data.lines.map((l) => ({
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
            })),
          },
        },
        include: {
          sourceWarehouse: { select: { id: true, code: true, name: true } },
          destinationWarehouse: { select: { id: true, code: true, name: true } },
          lines: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
        },
      });
      return { ok: true as const, transfer };
    });
  } catch (err) {
    console.error('[inventory-transfer.create]', err);
    return fail(ERROR_CODES.INTERNAL_ERROR, '创建调拨单失败', 500);
  }

  if (!result || result.ok === false) {
    const codeMap: Record<string, { code: ErrorCode; msg: string }> = {
      SOURCE_WAREHOUSE_INVALID: { code: ERROR_CODES.INVENTORY_TRANSFER_WAREHOUSE_INVALID, msg: '源仓库不存在或已停用' },
      DESTINATION_WAREHOUSE_INVALID: { code: ERROR_CODES.INVENTORY_TRANSFER_WAREHOUSE_INVALID, msg: '目标仓库不存在或已停用' },
      SOURCE_LOCATION_INVALID: { code: ERROR_CODES.INVENTORY_TRANSFER_LOCATION_INVALID, msg: '源库位不存在或不属于源仓库' },
      DESTINATION_LOCATION_INVALID: { code: ERROR_CODES.INVENTORY_TRANSFER_LOCATION_INVALID, msg: '目标库位不存在或不属于目标仓库' },
      SELF_TRANSFER: { code: ERROR_CODES.INVENTORY_TRANSFER_SELF_TRANSFER, msg: '不能向同一仓库同一库位调拨（五维全等无实际转移）' },
      ITEM_NOT_FOUND: { code: ERROR_CODES.INVENTORY_TRANSFER_ITEM_INVALID, msg: '物料不存在或已停用' },
      SERIAL_QTY_MISMATCH: { code: ERROR_CODES.INVENTORY_TRANSFER_SERIAL_QTY_MISMATCH, msg: 'serial 数量必须 = quantity 且为整数' },
      SERIAL_DUPLICATE: { code: ERROR_CODES.INVENTORY_TRANSFER_SERIAL_DUPLICATE, msg: '序列号列表内存在重复 serial' },
    };
    const entry = result?.ok === false ? codeMap[result.error] : undefined;
    if (entry) return fail(entry.code, entry.msg, 400);
    return fail(ERROR_CODES.INTERNAL_ERROR, '创建调拨单失败', 500);
  }

  await writeAuditLog({
    actorId,
    action: 'inventory-transfer:create',
    entityType: 'inventory-transfer',
    entityId: result.transfer.id,
    afterData: { transferNo: result.transfer.transferNo, status: result.transfer.status },
    meta,
  });

  return ok({ transfer: result.transfer }, undefined, 201);
}
