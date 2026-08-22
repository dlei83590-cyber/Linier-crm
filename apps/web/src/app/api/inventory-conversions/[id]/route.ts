import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation, failConflict, failNotFound } from '@/lib/api/response';
import { ERROR_CODES, type ErrorCode } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { inventoryConversionUpdateSchema } from '@/lib/api/schemas';
import { computeBaseQuantity, conversionLineDedupeKey } from '@/lib/inventory-conversion/helpers';

export const dynamic = 'force-dynamic';

/** GET /api/inventory-conversions/:id（详情：Header + Item + BaseUom + Lines(CONSUME/PRODUCE 行级换算)） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'inventory-conversion:view');
  if (denied) return denied;
  requestLog(request, user?.id, 'inventory-conversion.get');

  const { id } = await params;
  const conversion = await prisma.inventoryConversion.findFirst({
    where: { id, deletedAt: null },
    include: {
      item: { select: { id: true, code: true, name: true, model: true, stockUomId: true } },
      baseUom: { select: { id: true, code: true, symbol: true } },
      executedBy: { select: { id: true, name: true, email: true } },
      lines: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
        include: {
          uom: { select: { id: true, code: true, symbol: true } },
          warehouse: { select: { id: true, code: true, name: true } },
          location: { select: { id: true, code: true, name: true } },
        },
      },
    },
  });
  if (!conversion) return failNotFound(ERROR_CODES.INVENTORY_CONVERSION_NOT_FOUND, '转换单不存在');

  return ok(conversion);
}

/**
 * PATCH /api/inventory-conversions/:id（更新头 + 行整体替换；**仅 DRAFT**；CAS `id + version + status=DRAFT`）
 * CTO 6B-4 规则：
 * - 仅 DRAFT 可编辑（INVALID_STATE）；CAS version 乐观锁（VERSION_CONFLICT）；
 * - itemId / baseUomId 不可编辑（首版 same item + baseUom 由创建时锁定）；remark/lines 可改；
 * - 行整体替换：重新校验 lineRole 集合（恰好 1 CONSUME + 1 PRODUCE）+ warehouse/location 组合 FK +
 *   uom 校验 + batch 精确继承；**baseQuantity 服务端重新 canonical 计算**（不信任客户端）；
 * - **红线：DRAFT 变更不发领域事件**（仅 AuditLog）；DRAFT 不落账。
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'inventory-conversion:edit');
  if (denied) return denied;
  requestLog(request, user?.id, 'inventory-conversion.update');

  const { id } = await params;
  const parsed = inventoryConversionUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version, lines, ...fields } = parsed.data;
  const meta = requestMeta(request);
  const actorId = user!.id;

  const existing = await prisma.inventoryConversion.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, status: true, version: true, itemId: true, baseUomId: true },
  });
  if (!existing) return failNotFound(ERROR_CODES.INVENTORY_CONVERSION_NOT_FOUND, '转换单不存在');
  if (existing.status !== 'DRAFT') {
    return failConflict(
      ERROR_CODES.INVENTORY_CONVERSION_INVALID_STATE,
      `仅 DRAFT 状态可编辑（当前 ${existing.status}）；已提交/已执行的转换事实不可修改`,
    );
  }
  if (existing.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, '版本冲突，请刷新后重试');
  }

  let result:
    | { ok: true; conversion: NonNullable<Awaited<ReturnType<typeof prisma.inventoryConversion.findFirst>>> }
    | { ok: false; error: string }
    | undefined;

  try {
    result = await prisma.$transaction(async (tx) => {
      // ① 重新读（事务内）+ CAS 锁
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "InventoryConversion" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
      );
      if (locked.length === 0) return { ok: false as const, error: 'NOT_FOUND' };

      const cur = await tx.inventoryConversion.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, status: true, version: true, itemId: true, baseUomId: true },
      });
      if (!cur) return { ok: false as const, error: 'NOT_FOUND' };
      if (cur.status !== 'DRAFT') return { ok: false as const, error: 'INVALID_STATE' };
      if (cur.version !== version) return { ok: false as const, error: 'VERSION_CONFLICT' };

      // ② 行处理（lines 提供 → 全量替换）
      let lineCreate: Array<Prisma.InventoryConversionLineCreateManyInput> | undefined;
      if (lines) {
        // 行角色集合：恰好 1 CONSUME + 1 PRODUCE
        const roles = lines.map((l) => conversionLineDedupeKey({ lineRole: l.lineRole }));
        if (new Set(roles).size !== 2 || !roles.includes('CONSUME') || !roles.includes('PRODUCE')) {
          return { ok: false as const, error: 'LINE_ROLE_REQUIRED' };
        }
        // 每行校验
        for (const l of lines) {
          const wh = await tx.warehouse.findFirst({ where: { id: l.warehouseId, deletedAt: null } });
          if (!wh) return { ok: false as const, error: 'WAREHOUSE_INVALID' };
          if (l.locationId) {
            const loc = await tx.warehouseLocation.findFirst({
              where: { id: l.locationId, warehouseId: l.warehouseId, deletedAt: null },
            });
            if (!loc) return { ok: false as const, error: 'LOCATION_INVALID' };
          }
          const uom = await tx.unitOfMeasure.findFirst({ where: { id: l.uomId, deletedAt: null } });
          if (!uom) return { ok: false as const, error: 'UOM_INVALID' };
          if (l.quantity <= 0) return { ok: false as const, error: 'QUANTITY_INVALID' };
          if (l.uomToBaseRate <= 0) return { ok: false as const, error: 'RATE_INVALID' };
        }
        // batch 精确继承
        const consume = lines.find((l) => l.lineRole === 'CONSUME')!;
        const produce = lines.find((l) => l.lineRole === 'PRODUCE')!;
        if ((consume.batchNo ?? null) !== (produce.batchNo ?? null)) {
          return { ok: false as const, error: 'BATCH_MISMATCH' };
        }
        // baseQuantity 服务端 canonical 计算（不信任客户端）
        lineCreate = lines.map((l) => ({
          conversionHeaderId: id,
          lineRole: l.lineRole,
          quantity: l.quantity,
          uomId: l.uomId,
          uomToBaseRate: l.uomToBaseRate,
          baseQuantity: computeBaseQuantity(new Prisma.Decimal(l.quantity), new Prisma.Decimal(l.uomToBaseRate)),
          warehouseId: l.warehouseId,
          locationId: l.locationId ?? null,
          batchNo: l.batchNo ?? null,
          remark: l.remark ?? null,
          createdById: actorId,
          updatedById: actorId,
        }));
      }

      // ③ CAS 更新（id + version + status=DRAFT 同时命中；itemId/baseUomId 不可编辑）
      const cas = await tx.inventoryConversion.updateMany({
        where: { id, version, status: 'DRAFT', deletedAt: null },
        data: {
          ...(fields.remark !== undefined ? { remark: fields.remark } : {}),
          updatedById: actorId,
          version: { increment: 1 },
        },
      });
      if (cas.count !== 1) return { ok: false as const, error: 'VERSION_CONFLICT' };

      // 行全量替换（仅 DRAFT；CASCADE 删除旧行）
      if (lineCreate) {
        await tx.inventoryConversionLine.deleteMany({ where: { conversionHeaderId: id, deletedAt: null } });
        await tx.inventoryConversionLine.createMany({
          data: lineCreate,
        });
      }

      const conversion = await tx.inventoryConversion.findFirst({
        where: { id, deletedAt: null },
        include: {
          item: { select: { id: true, code: true, name: true, model: true } },
          baseUom: { select: { id: true, code: true, symbol: true } },
          lines: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
        },
      });
      if (!conversion) return { ok: false as const, error: 'NOT_FOUND' };
      return { ok: true as const, conversion };
    });
  } catch (err) {
    console.error('[inventory-conversion.update]', err);
    return fail(ERROR_CODES.INTERNAL_ERROR, '更新转换单失败', 500);
  }

  if (!result || result.ok === false) {
    const codeMap: Record<string, { code: ErrorCode; msg: string; status: number }> = {
      NOT_FOUND: { code: ERROR_CODES.INVENTORY_CONVERSION_NOT_FOUND, msg: '转换单不存在', status: 404 },
      INVALID_STATE: { code: ERROR_CODES.INVENTORY_CONVERSION_INVALID_STATE, msg: '仅 DRAFT 状态可编辑', status: 409 },
      VERSION_CONFLICT: { code: ERROR_CODES.VERSION_CONFLICT, msg: '版本冲突，请刷新后重试', status: 409 },
      LINE_ROLE_REQUIRED: { code: ERROR_CODES.INVENTORY_CONVERSION_LINE_ROLE_REQUIRED, msg: '必须恰好 1 条 CONSUME + 1 条 PRODUCE（单输入单输出）', status: 400 },
      WAREHOUSE_INVALID: { code: ERROR_CODES.INVENTORY_CONVERSION_WAREHOUSE_INVALID, msg: '仓库不存在或已停用', status: 400 },
      LOCATION_INVALID: { code: ERROR_CODES.INVENTORY_CONVERSION_LOCATION_INVALID, msg: '库位不存在或不属于对应仓库', status: 400 },
      UOM_INVALID: { code: ERROR_CODES.INVENTORY_CONVERSION_UOM_INVALID, msg: '业务 UOM 不存在或已停用', status: 400 },
      QUANTITY_INVALID: { code: ERROR_CODES.INVENTORY_CONVERSION_INVALID_STATE, msg: '转换数量必须 > 0', status: 400 },
      RATE_INVALID: { code: ERROR_CODES.INVENTORY_CONVERSION_RATE_INVALID, msg: 'uomToBaseRate 必须 > 0', status: 400 },
      BATCH_MISMATCH: { code: ERROR_CODES.INVENTORY_CONVERSION_BATCH_MISMATCH, msg: 'CONSUME 与 PRODUCE 的 batchNo 必须一致（P5 精确继承，首版不拆批不换批）', status: 400 },
    };
    const entry = result?.ok === false ? codeMap[result.error] : undefined;
    if (entry) return fail(entry.code, entry.msg, entry.status);
    return fail(ERROR_CODES.INTERNAL_ERROR, '更新转换单失败', 500);
  }

  await writeAuditLog({
    actorId,
    action: 'inventory-conversion:update',
    entityType: 'inventory-conversion',
    entityId: result.conversion.id,
    afterData: { conversionNo: result.conversion.conversionNo, status: result.conversion.status, version: result.conversion.version },
    meta,
  });

  return ok({ conversion: result.conversion });
}
/** DELETE /api/inventory-conversions/:id（层层回退-层层可删除，用户指令 2026-08-21）
 * 可删状态：DRAFT/CANCELLED；SUBMITTED/EXECUTED 禁止（已执行转换）。
 * 软删 header + lines。
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "inventory-conversion:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "inventory-conversion.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const existing = await prisma.inventoryConversion.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.INVENTORY_CONVERSION_NOT_FOUND, "库存转换单不存在");
  if (!["DRAFT", "CANCELLED"].includes(existing.status)) {
    return failConflict(ERROR_CODES.INVENTORY_CONVERSION_INVALID_STATE, "仅 DRAFT/CANCELLED 状态可删除（已执行转换禁止删除）");
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.inventoryConversion.update({ where: { id }, data: { deletedAt: now, isActive: false, updatedById: user!.id } });
    await tx.inventoryConversionLine.updateMany({ where: { conversionHeaderId: id, deletedAt: null }, data: { deletedAt: now, isActive: false } });
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "inventory-conversion.delete",
    entityType: "inventory-conversion",
    entityId: id,
    afterData: { conversionNo: existing.conversionNo },
    ...meta,
  });

  return ok({ id, deleted: true });
}

