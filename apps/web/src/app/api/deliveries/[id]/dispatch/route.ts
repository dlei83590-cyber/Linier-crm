import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, fail, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { deliveryDispatchSchema } from "@/lib/api/schemas";
import { createDeliverySnapshot, latestDeliveryRevisionNo } from "@/lib/delivery/helpers";
import { buildSalesDeliveryOutboundAtoms } from "@/lib/delivery/outbound-ledger";
import {
  executeLedgerAtoms,
  InventoryInsufficientStockError,
  InventoryLedgerIdempotencyConflictError,
} from "@/lib/inventory-ledger/ledger-command";
import { publishDeliveryEvent } from "@/lib/delivery/events";
import { writeOrderStageChangedEvent } from "@/lib/dingtalk/events";

export const dynamic = "force-dynamic";

/**
 * POST /api/deliveries/:id/dispatch（READY → DISPATCHED；已出库/运输中）
 *
 * 合同收口-销售出库（最高风险线）：**DISPATCH 服务端事务内登记销售出库库存事实，不能再用
 * "Delivery 状态变化"冒充出库**——
 *  1. FOR UPDATE 锁 Delivery（串行化并发 dispatch）→ status 必须 = READY
 *  2. 校验出库仓库（warehouseId 必填；locationId 可选且必须属于该仓库——组合 FK 语义）
 *  3. 加载全部有效 DeliveryLine；非物料行（itemId=null）无库存效应跳过；物料行 quantity > 0
 *  4. 构造 SALES_DELIVERY OUT 原子（五元幂等 sourceType|delivery.id|line.id|OUT|BULK；
 *     movementGroupId=delivery.id 稳定编组）→ **executeLedgerAtoms(tx, atoms) 同一 caller 事务**
 *     （共享 InventoryLedgerCommand Core：五维 Projection FOR UPDATE 锁 + OUT 禁负库存 +
 *     INSERT InventoryMovement + UPSERT StockProjection；applyOutboundCost/GL COGS 由 Core 既有链路处理）
 *  5. 全部成功 → status=DISPATCHED + DISPATCHED 快照（同一事务，全有或全无）
 *
 * 错误语义：
 *  - 库存不足 → 409 INVENTORY_INSUFFICIENT_STOCK（InventoryInsufficientStockError；事务回滚，单据保持 READY）
 *  - 幂等 immutable-fact 冲突 → 409（InventoryLedgerIdempotencyConflictError；重复请求 payload 不一致）
 *  - 重复 dispatch（已 DISPATCHED）→ 409 DELIVERY_INVALID_STATE
 *  - 仓库/库位无效 → 400 VALIDATION_ERROR（仓库维度是出库事实的 canonical 输入；复用注册码不新增）
 *
 * 可同时更新物流信息：carrier / trackingNo / expectedArrivalDate。
 * 生成 DeliverySnapshot(DISPATCHED)；**不增加 deliveredQty**（发运 ≠ 客户收货，CTO Review ⑥）。
 * Migration 0055（合同收口）：dispatch 事务内，若客户配置 collaborationChannelKey →
 *   同事务写 ORDER_STAGE_CHANGED（stage=DISPATCHED）Outbox → DingTalk 酷卡片推送协同群。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "delivery:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "delivery.dispatch");

  const { id } = await params;
  const parsed = deliveryDispatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { changeReason, warehouseId, locationId, ...fields } = parsed.data;
  const meta = requestMeta(request);

  let result:
    | { ok: true; delivery: { id: string; code: string; salesOrderId: string; customerId: string; status: string; carrier: string | null; trackingNo: string | null }; atomResults: Array<{ inserted: boolean; movementNo: string }> }
    | { ok: false; error: string; status: number; message: string }
    | undefined;

  try {
    result = await prisma.$transaction(async (tx) => {
      // ① 真实行锁：锁定 Delivery，串行化同一交付单的并发 dispatch
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "Delivery" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
      );
      if (locked.length === 0) return { ok: false as const, error: "NOT_FOUND", status: 404, message: "交付单不存在" };

      const delivery = await tx.delivery.findFirst({ where: { id, deletedAt: null } });
      if (!delivery) return { ok: false as const, error: "NOT_FOUND", status: 404, message: "交付单不存在" };
      if (delivery.status !== "READY") {
        return {
          ok: false as const,
          error: "INVALID_STATE",
          status: 409,
          message: `仅 READY 状态可执行 dispatch（当前 ${delivery.status}；重复发运/状态不合法，幂等拒绝）`,
        };
      }

      // ② 出库仓库/库位校验（仓库维度是出库事实 canonical 输入；location 必须属于同一 warehouse）
      const warehouse = await tx.warehouse.findFirst({ where: { id: warehouseId, deletedAt: null, isActive: true } });
      if (!warehouse) {
        return { ok: false as const, error: "WAREHOUSE_INVALID", status: 400, message: "出库仓库不存在或已停用" };
      }
      if (locationId) {
        const location = await tx.warehouseLocation.findFirst({
          where: { id: locationId, warehouseId, deletedAt: null, isActive: true },
        });
        if (!location) {
          return { ok: false as const, error: "LOCATION_INVALID", status: 400, message: "出库库位不存在、停用或不属于该仓库" };
        }
      }

      // ③ 加载全部有效 DeliveryLine；物料行校验（quantity > 0）
      const lines = await tx.deliveryLine.findMany({
        where: { deliveryId: id, deletedAt: null },
        orderBy: { lineNo: "asc" },
        select: { id: true, itemId: true, quantity: true, uomId: true },
      });
      const materialLines = lines.filter((l) => l.itemId != null);
      for (const l of materialLines) {
        if (l.quantity.lte(0)) {
          return { ok: false as const, error: "QUANTITY_INVALID", status: 400, message: `交付行 ${l.id} 数量必须 > 0` };
        }
      }

      // ④ 构造 SALES_DELIVERY OUT 原子 + 共享 Core 同事务执行（全有或全无）
      const atoms = buildSalesDeliveryOutboundAtoms(
        {
          deliveryId: delivery.id,
          deliveryCode: delivery.code,
          warehouseId,
          locationId: locationId ?? null,
          actorId: user!.id,
          occurredAt: new Date().toISOString(),
        },
        materialLines,
      );
      const atomResults = await executeLedgerAtoms(tx, atoms);

      // ⑤ 更新 status=DISPATCHED + 可选物流信息（deliveredQty 不动：发运不等于收货）
      const saved = await tx.delivery.update({
        where: { id },
        data: {
          status: "DISPATCHED",
          ...(fields.carrier !== undefined ? { carrier: fields.carrier } : {}),
          ...(fields.trackingNo !== undefined ? { trackingNo: fields.trackingNo } : {}),
          ...(fields.expectedArrivalDate !== undefined
            ? { expectedArrivalDate: fields.expectedArrivalDate ? new Date(fields.expectedArrivalDate) : null }
            : {}),
          version: { increment: 1 },
          updatedById: user!.id,
        },
        select: { id: true, code: true, salesOrderId: true, customerId: true, status: true, carrier: true, trackingNo: true },
      });

      // ⑥ 固化 DISPATCHED 快照（含出库仓库/库位证据 + 出库原子结果）
      const revisionNo = await latestDeliveryRevisionNo(tx, id);
      await createDeliverySnapshot(
        tx,
        id,
        "DISPATCHED",
        revisionNo,
        {
          status: "DISPATCHED",
          dispatchedAt: new Date().toISOString(),
          dispatchedBy: user?.id,
          warehouseId,
          locationId: locationId ?? null,
          outboundAtoms: atomResults.map((r) => ({ inserted: r.inserted, movementNo: r.movementNo })),
          carrier: saved.carrier,
          trackingNo: saved.trackingNo,
          expectedArrivalDate: fields.expectedArrivalDate ?? null,
        },
        user?.id,
      );

      // ⑦（Migration 0055）客户配置协同群 → 同事务写 ORDER_STAGE_CHANGED（DISPATCHED）Outbox（外部失败不影响发运事务）
      const so = saved.salesOrderId
        ? await tx.salesOrder.findFirst({
            where: { id: saved.salesOrderId, deletedAt: null },
            select: { id: true, code: true, customerId: true, totalAmount: true, currency: true, createdById: true },
          })
        : null;
      if (so) {
        const customer = await tx.businessPartner.findFirst({
          where: { id: so.customerId, deletedAt: null },
          select: { name: true, collaborationChannelKey: true },
        });
        if (customer?.collaborationChannelKey) {
          const owner = so.createdById
            ? await tx.user.findUnique({ where: { id: so.createdById }, select: { name: true } })
            : null;
          await writeOrderStageChangedEvent(tx, {
            salesOrderId: so.id,
            salesOrderCode: so.code,
            customerId: so.customerId,
            customerName: customer.name,
            stage: "DISPATCHED",
            stageLabel: "已发运",
            totalAmount: so.totalAmount.toString(),
            currency: so.currency,
            updatedAt: new Date().toISOString(),
            ownerId: so.createdById ?? null,
            ownerName: owner?.name ?? null,
            channelKey: customer.collaborationChannelKey,
          });
        }
      }

      return { ok: true as const, delivery: saved, atomResults };
    });
  } catch (err) {
    // 业务失败（库存不足 / 幂等 immutable-fact 冲突）→ 409；技术失败 → 500（事务已回滚，单据保持 READY）
    if (err instanceof InventoryInsufficientStockError) {
      return fail(ERROR_CODES.INVENTORY_INSUFFICIENT_STOCK, err.message, 409);
    }
    if (err instanceof InventoryLedgerIdempotencyConflictError) {
      return fail(ERROR_CODES.DELIVERY_INVALID_STATE, `出库幂等冲突：${err.message}`, 409);
    }
    console.error("[delivery.dispatch]", err);
    return fail(ERROR_CODES.INTERNAL_ERROR, "发运失败（事务已回滚，单据保持 READY）", 500);
  }

  if ("error" in result) {
    switch (result.error) {
      case "NOT_FOUND":
        return failNotFound(ERROR_CODES.DELIVERY_NOT_FOUND, "交付单不存在");
      case "INVALID_STATE":
        return failConflict(ERROR_CODES.DELIVERY_INVALID_STATE, "仅 READY 状态可执行 dispatch");
    }
  }

  if (!result || result.ok === false) {
    const entry = result && result.ok === false ? result : undefined;
    if (entry?.error === "NOT_FOUND") return failNotFound(ERROR_CODES.DELIVERY_NOT_FOUND, "交付单不存在");
    if (entry?.error === "INVALID_STATE") return failConflict(ERROR_CODES.DELIVERY_INVALID_STATE, entry.message);
    // 仓库/库位是出库事实的 canonical 输入：不存在/停用/不属于该仓库 → 400 VALIDATION_ERROR（复用注册码，不新增）
    if (entry?.error === "WAREHOUSE_INVALID") return fail(ERROR_CODES.VALIDATION_ERROR, entry.message, 400);
    if (entry?.error === "LOCATION_INVALID") return fail(ERROR_CODES.VALIDATION_ERROR, entry.message, 400);
    // 数量 ≤ 0 → 409 DELIVERY_INVALID_STATE（对齐 ready 的 INVALID_LINE_QTY 语义）
    if (entry?.error === "QUANTITY_INVALID") return failConflict(ERROR_CODES.DELIVERY_INVALID_STATE, entry.message);
    return fail(ERROR_CODES.INTERNAL_ERROR, "发运失败", 500);
  }

  await publishDeliveryEvent({
    eventType: "DeliveryDispatched",
    actorId: user?.id,
    entityId: id,
    payload: {
      deliveryId: id,
      deliveryCode: result.delivery.code,
      salesOrderId: result.delivery.salesOrderId,
      customerId: result.delivery.customerId,
      carrier: result.delivery.carrier,
      trackingNo: result.delivery.trackingNo,
      warehouseId,
      locationId: locationId ?? null,
      outboundAtomCount: result.atomResults.length,
      changeReason: changeReason ?? "交付单发运",
    },
    meta,
  });
  await writeAuditLog({
    actorId: user?.id,
    action: "delivery.dispatch",
    entityType: "delivery",
    entityId: id,
    afterData: {
      status: "DISPATCHED",
      warehouseId,
      locationId: locationId ?? null,
      outboundAtoms: result.atomResults.map((r) => ({ inserted: r.inserted, movementNo: r.movementNo })),
      fields: Object.keys(fields),
    },
    ...meta,
  });

  return ok({
    id,
    status: "DISPATCHED",
    outboundAtoms: result.atomResults.map((r) => ({ inserted: r.inserted, movementNo: r.movementNo })),
  });
}