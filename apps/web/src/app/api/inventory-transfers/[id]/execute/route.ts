import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation } from '@/lib/api/response';
import { ERROR_CODES, type ErrorCode } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { inventoryTransferExecuteSchema } from '@/lib/api/schemas';
import { buildTransferAtoms } from '@/lib/inventory-transfer/helpers';
import { publishInventoryTransferEvent } from '@/lib/inventory-transfer/events';
import {
  executeLedgerAtoms,
  InventoryInsufficientStockError,
  InventoryLedgerIdempotencyConflictError,
} from '@/lib/inventory-ledger/ledger-command';

export const dynamic = 'force-dynamic';

/**
 * POST /api/inventory-transfers/:id/execute —— **APPROVED → EXECUTED（CTO 6B-2 最高风险点）**
 * 三个不可妥协不变量（CTO 锁死）：
 * ① **SOURCE_OUT + DESTINATION_IN 共用同一非空 movementGroupId**——EXECUTE 时生成并冻结（DRAFT 可空，EXECUTE 后必有）；
 *    **movementGroupId 是稳定业务事实（CTO Transfer Review Blocking ②）**：锁单后已有值（重试/恢复）→ 复用；无值 → 生成一次并冻结；禁止每次 attempt 随机重造（同五元 identity 不同 group fact → Shared Core 判 idempotency conflict）；
 * ② **业务单据 EXECUTED + 两笔 Movement + 两侧 Projection 必须在同一个 caller transaction 内全有或全无**——
 *    任何 atom 失败（源库存不足 / 幂等 conflict / Projection/DB 错误）→ 整事务回滚，**Transfer 仍保持 APPROVED**；
 * ③ **重试必须通过 Shared Core 的 identity+immutable-fact 幂等规则**——只调用 executeLedgerAtoms，
 *    禁止 Transfer 自己实现任何库存扣增逻辑。
 *
 * 事务顺序（CTO 指定）：
 *   FOR UPDATE 锁 InventoryTransfer → status 必须 = APPROVED（EXECUTED → 409 ALREADY_EXECUTED 幂等拒绝）→
 *   校验执行态事实（lines 非空 / quantity>0 / warehouse+location 组合 FK / item 有效 / serial 守恒）→
 *   生成/复用非空 movementGroupId（已有值复用，无值生成一次并冻结）→ 每行构造 SOURCE_OUT(OUT/TRANSFER_OUT) + DESTINATION_IN(IN/TRANSFER_IN)
 *   （同源 lineId + 同 groupId）→ executeLedgerAtoms(tx, allAtoms)（同一 caller tx）→ 全部成功 →
 *   status=EXECUTED + movementGroupId + executedById/executedAt + CAS version+1（同事务）→ AuditLog → COMMIT
 *   → 事务提交后 best-effort 发布 InventoryTransferExecuted。
 *
 * 五元幂等：sourceType=TRANSFER，sourceId=transfer.id，sourceLineId=line.id，
 * movementRole=SOURCE_OUT/DESTINATION_IN，movementAtomKey=BULK（非 serial）或 serialNo（serial-managed 每 serial 一对）。
 * batch/mfgDate/expDate SOURCE→DESTINATION 原样继承（6B 首版禁止换批）。
 * serial-managed：serialNos.length == quantity 且整数、serial 去重、双边完全相同 serial 集合（buildTransferAtoms 保证）。
 * 自调拨（同仓同库位含都 NULL）在 Create/Submit 已拒绝，Execute 防御性复核。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  // execute 映射现有动作（对齐 5B post→:edit 先例：execute→inventory-transfer:edit）
  const denied = requirePermission(user, 'inventory-transfer:edit');
  if (denied) return denied;
  requestLog(request, user?.id, 'inventory-transfer.execute');

  const { id } = await params;
  const parsed = inventoryTransferExecuteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version } = parsed.data;
  const meta = requestMeta(request);
  const actorId = user!.id;

  let result:
    | {
        ok: true;
        transfer: NonNullable<Awaited<ReturnType<typeof prisma.inventoryTransfer.findFirst>>> & {
          lines: Array<{ id: string; itemId: string; quantity: Prisma.Decimal; batchNo: string | null }>;
        };
        movementGroupId: string;
        atomResults: Array<{ inserted: boolean; movementNo: string }>;
      }
    | { ok: false; error: string; status: number; message: string }
    | undefined;

  try {
    result = await prisma.$transaction(async (tx) => {
      // ① FOR UPDATE 锁 InventoryTransfer（防并发 Execute / Cancel）
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "InventoryTransfer" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
      );
      if (locked.length === 0) {
        return { ok: false as const, error: 'NOT_FOUND', status: 404, message: '调拨单不存在' };
      }

      const transfer = await tx.inventoryTransfer.findFirst({
        where: { id, deletedAt: null },
        include: {
          lines: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
        },
      });
      if (!transfer) {
        return { ok: false as const, error: 'NOT_FOUND', status: 404, message: '调拨单不存在' };
      }

      // ② 状态门禁：仅 APPROVED 可 Execute
      if (transfer.status === 'EXECUTED') {
        return {
          ok: false as const,
          error: 'ALREADY_EXECUTED',
          status: 409,
          message: `调拨单已执行（movementGroupId=${transfer.movementGroupId ?? '-'}）；重复 Execute 幂等拒绝，请查询详情`,
        };
      }
      if (transfer.status !== 'APPROVED') {
        return {
          ok: false as const,
          error: 'INVALID_STATE',
          status: 409,
          message: `仅 APPROVED 状态可执行（当前 ${transfer.status}）；审批未完成（APPROVED ≠ EXECUTED）`,
        };
      }
      // CAS version
      if (transfer.version !== version) {
        return { ok: false as const, error: 'VERSION_CONFLICT', status: 409, message: '版本冲突，请刷新后重试' };
      }

      // ③ 执行态事实校验
      if (transfer.lines.length === 0) {
        return { ok: false as const, error: 'NO_LINES', status: 400, message: '调拨单至少需要一条有效行' };
      }
      const invalidQty = transfer.lines.some((l) => l.quantity.lte(0));
      if (invalidQty) {
        return { ok: false as const, error: 'QUANTITY_INVALID', status: 400, message: '调拨数量必须 > 0' };
      }
      // warehouse / location 组合 FK（防御性复核）
      const [sourceWh, destWh] = await Promise.all([
        tx.warehouse.findFirst({ where: { id: transfer.sourceWarehouseId, deletedAt: null } }),
        tx.warehouse.findFirst({ where: { id: transfer.destinationWarehouseId, deletedAt: null } }),
      ]);
      if (!sourceWh || !destWh) {
        return { ok: false as const, error: 'WAREHOUSE_INVALID', status: 400, message: '源/目标仓库不存在或已停用' };
      }
      if (transfer.sourceLocationId) {
        const loc = await tx.warehouseLocation.findFirst({
          where: { id: transfer.sourceLocationId, warehouseId: transfer.sourceWarehouseId, deletedAt: null },
        });
        if (!loc) return { ok: false as const, error: 'LOCATION_INVALID', status: 400, message: '源库位不存在或不属于源仓库' };
      }
      if (transfer.destinationLocationId) {
        const loc = await tx.warehouseLocation.findFirst({
          where: { id: transfer.destinationLocationId, warehouseId: transfer.destinationWarehouseId, deletedAt: null },
        });
        if (!loc) return { ok: false as const, error: 'LOCATION_INVALID', status: 400, message: '目标库位不存在或不属于目标仓库' };
      }
      // 自调拨防护（防御性复核）
      if (
        transfer.sourceWarehouseId === transfer.destinationWarehouseId &&
        (transfer.sourceLocationId ?? null) === (transfer.destinationLocationId ?? null)
      ) {
        return { ok: false as const, error: 'SELF_TRANSFER', status: 409, message: '不能向同一仓库同一库位调拨（五维全等无实际转移）' };
      }
      // item 有效 + serial 守恒（Execute 最终校验）
      for (const l of transfer.lines) {
        const item = await tx.item.findFirst({ where: { id: l.itemId, deletedAt: null } });
        if (!item) return { ok: false as const, error: 'ITEM_INVALID', status: 400, message: '物料不存在或已停用' };
        if (l.serialNos.length > 0) {
          if (!l.quantity.isInteger()) {
            return { ok: false as const, error: 'SERIAL_QTY_MISMATCH', status: 400, message: 'serial 数量必须为整数' };
          }
          if (!l.quantity.equals(new Prisma.Decimal(l.serialNos.length))) {
            return {
              ok: false as const,
              error: 'SERIAL_QTY_MISMATCH',
              status: 400,
              message: `serial 数量不守恒：serialNos(${l.serialNos.length}) != quantity(${l.quantity})`,
            };
          }
          if (new Set(l.serialNos).size !== l.serialNos.length) {
            return { ok: false as const, error: 'SERIAL_DUPLICATE', status: 400, message: '序列号列表内存在重复 serial' };
          }
        }
      }

      // ④ movementGroupId：**稳定业务事实**（CTO Transfer Review Blocking ② 修复）
      //    锁单后：已有值（重试/恢复场景，曾生成并冻结）→ **复用**；无值 → 生成一次并随单据 EXECUTED 冻结。
      //    **禁止每次 attempt 随机重造**：movementGroupId 属于 Shared Core immutable-fact equality 的一部分，
      //    同五元 identity 但 group fact 不同（G1→G2）→ Shared Core 必然判 idempotency conflict。
      //    （仅 EXECUTE 时生成/冻结——Create/Submit/Approve 阶段不提前生成；EXECUTED 后必有，DB CHECK 兑底）
      const movementGroupId = transfer.movementGroupId ?? crypto.randomUUID();

      // ⑤ 构造双 atom（SOURCE_OUT + DESTINATION_IN，同一行共用 sourceLineId + movementGroupId）
      const atoms = buildTransferAtoms({
        transfer: {
          id: transfer.id,
          transferNo: transfer.transferNo,
          sourceWarehouseId: transfer.sourceWarehouseId,
          sourceLocationId: transfer.sourceLocationId,
          destinationWarehouseId: transfer.destinationWarehouseId,
          destinationLocationId: transfer.destinationLocationId,
        },
        lines: transfer.lines,
        movementGroupId,
        actorId,
        occurredAt: new Date().toISOString(),
      });

      // ⑥ Shared Core 双 atom 同事务执行（**全有或全无**——任一失败抛错 → 整事务回滚，Transfer 保持 APPROVED）
      const results = await executeLedgerAtoms(tx, atoms);

      // ⑦ 全部成功 → 单据 EXECUTED + 证据（同一事务；CAS version+1）
      const executedAt = new Date();
      const cas = await tx.inventoryTransfer.updateMany({
        where: { id, version, status: 'APPROVED', deletedAt: null },
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
        // 并发下状态/版本被抢 → 整事务回滚（Movement 不落、单据不 EXECUTED）
        return { ok: false as const, error: 'VERSION_CONFLICT', status: 409, message: '版本冲突或状态已变化，请刷新后重试' };
      }

      const finalTransfer = await tx.inventoryTransfer.findFirstOrThrow({
        where: { id, deletedAt: null },
        include: {
          sourceWarehouse: { select: { id: true, code: true, name: true } },
          destinationWarehouse: { select: { id: true, code: true, name: true } },
          lines: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
        },
      });
      return {
        ok: true as const,
        transfer: finalTransfer,
        movementGroupId,
        atomResults: results.map((r) => ({ inserted: r.inserted, movementNo: r.movementNo })),
      };
    });
  } catch (err) {
    // 业务失败（源库存不足 / 幂等 immutable-fact conflict）→ 409；技术失败 → 500
    if (err instanceof InventoryInsufficientStockError) {
      return fail(ERROR_CODES.INVENTORY_INSUFFICIENT_STOCK, err.message, 409);
    }
    if (err instanceof InventoryLedgerIdempotencyConflictError) {
      return fail(ERROR_CODES.INVENTORY_TRANSFER_INVALID_STATE, err.message, 409);
    }
    console.error('[inventory-transfer.execute]', err);
    return fail(ERROR_CODES.INTERNAL_ERROR, '执行调拨单失败（事务已回滚，单据保持 APPROVED）', 500);
  }

  if (!result || result.ok === false) {
    // 显式 codeMap：entry.error 是内部标记字符串，不是 ERROR_CODES 的 key（不能直接索引）
    const codeMap: Record<string, { code: ErrorCode; msg: string; status: number }> = {
      NOT_FOUND: { code: ERROR_CODES.INVENTORY_TRANSFER_NOT_FOUND, msg: '调拨单不存在', status: 404 },
      ALREADY_EXECUTED: { code: ERROR_CODES.INVENTORY_TRANSFER_ALREADY_EXECUTED, msg: '调拨单已执行，重复 Execute 幂等拒绝', status: 409 },
      INVALID_STATE: { code: ERROR_CODES.INVENTORY_TRANSFER_INVALID_STATE, msg: '仅 APPROVED 状态可执行（审批未完成，APPROVED ≠ EXECUTED）', status: 409 },
      VERSION_CONFLICT: { code: ERROR_CODES.VERSION_CONFLICT, msg: '版本冲突，请刷新后重试', status: 409 },
      NO_LINES: { code: ERROR_CODES.INVENTORY_TRANSFER_NO_LINES, msg: '调拨单至少需要一条有效行', status: 400 },
      QUANTITY_INVALID: { code: ERROR_CODES.INVENTORY_TRANSFER_QUANTITY_INVALID, msg: '调拨数量必须 > 0', status: 400 },
      WAREHOUSE_INVALID: { code: ERROR_CODES.INVENTORY_TRANSFER_WAREHOUSE_INVALID, msg: '源/目标仓库不存在或已停用', status: 400 },
      LOCATION_INVALID: { code: ERROR_CODES.INVENTORY_TRANSFER_LOCATION_INVALID, msg: '库位不存在或不属于对应仓库', status: 400 },
      SELF_TRANSFER: { code: ERROR_CODES.INVENTORY_TRANSFER_SELF_TRANSFER, msg: '不能向同一仓库同一库位调拨（五维全等无实际转移）', status: 409 },
      ITEM_INVALID: { code: ERROR_CODES.INVENTORY_TRANSFER_ITEM_INVALID, msg: '物料不存在或已停用', status: 400 },
      SERIAL_QTY_MISMATCH: { code: ERROR_CODES.INVENTORY_TRANSFER_SERIAL_QTY_MISMATCH, msg: 'serial 数量必须 = quantity 且为整数', status: 400 },
      SERIAL_DUPLICATE: { code: ERROR_CODES.INVENTORY_TRANSFER_SERIAL_DUPLICATE, msg: '序列号列表内存在重复 serial', status: 400 },
    };
    const entry = result && result.ok === false ? codeMap[result.error] : undefined;
    if (entry) return fail(entry.code, entry.msg, entry.status);
    return fail(ERROR_CODES.INTERNAL_ERROR, '执行调拨单失败', 500);
  }

  await writeAuditLog({
    actorId,
    action: 'inventory-transfer:execute',
    entityType: 'inventory-transfer',
    entityId: result.transfer.id,
    afterData: {
      transferNo: result.transfer.transferNo,
      status: result.transfer.status,
      movementGroupId: result.movementGroupId,
      executedAt: result.transfer.executedAt?.toISOString(),
      executedById: result.transfer.executedById,
    },
    meta,
  });

  // 事务提交后 best-effort 发布 InventoryTransferExecuted（EVENTS v1.28 已注册；不含库存余额）
  publishInventoryTransferEvent({
    eventType: 'InventoryTransferExecuted',
    actorId,
    entityId: result.transfer.id,
    payload: {
      transferId: result.transfer.id,
      transferNo: result.transfer.transferNo,
      movementGroupId: result.movementGroupId,
      sourceWarehouseId: result.transfer.sourceWarehouseId,
      sourceLocationId: result.transfer.sourceLocationId,
      destinationWarehouseId: result.transfer.destinationWarehouseId,
      destinationLocationId: result.transfer.destinationLocationId,
      lines: result.transfer.lines.map((l) => ({
        lineId: l.id,
        itemId: l.itemId,
        quantity: l.quantity.toString(),
        batchNo: l.batchNo,
      })),
      executedById: actorId,
      executedAt: new Date().toISOString(),
    },
    meta,
  }).catch(() => undefined);

  return ok({
    transfer: result.transfer,
    movementGroupId: result.movementGroupId,
    atomResults: result.atomResults,
  });
}
