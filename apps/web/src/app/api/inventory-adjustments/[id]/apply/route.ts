import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authenticate, requirePermission, requestMeta, writeAuditLog } from '@/lib/api-helpers';
import { ok, fail, failValidation } from '@/lib/api/response';
import { ERROR_CODES, type ErrorCode } from '@/lib/api/errors';
import { requestLog } from '@/lib/api/logger';
import { inventoryAdjustmentApplySchema } from '@/lib/api/schemas';
import { buildAdjustmentAtoms } from '@/lib/inventory-adjustment/helpers';
import { publishInventoryAdjustmentEvent } from '@/lib/inventory-adjustment/events';
import {
  executeLedgerAtoms,
  InventoryInsufficientStockError,
  InventoryLedgerIdempotencyConflictError,
} from '@/lib/inventory-ledger/ledger-command';

export const dynamic = 'force-dynamic';

/**
 * POST /api/inventory-adjustments/:id/apply —— **APPROVED → APPLIED（CTO 6B-3 最高风险点）**
 * 红线（CTO 6B-3 锁死）：
 * ① **Adjustment 只能经 Shared LedgerCommand 追加 ADJUSTMENT Movement**（同步命令）——**绝不直写
 *    InventoryMovement / UPDATE StockProjection**（Count 差异 / Manual 调整统一走此入口）；
 * ② **业务单据 APPLIED + 每行 ADJUSTMENT Movement + 五维 Projection 必须在同一个 caller transaction 内全有或全无**——
 *    任何 atom 失败（源库存不足 / 幂等 conflict / Projection/DB 错误）→ 整事务回滚，**Adjustment 仍保持 APPROVED**；
 * ③ **重试通过 Shared Core identity+immutable-fact 幂等**——只调用 executeLedgerAtoms，禁止自实现扣增逻辑。
 *
 * maker-checker（P9 Final + DB CHECK 兜底）：appliedById 不得 = createdById（apply 人 ≠ 创建人）；
 * 终态证据 CHECK：status=APPLIED ⇒ approvedById/appliedById/appliedAt 全非空（若未命中策略导致 approvedById
 * 为空，则由 apply 人补录——apply 人 ≠ 创建人，两 CHECK 同时满足）。
 *
 * 事务顺序：FOR UPDATE 锁 InventoryAdjustment → status 必须 = APPROVED（APPLIED → 409 ALREADY_APPLIED 幂等拒绝）→
 * CAS version → maker-checker（actorId ≠ createdById）→ 校验执行态事实（lines 非空 / quantity>0 /
 * warehouse+location 组合 FK / item 有效）→ 构造 atoms（每行一笔 ADJUSTMENT Movement：
 * sourceType=ADJUSTMENT, sourceId=adjustment.id, sourceLineId=line.id, movementRole=ADJUSTMENT,
 * movementAtomKey=BULK 或 serialNo, movementGroupId=adjustment.id 稳定, direction=行 direction,
 * movementType=ADJUSTMENT, quantity=行 quantity）→ executeLedgerAtoms(tx, atoms)（同一 caller tx）→ 全部成功 →
 * status=APPLIED + appliedById/appliedAt + approvedById（若 null 补 apply 人）+ CAS version+1（同事务）→
 * AuditLog → COMMIT → 事务提交后 best-effort 发布 InventoryAdjustmentApplied。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  // apply 映射受限系统权限（P8/P9 Final：仅 SUPER_ADMIN/ADMIN——Adjustment 直接动库存账且 MANUAL 高风险）
  const denied = requirePermission(user, 'inventory-adjustment:apply');
  if (denied) return denied;
  requestLog(request, user?.id, 'inventory-adjustment.apply');

  const { id } = await params;
  const parsed = inventoryAdjustmentApplySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version } = parsed.data;
  const meta = requestMeta(request);
  const actorId = user!.id;

  let result:
    | {
        ok: true;
        adjustment: NonNullable<Awaited<ReturnType<typeof prisma.inventoryAdjustment.findFirst>>> & {
          lines: Array<{ id: string; warehouseId: string; locationId: string | null; itemId: string; batchNo: string | null; serialNo: string | null; direction: 'IN' | 'OUT'; quantity: Prisma.Decimal; uomId: string | null; sourceStockCountLineId: string | null }>;
        };
        atomResults: Array<{ inserted: boolean; movementNo: string }>;
      }
    | { ok: false; error: string; status: number; message: string }
    | undefined;

  try {
    result = await prisma.$transaction(async (tx) => {
      // ① FOR UPDATE 锁 InventoryAdjustment（防并发 Apply / Cancel）
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "InventoryAdjustment" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
      );
      if (locked.length === 0) {
        return { ok: false as const, error: 'NOT_FOUND', status: 404, message: '调整单不存在' };
      }

      const adjustment = await tx.inventoryAdjustment.findFirst({
        where: { id, deletedAt: null },
        include: {
          lines: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
        },
      });
      if (!adjustment) {
        return { ok: false as const, error: 'NOT_FOUND', status: 404, message: '调整单不存在' };
      }

      // ② 状态门禁：仅 APPROVED 可 Apply
      if (adjustment.status === 'APPLIED') {
        return {
          ok: false as const,
          error: 'ALREADY_APPLIED',
          status: 409,
          message: `调整单已落账（appliedAt=${adjustment.appliedAt?.toISOString() ?? '-'}）；重复 Apply 幂等拒绝，请查询详情`,
        };
      }
      if (adjustment.status !== 'APPROVED') {
        return {
          ok: false as const,
          error: 'INVALID_STATE',
          status: 409,
          message: `仅 APPROVED 状态可执行（当前 ${adjustment.status}）；审批未完成（APPROVED ≠ APPLIED）`,
        };
      }
      // CAS version
      if (adjustment.version !== version) {
        return { ok: false as const, error: 'VERSION_CONFLICT', status: 409, message: '版本冲突，请刷新后重试' };
      }
      // ③ maker-checker：Apply 人不得 = 创建人（P9 Final + DB CHECK 兜底）
      if (actorId === adjustment.createdById) {
        return {
          ok: false as const,
          error: 'MAKER_CHECKER',
          status: 409,
          message: 'maker-checker：创建人不得自行 Apply（批准/Apply 人必须与创建人不同）',
        };
      }

      // ④ 执行态事实校验
      if (adjustment.lines.length === 0) {
        return { ok: false as const, error: 'NO_LINES', status: 400, message: '调整单至少需要一条有效行' };
      }
      const invalidQty = adjustment.lines.some((l) => l.quantity.lte(0));
      if (invalidQty) {
        return { ok: false as const, error: 'QUANTITY_INVALID', status: 400, message: '调整数量必须 > 0（方向在行）' };
      }
      for (const l of adjustment.lines) {
        const wh = await tx.warehouse.findFirst({ where: { id: l.warehouseId, deletedAt: null } });
        if (!wh) return { ok: false as const, error: 'WAREHOUSE_INVALID', status: 400, message: '仓库不存在或已停用' };
        if (l.locationId) {
          const loc = await tx.warehouseLocation.findFirst({
            where: { id: l.locationId, warehouseId: l.warehouseId, deletedAt: null },
          });
          if (!loc) return { ok: false as const, error: 'LOCATION_INVALID', status: 400, message: '库位不存在或不属于对应仓库' };
        }
        const item = await tx.item.findFirst({ where: { id: l.itemId, deletedAt: null } });
        if (!item) return { ok: false as const, error: 'ITEM_INVALID', status: 400, message: '物料不存在或已停用' };
      }

      // ⑤ 构造 atoms（每行一笔 ADJUSTMENT Movement；movementGroupId=adjustment.id 稳定业务事实，重试复用）
      const atoms = buildAdjustmentAtoms({
        adjustment: { id: adjustment.id, adjustmentNo: adjustment.adjustmentNo },
        lines: adjustment.lines,
        actorId,
        occurredAt: new Date().toISOString(),
      });

      // ⑥ Shared Core 逐行 ADJUSTMENT Movement 同事务执行（**全有或全无**——任一失败抛错 → 整事务回滚，Adjustment 保持 APPROVED）
      const results = await executeLedgerAtoms(tx, atoms);

      // ⑦ 全部成功 → 单据 APPLIED + 证据（同一事务；CAS version+1；终态证据 CHECK 全非空）
      const appliedAt = new Date();
      const cas = await tx.inventoryAdjustment.updateMany({
        where: { id, version, status: 'APPROVED', deletedAt: null },
        data: {
          status: 'APPLIED',
          // 终态证据：approvedById 若为空（未命中策略场景）由 apply 人补录（apply 人 ≠ 创建人，两 CHECK 满足）
          approvedById: adjustment.approvedById ?? actorId,
          appliedById: actorId,
          appliedAt,
          updatedById: actorId,
          version: { increment: 1 },
        },
      });
      if (cas.count !== 1) {
        return { ok: false as const, error: 'VERSION_CONFLICT', status: 409, message: '版本冲突或状态已变化，请刷新后重试' };
      }

      const finalAdjustment = await tx.inventoryAdjustment.findFirstOrThrow({
        where: { id, deletedAt: null },
        include: {
          sourceStockCount: { select: { id: true, countNo: true, status: true } },
          approvedBy: { select: { id: true, name: true, email: true } },
          appliedBy: { select: { id: true, name: true, email: true } },
          lines: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
        },
      });
      return {
        ok: true as const,
        adjustment: finalAdjustment as typeof finalAdjustment & {
          lines: Array<{ id: string; warehouseId: string; locationId: string | null; itemId: string; batchNo: string | null; serialNo: string | null; direction: 'IN' | 'OUT'; quantity: Prisma.Decimal; uomId: string | null; sourceStockCountLineId: string | null }>;
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
      return fail(ERROR_CODES.INVENTORY_ADJUSTMENT_INVALID_STATE, err.message, 409);
    }
    console.error('[inventory-adjustment.apply]', err);
    return fail(ERROR_CODES.INTERNAL_ERROR, '执行调整单失败（事务已回滚，单据保持 APPROVED）', 500);
  }

  if (!result || result.ok === false) {
    const codeMap: Record<string, { code: ErrorCode; msg: string; status: number }> = {
      NOT_FOUND: { code: ERROR_CODES.INVENTORY_ADJUSTMENT_NOT_FOUND, msg: '调整单不存在', status: 404 },
      ALREADY_APPLIED: { code: ERROR_CODES.INVENTORY_ADJUSTMENT_ALREADY_APPLIED, msg: '调整单已落账，重复 Apply 幂等拒绝', status: 409 },
      INVALID_STATE: { code: ERROR_CODES.INVENTORY_ADJUSTMENT_INVALID_STATE, msg: '仅 APPROVED 状态可执行（审批未完成，APPROVED ≠ APPLIED）', status: 409 },
      VERSION_CONFLICT: { code: ERROR_CODES.VERSION_CONFLICT, msg: '版本冲突，请刷新后重试', status: 409 },
      MAKER_CHECKER: { code: ERROR_CODES.INVENTORY_ADJUSTMENT_MAKER_CHECKER, msg: 'maker-checker：创建人不得自行 Apply', status: 409 },
      NO_LINES: { code: ERROR_CODES.INVENTORY_ADJUSTMENT_NO_LINES, msg: '调整单至少需要一条有效行', status: 400 },
      QUANTITY_INVALID: { code: ERROR_CODES.INVENTORY_ADJUSTMENT_QUANTITY_INVALID, msg: '调整数量必须 > 0（方向在行）', status: 400 },
      WAREHOUSE_INVALID: { code: ERROR_CODES.INVENTORY_ADJUSTMENT_WAREHOUSE_INVALID, msg: '仓库不存在或已停用', status: 400 },
      LOCATION_INVALID: { code: ERROR_CODES.INVENTORY_ADJUSTMENT_LOCATION_INVALID, msg: '库位不存在或不属于对应仓库', status: 400 },
      ITEM_INVALID: { code: ERROR_CODES.INVENTORY_ADJUSTMENT_ITEM_INVALID, msg: '物料不存在或已停用', status: 400 },
    };
    const entry = result && result.ok === false ? codeMap[result.error] : undefined;
    if (entry) return fail(entry.code, entry.msg, entry.status);
    return fail(ERROR_CODES.INTERNAL_ERROR, '执行调整单失败', 500);
  }

  await writeAuditLog({
    actorId,
    action: 'inventory-adjustment:apply',
    entityType: 'inventory-adjustment',
    entityId: result.adjustment.id,
    afterData: {
      adjustmentNo: result.adjustment.adjustmentNo,
      status: result.adjustment.status,
      reasonCode: result.adjustment.reasonCode,
      appliedAt: result.adjustment.appliedAt?.toISOString(),
      appliedById: result.adjustment.appliedById,
      approvedById: result.adjustment.approvedById,
    },
    meta,
  });

  // 事务提交后 best-effort 发布 InventoryAdjustmentApplied（EVENTS v1.28 已注册；不含库存余额）
  publishInventoryAdjustmentEvent({
    eventType: 'InventoryAdjustmentApplied',
    actorId,
    entityId: result.adjustment.id,
    payload: {
      adjustmentId: result.adjustment.id,
      adjustmentNo: result.adjustment.adjustmentNo,
      reasonCode: result.adjustment.reasonCode,
      sourceStockCountId: result.adjustment.sourceStockCountId,
      lines: result.adjustment.lines.map((l) => ({
        lineId: l.id,
        direction: l.direction,
        warehouseId: l.warehouseId,
        locationId: l.locationId,
        itemId: l.itemId,
        batchNo: l.batchNo,
        serialNo: l.serialNo,
        quantity: l.quantity.toString(),
        sourceStockCountLineId: l.sourceStockCountLineId ?? null,
      })),
      appliedById: actorId,
      appliedAt: new Date().toISOString(),
    },
    meta,
  }).catch(() => undefined);

  return ok({
    adjustment: result.adjustment,
    atomResults: result.atomResults,
  });
}
