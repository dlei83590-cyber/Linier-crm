import { Prisma } from "@prisma/client";

/** Sprint 4C - Sales Order 交付聚合回写（confirm-delivery 后调用；CTO Review 锁定）
 * 规则：
 *  - SalesOrderLine.deliveredQty = 所有 DELIVERED/COMPLETED DeliveryLine.quantity 合计（按 sourceSalesOrderLineId）
 *  - SalesOrderLine.remainingQty   = quantity - deliveredQty（Decimal 全程，禁止 toNumber）
 *  - SalesOrder 聚合：所有有效 SO Line remainingQty <= 0 → status=DELIVERED + deliveredAt=now；
 *    否则只要有 confirmed delivery → status=PARTIALLY_DELIVERED；
 *    不要根据 Delivery.status=READY/DISPATCHED 提前把 SO 标成部分交付（本函数只在 confirm 后调用）。
 */

export interface SalesOrderDeliveryAggregation {
  soStatus: "PARTIALLY_DELIVERED" | "DELIVERED" | "CONFIRMED";
  allFulfilled: boolean;
  lineProjections: Array<{ salesOrderLineId: string; deliveredQty: string; remainingQty: string }>;
}

/** 回写全部有效 SO Line 的 deliveredQty/remainingQty + 聚合 SO 状态（事务内调用；调用方需已锁 SalesOrder） */
export async function recalcSalesOrderDeliveryProjections(
  tx: Prisma.TransactionClient,
  salesOrderId: string,
  actorId?: string | null,
): Promise<SalesOrderDeliveryAggregation> {
  const soLines = await tx.salesOrderLine.findMany({
    where: { salesOrderId, deletedAt: null },
    orderBy: { id: "asc" },
  });

  const lineProjections: SalesOrderDeliveryAggregation["lineProjections"] = [];
  let allFulfilled = true;
  let hasConfirmed = false;

  for (const line of soLines) {
    // deliveredQty = 所有 DELIVERED/COMPLETED DeliveryLine.quantity 合计（按 sourceSalesOrderLineId）
    const agg = await tx.deliveryLine.aggregate({
      where: {
        sourceSalesOrderLineId: line.id,
        deletedAt: null,
        delivery: { status: { in: ["DELIVERED", "COMPLETED"] }, deletedAt: null },
      },
      _sum: { quantity: true },
    });
    const deliveredQty = agg._sum.quantity ?? new Prisma.Decimal(0);
    const remainingQty = line.quantity.minus(deliveredQty);
    await tx.salesOrderLine.update({
      where: { id: line.id },
      data: {
        deliveredQty,
        remainingQty,
        version: { increment: 1 },
        updatedById: actorId ?? null,
      },
    });
    lineProjections.push({
      salesOrderLineId: line.id,
      deliveredQty: deliveredQty.toString(),
      remainingQty: remainingQty.toString(),
    });
    if (deliveredQty.greaterThan(0)) hasConfirmed = true;
    if (remainingQty.greaterThan(0)) allFulfilled = false;
  }

  // 聚合 SO：全部行 fulfilled 且至少有 confirmed → DELIVERED；否则有 confirmed → PARTIALLY_DELIVERED；
  // 无任何 confirmed（全部反签收/删除 → deliveredQty 归零）→ CONFIRMED（订单返回未发货状态，用户指令 2026-08-21）
  if (allFulfilled && hasConfirmed) {
    await tx.salesOrder.update({
      where: { id: salesOrderId },
      data: {
        status: "DELIVERED",
        deliveredAt: new Date(),
        version: { increment: 1 },
        updatedById: actorId ?? null,
      },
    });
    return { soStatus: "DELIVERED", allFulfilled: true, lineProjections };
  }
  if (hasConfirmed) {
    await tx.salesOrder.update({
      where: { id: salesOrderId },
      data: {
        status: "PARTIALLY_DELIVERED",
        deliveredAt: null,
        version: { increment: 1 },
        updatedById: actorId ?? null,
      },
    });
    return { soStatus: "PARTIALLY_DELIVERED", allFulfilled: false, lineProjections };
  }
  // 无 confirmed（反签收/删除后 deliveredQty 归零）→ 回 CONFIRMED（未发货）
  await tx.salesOrder.update({
    where: { id: salesOrderId },
    data: {
      status: "CONFIRMED",
      deliveredAt: null,
      version: { increment: 1 },
      updatedById: actorId ?? null,
    },
  });
  return { soStatus: "CONFIRMED", allFulfilled: false, lineProjections };
}
