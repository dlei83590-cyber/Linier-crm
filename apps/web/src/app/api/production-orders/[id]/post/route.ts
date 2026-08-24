import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, fail, failConflict, failServer } from "@/lib/api/response";
import { ERROR_CODES, type ErrorCode } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";
import {
  buildProductionAtoms,
  computeMaterialIssueCost,
  bomRequirementForLine,
} from "@/lib/production-order/helpers";
import {
  executeLedgerAtoms,
  InventoryInsufficientStockError,
  InventoryLedgerIdempotencyConflictError,
} from "@/lib/inventory-ledger/ledger-command";
import { upsertInboundCost } from "@/lib/inventory-cost/moving-average";

export const dynamic = "force-dynamic";

const postSchema = z.object({ version: z.coerce.number().int().positive() });

/**
 * POST /api/production-orders/:id/post —— **SUBMITTED → POSTED（P-1 Item Sourcing 最高风险点）**
 *
 * 同事务事实边界（全有或全无，禁 partial success）：
 * ① FOR UPDATE 锁 ProductionOrder → 状态门禁（POSTED 幂等拒绝 / 仅 SUBMITTED）→ CAS version
 * ② 行事实复核：≥1 MATERIAL + 恰好 1 FINISHED；数量 > 0；成品行 == header.finishedItemId
 * ③ 有 BOM ⇒ 每原料行数量 ≥ 配方需求量（成品数 × 系数 × (1+损耗率)，允许上调）
 * ④ movementGroupId：已有值复用，无值生成一次并冻结（稳定业务事实，重试复用）
 * ⑤ 原料成本预计算（与 applyOutboundCost 同口径 min(qty×avg, totalCost)）→ 成品成本 = Σ原料成本 + OEM 加工费
 * ⑥ 原料行逐行 OUT（executeLedgerAtoms，role=CONSUME）+ 成品 IN（role=PRODUCE）同一 movementGroupId
 * ⑦ 成品成本入移动加权成本层（upsertInboundCost，sourceKey=COST:PRODUCTION_ORDER:{lineId} 幂等）
 * ⑧ CAS 回写 POSTED + movementGroupId + postedById/At + 成品行 unitCost/amount（同事务）
 *
 * 五元幂等：sourceType=PRODUCTION，sourceId=order.id，sourceLineId=line.id，movementRole=CONSUME/PRODUCE，
 * movementAtomKey=BULK（与 ProductionInbound 同源；orderNo 为 referenceNo 区分）
 * 红线：0 直写 InventoryMovement/StockProjection（只经 executeLedgerAtoms）
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  // post → :edit（对齐 5B post→:edit 先例）
  const denied = requirePermission(user, "production-order:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "production-order.post");

  const { id } = await params;
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failConflict(ERROR_CODES.VERSION_CONFLICT, "缺少 version");
  const meta = requestMeta(request);
  const actorId = user!.id;

  try {
    const posted = await prisma.$transaction(async (tx) => {
      // ① FOR UPDATE 锁
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "ProductionOrder" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
      );
      if (locked.length === 0) throw new Error("NOT_FOUND");

      const order = await tx.productionOrder.findFirst({
        where: { id, deletedAt: null },
        include: { lines: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } } },
      });
      if (!order) throw new Error("NOT_FOUND");

      // 状态门禁
      if (order.status === "POSTED") throw new Error("ALREADY_POSTED");
      if (order.status !== "SUBMITTED") throw new Error("INVALID_STATE");
      if (order.version !== parsed.data.version) throw new Error("VERSION_CONFLICT");

      // ② 行事实复核
      const materials = order.lines.filter((l) => l.lineType === "MATERIAL");
      const finished = order.lines.find((l) => l.lineType === "FINISHED");
      if (materials.length === 0 || !finished) throw new Error("NO_LINES");
      if (finished.itemId !== order.finishedItemId) throw new Error("LINE_INVALID");
      if (order.lines.some((l) => l.quantity.lte(0))) throw new Error("LINE_INVALID");

      // ③ 有 BOM ⇒ 原料行数量 ≥ 配方需求量
      if (order.bomId) {
        const bomLines = await tx.itemBomLine.findMany({ where: { bomId: order.bomId } });
        const reqMap = new Map(
          bomLines.map((l) => [
            l.componentItemId,
            bomRequirementForLine(order.plannedQty, l.qtyPerFinishedUnit, l.lossRate),
          ]),
        );
        for (const m of materials) {
          const req = reqMap.get(m.itemId);
          if (req && m.quantity.lt(req)) {
            throw new Error("BOM_REQUIREMENT:" + m.itemId);
          }
        }
      }

      // ④ movementGroupId：稳定业务事实
      const movementGroupId = order.movementGroupId ?? crypto.randomUUID();

      // ⑤ 原料成本预计算 + 成品成本
      let totalMaterialCost = new Prisma.Decimal(0);
      for (const m of materials) {
        totalMaterialCost = totalMaterialCost.plus(await computeMaterialIssueCost(tx, m.itemId, m.quantity));
      }
      const processingFee = order.processingFee ?? new Prisma.Decimal(0);
      const finishedBaseAmount = totalMaterialCost.plus(processingFee).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      const finishedUnitCost = order.plannedQty.gt(0)
        ? finishedBaseAmount.div(order.plannedQty).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP)
        : new Prisma.Decimal(0);

      // ⑥ 原子组（原料 OUT + 成品 IN）同事务执行
      const atoms = buildProductionAtoms({
        orderId: order.id,
        orderNo: order.orderNo,
        productionType: order.productionType,
        movementGroupId,
        batchNo: order.batchNo,
        actorId,
        occurredAt: new Date().toISOString(),
        finishedWarehouseId: order.warehouseId,
        materialLines: materials.map((m) => ({
          id: m.id,
          itemId: m.itemId,
          uomId: m.uomId,
          quantity: m.quantity,
          warehouseId: m.warehouseId as string,
        })),
        finishedLine: {
          id: finished.id,
          itemId: finished.itemId,
          uomId: finished.uomId,
          quantity: order.plannedQty,
        },
      });
      await executeLedgerAtoms(tx, atoms);

      // ⑦ 成品成本入移动加权成本层（幂等 sourceKey）
      const costResult = await upsertInboundCost(tx, {
        itemId: order.finishedItemId,
        quantity: order.plannedQty,
        baseAmount: finishedBaseAmount,
        sourceKey: "COST:PRODUCTION_ORDER:" + finished.id,
        actorId,
      });
      if (!costResult.ok) throw new Error("COST_IN_FAILED:" + costResult.code);

      // ⑧ CAS 回写终态 + 成品行成本证据
      const cas = await tx.productionOrder.updateMany({
        where: { id, version: parsed.data.version, status: "SUBMITTED", deletedAt: null },
        data: {
          status: "POSTED",
          movementGroupId,
          postedById: actorId,
          postedAt: new Date(),
          updatedById: actorId,
          version: { increment: 1 },
        },
      });
      if (cas.count !== 1) throw new Error("VERSION_CONFLICT");
      await tx.productionOrderLine.update({
        where: { id: finished.id },
        data: { unitCost: finishedUnitCost, amount: finishedBaseAmount, updatedById: actorId },
      });

      return tx.productionOrder.findFirstOrThrow({
        where: { id, deletedAt: null },
        include: {
          finishedItem: { select: { id: true, code: true, name: true } },
          lines: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } },
        },
      });
    });

    await writeAuditLog({
      actorId,
      action: "production-order.post",
      entityType: "productionOrder",
      entityId: id,
      afterData: {
        orderNo: posted.orderNo,
        status: posted.status,
        movementGroupId: posted.movementGroupId,
        postedAt: posted.postedAt?.toISOString(),
        plannedQty: posted.plannedQty.toString(),
      },
      ...meta,
    });
    return ok({
      id,
      status: posted.status,
      movementGroupId: posted.movementGroupId,
      postedAt: posted.postedAt,
      version: posted.version,
    });
  } catch (e) {
    if (e instanceof InventoryInsufficientStockError) {
      return fail(ERROR_CODES.INVENTORY_INSUFFICIENT_STOCK, e.message, 409);
    }
    if (e instanceof InventoryLedgerIdempotencyConflictError) {
      return fail(ERROR_CODES.PRODUCTION_ORDER_INVALID_STATE, e.message, 409);
    }
    const msg = e instanceof Error ? e.message : "";
    const prefix = "BOM_REQUIREMENT:";
    if (msg.startsWith(prefix)) {
      return fail(ERROR_CODES.PRODUCTION_ORDER_BOM_REQUIREMENT, `原料行数量小于配方需求量（物料 ${msg.slice(prefix.length)}）`, 400);
    }
    if (msg.startsWith("COST_IN_FAILED:")) return failServer("成品成本层更新失败：" + msg);
    const codeMap: Record<string, { code: ErrorCode; msg: string; status: number }> = {
      NOT_FOUND: { code: ERROR_CODES.PRODUCTION_ORDER_NOT_FOUND, msg: "工单不存在", status: 404 },
      ALREADY_POSTED: { code: ERROR_CODES.PRODUCTION_ORDER_ALREADY_POSTED, msg: "工单已过账，重复 POST 幂等拒绝", status: 409 },
      INVALID_STATE: { code: ERROR_CODES.PRODUCTION_ORDER_INVALID_STATE, msg: "仅 SUBMITTED 状态可过账（提交确认后，SUBMITTED ≠ POSTED）", status: 409 },
      VERSION_CONFLICT: { code: ERROR_CODES.VERSION_CONFLICT, msg: "版本冲突，请刷新后重试", status: 409 },
      NO_LINES: { code: ERROR_CODES.PRODUCTION_ORDER_NO_LINES, msg: "工单至少需要 1 行物料 + 1 行成品", status: 400 },
      LINE_INVALID: { code: ERROR_CODES.PRODUCTION_ORDER_LINE_INVALID, msg: "工单行非法（数量必须 > 0，成品行必须 = 工单成品）", status: 400 },
    };
    const entry = codeMap[msg];
    if (entry) return fail(entry.code, entry.msg, entry.status);
    console.error("[production-order.post]", e);
    return failServer("过账生产/外协工单失败（事务已回滚，工单保持 SUBMITTED）");
  }
}
