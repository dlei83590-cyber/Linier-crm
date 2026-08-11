import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation } from '@/lib/api/response';
import { ERROR_CODES, type ErrorCode } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { inventoryConversionExecuteSchema } from '@/lib/api/schemas';
import { buildConversionAtoms, computeBaseQuantity } from '@/lib/inventory-conversion/helpers';
import { publishInventoryConversionEvent } from '@/lib/inventory-conversion/events';
import {
  executeLedgerAtoms,
  InventoryInsufficientStockError,
  InventoryLedgerIdempotencyConflictError,
} from '@/lib/inventory-ledger/ledger-command';

export const dynamic = 'force-dynamic';

/**
 * POST /api/inventory-conversions/:id/execute —— **SUBMITTED → EXECUTED（CTO 6B-4 最高风险点）**
 * 四条锁死（CTO #8658）：
 * ① **baseQuantity = quantity × uomToBaseRate 必须由服务端 canonical 计算并按既定 Decimal 精度规则验证**——
 *    不信任客户端提交的 baseQuantity（Create/Update 时已服务端计算；**Execute 时逐行重验 canonical：
 *    stored baseQuantity === ROUND_HALF_UP(quantity × uomToBaseRate, 4)（computeBaseQuantity 服务端重算），
 *    任何一行不符 → fail closed 400 BASE_QTY_INVALID（CTO Conversion Review Blocking ①）**）；
 * ② **CONSUME.baseQuantity == PRODUCE.baseQuantity 才允许 Execute**（守恒，P11 Final）；
 * ③ **首版必须 same item**（header.itemId 单一，行无 itemId——禁止借 Conversion 偷渡 BOM/组装/拆解/多物料）；
 * ④ **Batch 默认精确继承、serial 不允许重新生成**（CONSUME batch → PRODUCE batch 同值；serialNo=null）。
 *
 * 事务顺序（对齐 Transfer/Adjustment）：
 *   FOR UPDATE 锁 InventoryConversion → status 必须 = SUBMITTED（EXECUTED → 409 ALREADY_EXECUTED 幂等拒绝）→
 *   复核执行态事实（恰好 1 CONSUME + 1 PRODUCE / quantity>0 / uomToBaseRate>0 / **逐行 canonical 重验
 *   stored baseQuantity === ROUND_HALF_UP(quantity×rate,4)——Blocking ①** / warehouse+location 组合 FK /
 *   item 有效 / **baseUom==item.stockUom 重验（Blocking ②）** / baseQuantity 守恒 / batch 继承）→
 *   生成/复用非空 movementGroupId（**稳定业务事实**：已有值复用，无值生成一次并冻结——CTO Transfer Blocking ② 教训）→
 *   buildConversionAtoms（CONSUME OUT + PRODUCE IN，同一 movementGroupId）→
 *   executeLedgerAtoms(tx, atoms)（同一 caller tx，全有或全无）→ 全部成功 →
 *   status=EXECUTED + movementGroupId + executedById/executedAt + CAS version+1（同事务）→ AuditLog → COMMIT
 *   → 事务提交后 best-effort 发布 InventoryConversionExecuted。
 *
 * 五元幂等：sourceType=CONVERSION，sourceId=conversion.id，sourceLineId=line.id，
 * movementRole=CONSUME/PRODUCE，movementAtomKey=BULK（首版无 serial）。
 * 红线：**0 直写 InventoryMovement/StockProjection**（只经 executeLedgerAtoms）；Conversion 不发明审批流
 * （状态机 DRAFT/SUBMITTED/EXECUTED/CANCELLED，submit 即确认，execute 才落账）。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  // execute 映射现有动作（execute→:edit，对齐 5B post→:edit / 6B-2 execute→:edit 先例）
  const denied = requirePermission(user, 'inventory-conversion:edit');
  if (denied) return denied;
  requestLog(request, user?.id, 'inventory-conversion.execute');

  const { id } = await params;
  const parsed = inventoryConversionExecuteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version } = parsed.data;
  const meta = requestMeta(request);
  const actorId = user!.id;

  let result:
    | {
        ok: true;
        conversion: NonNullable<Awaited<ReturnType<typeof prisma.inventoryConversion.findFirst>>> & {
          lines: Array<{
            id: string;
            lineRole: 'CONSUME' | 'PRODUCE';
            quantity: Prisma.Decimal;
            uomId: string | null;
            uomToBaseRate: Prisma.Decimal;
            baseQuantity: Prisma.Decimal;
            warehouseId: string;
            locationId: string | null;
            batchNo: string | null;
          }>;
        };
        atomResults: Array<{ inserted: boolean; movementNo: string }>;
      }
    | { ok: false; error: string; status: number; message: string }
    | undefined;

  try {
    result = await prisma.$transaction(async (tx) => {
      // ① FOR UPDATE 锁 InventoryConversion（防并发 Execute / Cancel）
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "InventoryConversion" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
      );
      if (locked.length === 0) {
        return { ok: false as const, error: 'NOT_FOUND', status: 404, message: '转换单不存在' };
      }

      const conversion = await tx.inventoryConversion.findFirst({
        where: { id, deletedAt: null },
        include: {
          lines: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
        },
      });
      if (!conversion) {
        return { ok: false as const, error: 'NOT_FOUND', status: 404, message: '转换单不存在' };
      }

      // ② 状态门禁：仅 SUBMITTED 可 Execute
      if (conversion.status === 'EXECUTED') {
        return {
          ok: false as const,
          error: 'ALREADY_EXECUTED',
          status: 409,
          message: `转换单已执行（movementGroupId=${conversion.movementGroupId ?? '-'}）；重复 Execute 幂等拒绝，请查询详情`,
        };
      }
      if (conversion.status !== 'SUBMITTED') {
        return {
          ok: false as const,
          error: 'INVALID_STATE',
          status: 409,
          message: `仅 SUBMITTED 状态可执行（当前 ${conversion.status}）；提交确认后（SUBMITTED ≠ EXECUTED）才可落账`,
        };
      }
      // CAS version
      if (conversion.version !== version) {
        return { ok: false as const, error: 'VERSION_CONFLICT', status: 409, message: '版本冲突，请刷新后重试' };
      }

      // ③ 执行态事实复核：恰好 1 CONSUME + 1 PRODUCE（DB UNIQUE(conversionHeaderId, lineRole) 兜底）
      if (conversion.lines.length !== 2) {
        return { ok: false as const, error: 'NO_LINES', status: 400, message: '转换单必须恰好包含 1 CONSUME + 1 PRODUCE' };
      }
      const consume = conversion.lines.find((l) => l.lineRole === 'CONSUME');
      const produce = conversion.lines.find((l) => l.lineRole === 'PRODUCE');
      if (!consume || !produce) {
        return { ok: false as const, error: 'LINE_ROLE_REQUIRED', status: 400, message: '必须恰好 1 条 CONSUME + 1 条 PRODUCE（单输入单输出）' };
      }
      // ④ 数量/换算率/canonical 数量 > 0（DB CHECK 兜底）
      if (conversion.lines.some((l) => l.quantity.lte(0) || l.uomToBaseRate.lte(0) || l.baseQuantity.lte(0))) {
        return { ok: false as const, error: 'QUANTITY_INVALID', status: 400, message: '转换数量/换算率/canonical 数量必须 > 0' };
      }
      // ⑤ **逐行 canonical baseQuantity 重验（CTO Conversion Review Blocking ①）**：
      //    stored baseQuantity 必须 == ROUND_HALF_UP(quantity × uomToBaseRate, 4)（computeBaseQuantity 服务端重算）。
      //    仅证明"两边相等"（守恒）不够：错误数据 9 == 9 也守恒，但 canonical 应为 10 仍是错误库存事实 → fail closed。
      for (const l of conversion.lines) {
        const expectedBaseQty = computeBaseQuantity(l.quantity, l.uomToBaseRate);
        if (!l.baseQuantity.equals(expectedBaseQty)) {
          return {
            ok: false as const,
            error: 'BASE_QTY_INVALID',
            status: 400,
            message: `行 ${l.lineRole} stored baseQuantity(${l.baseQuantity}) != canonical 重算值(${expectedBaseQty})（必须 == ROUND_HALF_UP(quantity × uomToBaseRate, 4)）`,
          };
        }
      }
      // ⑥ item 有效 + baseUom == item.stockUom（P11 Final Gate 复核；**Execute 时点重验——CTO Conversion Review Blocking ②**）
      const item = await tx.item.findFirst({ where: { id: conversion.itemId, deletedAt: null } });
      if (!item) return { ok: false as const, error: 'ITEM_INVALID', status: 400, message: '物料不存在或已停用' };
      if (!item.stockUomId || item.stockUomId !== conversion.baseUomId) {
        return { ok: false as const, error: 'BASE_UOM_INVALID', status: 400, message: 'baseUomId 必须 == 该物料的库存单位（stockUomId）' };
      }
      // ⑦ warehouse/location 组合 FK（防御性复核）
      for (const l of conversion.lines) {
        const wh = await tx.warehouse.findFirst({ where: { id: l.warehouseId, deletedAt: null } });
        if (!wh) return { ok: false as const, error: 'WAREHOUSE_INVALID', status: 400, message: '仓库不存在或已停用' };
        if (l.locationId) {
          const loc = await tx.warehouseLocation.findFirst({
            where: { id: l.locationId, warehouseId: l.warehouseId, deletedAt: null },
          });
          if (!loc) return { ok: false as const, error: 'LOCATION_INVALID', status: 400, message: '库位不存在或不属于对应仓库' };
        }
      }
      // ⑧ 守恒（CTO 锁死②）：CONSUME.baseQuantity == PRODUCE.baseQuantity（逐行 canonical 重验通过后才判守恒）
      if (!consume.baseQuantity.equals(produce.baseQuantity)) {
        return {
          ok: false as const,
          error: 'BASE_QTY_MISMATCH',
          status: 400,
          message: `CONSUME.baseQuantity(${consume.baseQuantity}) 必须 == PRODUCE.baseQuantity(${produce.baseQuantity})（守恒，P11）`,
        };
      }
      // ⑨ batch 精确继承（CTO 锁死④）：CONSUME batch → PRODUCE batch 同值；serial 不允许（行无 serialNo 字段）
      if ((consume.batchNo ?? null) !== (produce.batchNo ?? null)) {
        return { ok: false as const, error: 'BATCH_MISMATCH', status: 400, message: 'CONSUME 与 PRODUCE 的 batchNo 必须一致（P5 精确继承，首版不拆批不换批）' };
      }

      // ⑩ movementGroupId：**稳定业务事实**（CTO Transfer Blocking ② 教训沿用）——已有值复用，无值生成一次并冻结；
      //    CONSUME + PRODUCE 共享同一非空 group id（Schema 终态 CHECK 要求 EXECUTED ⇒ group 非空）
      const movementGroupId = conversion.movementGroupId ?? crypto.randomUUID();

      // ⑪ 构造双 atom（CONSUME OUT + PRODUCE IN，同一 movementGroupId；quantity=baseQuantity canonical）
      const atoms = buildConversionAtoms({
        conversion: {
          id: conversion.id,
          conversionNo: conversion.conversionNo,
          itemId: conversion.itemId,
          baseUomId: conversion.baseUomId,
          movementGroupId,
        },
        consumeLine: {
          id: consume.id,
          warehouseId: consume.warehouseId,
          locationId: consume.locationId,
          batchNo: consume.batchNo,
          baseQuantity: consume.baseQuantity,
        },
        produceLine: {
          id: produce.id,
          warehouseId: produce.warehouseId,
          locationId: produce.locationId,
          batchNo: produce.batchNo,
          baseQuantity: produce.baseQuantity,
        },
        actorId,
        occurredAt: new Date().toISOString(),
      });

      // ⑫ Shared Core 双 atom 同事务执行（**全有或全无**——任一失败抛错 → 整事务回滚，Conversion 保持 SUBMITTED）
      const results = await executeLedgerAtoms(tx, atoms);

      // ⑬ 全部成功 → 单据 EXECUTED + 证据（同一事务；CAS version+1；终态证据 CHECK 全非空）
      const executedAt = new Date();
      const cas = await tx.inventoryConversion.updateMany({
        where: { id, version, status: 'SUBMITTED', deletedAt: null },
        data: {
          status: 'EXECUTED',
          movementGroupId,
          executedById: actorId,
          executedAt,
          updatedById: actorId,
          version: { increment: 1 },
        },
      });
      if (cas.count !== 1) {
        return { ok: false as const, error: 'VERSION_CONFLICT', status: 409, message: '版本冲突或状态已变化，请刷新后重试' };
      }

      const finalConversion = await tx.inventoryConversion.findFirstOrThrow({
        where: { id, deletedAt: null },
        include: {
          item: { select: { id: true, code: true, name: true, model: true } },
          baseUom: { select: { id: true, code: true, symbol: true } },
          executedBy: { select: { id: true, name: true, email: true } },
          lines: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
        },
      });
      return {
        ok: true as const,
        conversion: finalConversion as typeof finalConversion & {
          lines: Array<{
            id: string;
            lineRole: 'CONSUME' | 'PRODUCE';
            quantity: Prisma.Decimal;
            uomId: string | null;
            uomToBaseRate: Prisma.Decimal;
            baseQuantity: Prisma.Decimal;
            warehouseId: string;
            locationId: string | null;
            batchNo: string | null;
          }>;
        },
        atomResults: results.map((r) => ({ inserted: r.inserted, movementNo: r.movementNo })),
      };
    });
  } catch (err) {
    // 业务失败（源库存不足 / 幂等 immutable-fact conflict）→ 409；技术失败 → 500
    if (err instanceof InventoryInsufficientStockError) {
      return fail(ERROR_CODES.INVENTORY_INSUFFICIENT_STOCK, err.message, 409);
    }
    if (err instanceof InventoryLedgerIdempotencyConflictError) {
      return fail(ERROR_CODES.INVENTORY_CONVERSION_INVALID_STATE, err.message, 409);
    }
    console.error('[inventory-conversion.execute]', err);
    return fail(ERROR_CODES.INTERNAL_ERROR, '执行转换单失败（事务已回滚，单据保持 SUBMITTED）', 500);
  }

  if (!result || result.ok === false) {
    const codeMap: Record<string, { code: ErrorCode; msg: string; status: number }> = {
      NOT_FOUND: { code: ERROR_CODES.INVENTORY_CONVERSION_NOT_FOUND, msg: '转换单不存在', status: 404 },
      ALREADY_EXECUTED: { code: ERROR_CODES.INVENTORY_CONVERSION_ALREADY_EXECUTED, msg: '转换单已执行，重复 Execute 幂等拒绝', status: 409 },
      INVALID_STATE: { code: ERROR_CODES.INVENTORY_CONVERSION_INVALID_STATE, msg: '仅 SUBMITTED 状态可执行（提交确认后，SUBMITTED ≠ EXECUTED）', status: 409 },
      VERSION_CONFLICT: { code: ERROR_CODES.VERSION_CONFLICT, msg: '版本冲突，请刷新后重试', status: 409 },
      NO_LINES: { code: ERROR_CODES.INVENTORY_CONVERSION_NO_LINES, msg: '转换单必须恰好包含 1 CONSUME + 1 PRODUCE', status: 400 },
      LINE_ROLE_REQUIRED: { code: ERROR_CODES.INVENTORY_CONVERSION_LINE_ROLE_REQUIRED, msg: '必须恰好 1 条 CONSUME + 1 条 PRODUCE（单输入单输出）', status: 400 },
      QUANTITY_INVALID: { code: ERROR_CODES.INVENTORY_CONVERSION_INVALID_STATE, msg: '转换数量/换算率/canonical 数量必须 > 0', status: 400 },
      ITEM_INVALID: { code: ERROR_CODES.INVENTORY_CONVERSION_ITEM_INVALID, msg: '物料不存在或已停用', status: 400 },
      BASE_UOM_INVALID: { code: ERROR_CODES.INVENTORY_CONVERSION_BASE_UOM_INVALID, msg: 'baseUomId 必须 == 该物料的库存单位（stockUomId）', status: 400 },
      WAREHOUSE_INVALID: { code: ERROR_CODES.INVENTORY_CONVERSION_WAREHOUSE_INVALID, msg: '仓库不存在或已停用', status: 400 },
      LOCATION_INVALID: { code: ERROR_CODES.INVENTORY_CONVERSION_LOCATION_INVALID, msg: '库位不存在或不属于对应仓库', status: 400 },
      BASE_QTY_MISMATCH: { code: ERROR_CODES.INVENTORY_CONVERSION_BASE_QTY_MISMATCH, msg: 'CONSUME.baseQuantity 必须 == PRODUCE.baseQuantity（守恒，P11）', status: 400 },
      BASE_QTY_INVALID: { code: ERROR_CODES.INVENTORY_CONVERSION_BASE_QTY_INVALID, msg: 'stored baseQuantity 必须 == ROUND_HALF_UP(quantity × uomToBaseRate, 4)（canonical 重验，Blocking ①）', status: 400 },
      BATCH_MISMATCH: { code: ERROR_CODES.INVENTORY_CONVERSION_BATCH_MISMATCH, msg: 'CONSUME 与 PRODUCE 的 batchNo 必须一致（P5 精确继承，首版不拆批不换批）', status: 400 },
    };
    const entry = result && result.ok === false ? codeMap[result.error] : undefined;
    if (entry) return fail(entry.code, entry.msg, entry.status);
    return fail(ERROR_CODES.INTERNAL_ERROR, '执行转换单失败', 500);
  }

  await writeAuditLog({
    actorId,
    action: 'inventory-conversion:execute',
    entityType: 'inventory-conversion',
    entityId: result.conversion.id,
    afterData: {
      conversionNo: result.conversion.conversionNo,
      status: result.conversion.status,
      movementGroupId: result.conversion.movementGroupId,
      executedAt: result.conversion.executedAt?.toISOString(),
      executedById: result.conversion.executedById,
    },
    meta,
  });

  // 事务提交后 best-effort 发布 InventoryConversionExecuted（EVENTS v1.28 已注册；不含库存余额）
  publishInventoryConversionEvent({
    eventType: 'InventoryConversionExecuted',
    actorId,
    entityId: result.conversion.id,
    payload: {
      conversionId: result.conversion.id,
      conversionNo: result.conversion.conversionNo,
      itemId: result.conversion.itemId,
      baseUomId: result.conversion.baseUomId,
      movementGroupId: result.conversion.movementGroupId ?? '',
      lines: result.conversion.lines.map((l) => ({
        lineId: l.id,
        lineRole: l.lineRole,
        quantity: l.quantity.toString(),
        uomId: l.uomId,
        uomToBaseRate: l.uomToBaseRate.toString(),
        baseQuantity: l.baseQuantity.toString(),
        warehouseId: l.warehouseId,
        locationId: l.locationId,
        batchNo: l.batchNo,
      })),
      executedById: actorId,
      executedAt: new Date().toISOString(),
    },
    meta,
  }).catch(() => undefined);

  return ok({
    conversion: result.conversion,
    atomResults: result.atomResults,
  });
}
