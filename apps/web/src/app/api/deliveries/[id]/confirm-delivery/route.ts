import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound, fail } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { deliveryConfirmSchema } from "@/lib/api/schemas";
import { computeDeliveryAllocation, createDeliveryRevision, createDeliverySnapshot, latestDeliveryRevisionNo } from "@/lib/delivery/helpers";
import { publishDeliveryEvent } from "@/lib/delivery/events";
import { recalcSalesOrderDeliveryProjections } from "@/lib/sales-order/delivery-aggregation";
import { publishSalesOrderEvent } from "@/lib/sales-order/events";
import { writeOrderStageChangedEvent } from "@/lib/dingtalk/events";

export const dynamic = "force-dynamic";

/** POD 门禁允许状态（CTO Review ⑦：RECEIVED 已签收 / WAIVED 豁免；PENDING 禁止 confirm） */
const POD_ALLOWED_STATUSES = ["RECEIVED", "WAIVED"] as const;

/**
 * POST /api/deliveries/:id/confirm-delivery（DISPATCHED → DELIVERED；客户确认收货 = 业务确认动作，CTO Review ⑥）
 * Phase 4 最关键事务（用户锁定 12 步固定顺序）：
 *  1. FOR UPDATE 锁 Delivery
 *  2. FOR UPDATE 锁 SalesOrder
 *  3. 按稳定顺序（id ASC）锁本 Delivery 涉及的全部 SalesOrderLine（防多 Delivery 并发死锁）
 *  4. 再次检查每条 DeliveryLine quantity
 *  5. 重新聚合 confirmed delivered quantity（排除本 Delivery 自身后校验不超交）
 *  6. 更新 Delivery.status = DELIVERED
 *  7. 写 deliveredAt（SalesOrder 聚合时写）/ POD 投影（podStatus/podReceivedAt/podConfirmedById）
 *  8. 创建 DeliverySnapshot(DELIVERED)（Decimal toString）
 *  9. 对每个 SalesOrderLine 回写 deliveredQty / remainingQty
 *  10. 聚合整个 SalesOrder（全部行 remainingQty<=0 → DELIVERED+deliveredAt；否则有 confirmed → PARTIALLY_DELIVERED）
 *  11. 写 AuditLog（事务外，与现有模式一致）
 *  12. 发布 Domain Events（DeliveryConfirmed + SalesOrderPartiallyDelivered / SalesOrderDelivered）
 * Migration 0055（合同收口）：confirm-delivery 事务内，若客户配置 collaborationChannelKey →
 *   同事务写 ORDER_STAGE_CHANGED（stage=PARTIALLY_DELIVERED/DELIVERED）Outbox → DingTalk 酷卡片推送协同群。
 * 本阶段不实现 /complete（COMPLETED 仅枚举，CTO Review ⑨）。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "delivery:approve");
  if (denied) return denied;
  requestLog(request, user?.id, "delivery.confirm-delivery");

  const { id } = await params;
  const parsed = deliveryConfirmSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { podStatus: requestedPodStatus, podReceivedAt, changeReason } = parsed.data;
  const meta = requestMeta(request);

  const result = await prisma.$transaction(async (tx) => {
    // ── 1. FOR UPDATE 锁 Delivery ──────────────────────────────────────────
    const lockedDelivery = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "Delivery" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
    );
    if (lockedDelivery.length === 0) return { error: "NOT_FOUND" as const };

    const delivery = await tx.delivery.findFirst({
      where: { id, deletedAt: null },
      include: { lines: { where: { deletedAt: null }, orderBy: { lineNo: "asc" } } },
    });
    if (!delivery) return { error: "NOT_FOUND" as const };
    if (delivery.status !== "DISPATCHED") return { error: "INVALID_STATE" as const, status: delivery.status };

    // ── 2. FOR UPDATE 锁 SalesOrder（聚合目标，防 SO 级并发） ──────────────
    const lockedSo = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "SalesOrder" WHERE "id" = ${delivery.salesOrderId} AND "deletedAt" IS NULL FOR UPDATE`,
    );
    if (lockedSo.length === 0) return { error: "SO_NOT_FOUND" as const };
    const salesOrder = await tx.salesOrder.findFirst({ where: { id: delivery.salesOrderId, deletedAt: null } });
    if (!salesOrder) return { error: "SO_NOT_FOUND" as const };

    // ── POD 门禁：请求可显式传入 RECEIVED/WAIVED（RECEIVED 时回填签收投影）；否则用当前值；PENDING → 409 ──
    const podStatus = requestedPodStatus ?? delivery.podStatus;
    if ((POD_ALLOWED_STATUSES as readonly string[]).includes(podStatus) === false) {
      return { error: "POD_PENDING" as const, podStatus: delivery.podStatus };
    }

    // ── 3. 按稳定顺序（id ASC）锁本 Delivery 涉及的全部 SalesOrderLine（防死锁） ──
    const sourceIds = [
      ...new Set(delivery.lines.map((l) => l.sourceSalesOrderLineId).filter((v): v is string => !!v)),
    ].sort();
    for (const sourceId of sourceIds) {
      const lockedLine = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "SalesOrderLine" WHERE "id" = ${sourceId} AND "deletedAt" IS NULL FOR UPDATE`,
      );
      if (lockedLine.length === 0) return { error: "SOURCE_LINE_INVALID" as const, lineId: sourceId };
    }

    // ── 4. 再次检查每条 DeliveryLine quantity > 0 + 源行有效 ─────────────────
    for (const line of delivery.lines) {
      if (line.quantity.lte(0)) return { error: "INVALID_LINE_QTY" as const, lineId: line.id };
      if (!line.sourceSalesOrderLineId) return { error: "SOURCE_LINE_INVALID" as const, lineId: line.id };
    }

    // ── 5. 重新聚合 confirmed delivered quantity（排除本 Delivery 自身行后校验不超交） ──
    for (const sourceId of sourceIds) {
      const alloc = await computeDeliveryAllocation(tx, sourceId, undefined, id);
      if (!alloc) return { error: "SOURCE_LINE_INVALID" as const, lineId: sourceId };
      const selfQty = delivery.lines
        .filter((l) => l.sourceSalesOrderLineId === sourceId)
        .reduce((s, l) => s.plus(l.quantity), new Prisma.Decimal(0));
      if (selfQty.greaterThan(alloc.availableQty)) {
        return {
          error: "QUANTITY_EXCEEDED" as const,
          lineId: sourceId,
          requested: selfQty.toString(),
          availableQty: alloc.availableQty.toString(),
        };
      }
    }

    // ── 6. 更新 Delivery.status = DELIVERED ────────────────────────────────
    // ── 7. POD 投影回填（podStatus/podReceivedAt/podConfirmedById；RECEIVED 时写签收时间/确认人）──
    //    注：Delivery 无 deliveredAt 列（Schema 未含），实际交付完成时间由 SalesOrder.deliveredAt 承载（步骤 10 聚合写）
    const podReceivedAtValue = podReceivedAt ? new Date(podReceivedAt) : new Date();
    const updated = await tx.delivery.update({
      where: { id },
      data: {
        status: "DELIVERED",
        podStatus,
        ...(podStatus === "RECEIVED"
          ? { podReceivedAt: podReceivedAtValue, podConfirmedById: user!.id }
          : {}),
        version: { increment: 1 },
        updatedById: user!.id,
      },
    });

    // ── 8. Revision + 创建 DeliverySnapshot(DELIVERED)（Decimal 一律 toString） ──
    //     先创建 DeliveryRevision 递增 revisionNo——反签收后再确认时 DELIVERED 快照需新 revisionNo（0046 唯一约束）
    await createDeliveryRevision(tx, id, changeReason ?? "确认收货", { status: "DELIVERED", podStatus }, user?.id);
    const revisionNo = await latestDeliveryRevisionNo(tx, id);
    await createDeliverySnapshot(
      tx,
      id,
      "DELIVERED",
      revisionNo,
      {
        status: "DELIVERED",
        deliveredAt: new Date().toISOString(),
        confirmedBy: user?.id,
        podStatus,
        podReceivedAt: podStatus === "RECEIVED" ? podReceivedAtValue.toISOString() : null,
        lines: delivery.lines.map((l) => ({
          lineId: l.id,
          sourceSalesOrderLineId: l.sourceSalesOrderLineId,
          lineNo: l.lineNo,
          quantity: l.quantity.toString(),
          orderedQty: l.orderedQty.toString(),
          deliveredQty: l.deliveredQty.toString(),
        })),
      },
      user?.id,
    );

    // ── 9+10. 回写全部有效 SO Line 投影 + 聚合整个 SalesOrder ──────────────
    //   deliveredQty = 所有 DELIVERED/COMPLETED DeliveryLine 合计；remainingQty = quantity - deliveredQty
    //   所有行 remainingQty<=0 → SO=DELIVERED + deliveredAt=now；否则有 confirmed → SO=PARTIALLY_DELIVERED
    const aggregation = await recalcSalesOrderDeliveryProjections(tx, delivery.salesOrderId, user?.id);
    const soAfter = await tx.salesOrder.findFirst({ where: { id: delivery.salesOrderId } });

    // Migration 0055：客户配置协同群 → 同事务写 ORDER_STAGE_CHANGED（聚合后 SO 阶段）Outbox（外部失败不影响收货事务）
    if (salesOrder.customerId) {
      const customer = await tx.businessPartner.findFirst({
        where: { id: salesOrder.customerId, deletedAt: null },
        select: { name: true, collaborationChannelKey: true },
      });
      if (customer?.collaborationChannelKey) {
        const owner = salesOrder.createdById
          ? await tx.user.findUnique({ where: { id: salesOrder.createdById }, select: { name: true } })
          : null;
        await writeOrderStageChangedEvent(tx, {
          salesOrderId: salesOrder.id,
          salesOrderCode: salesOrder.code,
          customerId: salesOrder.customerId,
          customerName: customer.name,
          stage: aggregation.soStatus,
          stageLabel: aggregation.soStatus === "DELIVERED" ? "已交付" : "部分交付",
          totalAmount: salesOrder.totalAmount.toString(),
          currency: salesOrder.currency,
          updatedAt: new Date().toISOString(),
          ownerId: salesOrder.createdById ?? null,
          ownerName: owner?.name ?? null,
          channelKey: customer.collaborationChannelKey,
        });
      }
    }

    return { delivery: updated, salesOrder, soAfter, aggregation };
  });

  if ("error" in result) {
    switch (result.error) {
      case "NOT_FOUND":
        return failNotFound(ERROR_CODES.DELIVERY_NOT_FOUND, "交付单不存在");
      case "SO_NOT_FOUND":
        return failNotFound(ERROR_CODES.SALES_ORDER_NOT_FOUND, "来源销售订单不存在");
      case "INVALID_STATE":
        return failConflict(ERROR_CODES.DELIVERY_INVALID_STATE, `仅 DISPATCHED 状态可确认收货（当前 ${result.status}）`);
      case "POD_PENDING":
        return failConflict(
          ERROR_CODES.DELIVERY_INVALID_STATE,
          `POD 未确认（当前 ${result.podStatus}），需 podStatus ∈ {RECEIVED, WAIVED} 才能确认收货`,
        );
      case "SOURCE_LINE_INVALID":
        return fail(ERROR_CODES.DELIVERY_SOURCE_LINE_INVALID, "交付行来源销售订单行无效或已删除", 400, { lineId: result.lineId });
      case "INVALID_LINE_QTY":
        return failConflict(ERROR_CODES.DELIVERY_INVALID_STATE, "交付行数量必须大于 0");
      case "QUANTITY_EXCEEDED":
        return failConflict(
          ERROR_CODES.DELIVERY_QUANTITY_EXCEEDED,
          `交付数量超过可交付量（请求 ${result.requested}，availableQty ${result.availableQty}），禁止超交`,
        );
    }
  }

  // ── 11+12. 事件 + 审计（事务外，与现有模式一致；事件失败不阻断） ──────────
  try {
    await publishDeliveryEvent({
      eventType: "DeliveryConfirmed",
      actorId: user?.id,
      entityId: id,
      payload: {
        deliveryId: id,
        deliveryCode: result.delivery.code,
        salesOrderId: result.delivery.salesOrderId,
        customerId: result.delivery.customerId,
        podStatus: result.delivery.podStatus,
        changeReason: changeReason ?? "交付确认收货",
      },
      meta,
    });
    await publishSalesOrderEvent({
      eventType:
        result.aggregation.soStatus === "DELIVERED" ? "SalesOrderDelivered" : "SalesOrderPartiallyDelivered",
      actorId: user?.id,
      entityId: result.salesOrder.id,
      payload: {
        salesOrderId: result.salesOrder.id,
        salesOrderCode: result.salesOrder.code,
        quotationId: result.salesOrder.quotationId,
        customerId: result.salesOrder.customerId,
        projectId: result.salesOrder.projectId,
        currency: result.salesOrder.currency,
        totalAmount: result.soAfter?.totalAmount,
        deliveryId: id,
        deliveryCode: result.delivery.code,
        soStatus: result.aggregation.soStatus,
      },
      meta,
    });
    await writeAuditLog({
      actorId: user?.id,
      action: "delivery.confirm-delivery",
      entityType: "delivery",
      entityId: id,
      afterData: {
        status: "DELIVERED",
        podStatus: result.delivery.podStatus,
        soStatus: result.aggregation.soStatus,
        lineProjections: result.aggregation.lineProjections,
      },
      ...meta,
    });
  } catch {
    // 事件/审计失败不阻断主流程
  }

  return ok({
    id,
    status: "DELIVERED",
    podStatus: result.delivery.podStatus,
    salesOrder: {
      id: result.salesOrder.id,
      status: result.soAfter?.status,
      deliveredAt: result.soAfter?.deliveredAt,
    },
  });
}
