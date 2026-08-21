import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { createDeliverySnapshot, latestDeliveryRevisionNo } from "@/lib/delivery/helpers";
import { publishDeliveryEvent } from "@/lib/delivery/events";
import { recalcSalesOrderDeliveryProjections } from "@/lib/sales-order/delivery-aggregation";
import { z } from "zod";

export const dynamic = "force-dynamic";

const unconfirmSchema = z.object({
  changeReason: z.string().max(500).optional(),
});

/**
 * POST /api/deliveries/:id/unconfirm —— 送货单反签收（DELIVERED → DISPATCHED；用户指令 2026-08-21）
 * 层层回退：发票红冲/删除后 → 送货单反签收（撤销确认收货）→ 可删除 → 订单回未发货
 * 事务链路（对齐 confirm-delivery 反向）：
 *  1. FOR UPDATE 锁 Delivery + 校验 status=DELIVERED
 *  2. 前置防御：该送货单无已 ISSUED 发票引用（有发票必须先红冲/删除——层层回退顺序 Gate）
 *  3. FOR UPDATE 锁 SalesOrder
 *  4. 状态回退：DELIVERED → DISPATCHED；POD 回退 PENDING（撤销签收投影）
 *  5. 创建 DeliverySnapshot(DELIVERED 回退留痕——用 DELIVERED snapshot 记录 unconfirm 事实，避免扩枚举)
 *  6. recalcSalesOrderDeliveryProjections（deliveredQty 重算 → SO 可能回 PARTIALLY_DELIVERED/CONFIRMED）
 *  7. 事件 + 审计（事务外）
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "delivery:approve");
  if (denied) return denied;
  requestLog(request, user?.id, "delivery.unconfirm");

  const { id } = await params;
  const parsed = unconfirmSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { changeReason } = parsed.data;
  const meta = requestMeta(request);

  const result = await prisma.$transaction(async (tx) => {
    // 1. 锁 Delivery
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "Delivery" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
    );
    if (locked.length === 0) return { error: "NOT_FOUND" as const };
    const delivery = await tx.delivery.findFirst({ where: { id, deletedAt: null } });
    if (!delivery) return { error: "NOT_FOUND" as const };
    if (delivery.status !== "DELIVERED") {
      return { error: "INVALID_STATE" as const, status: delivery.status };
    }

    // 2. 前置防御：无"未红冲"的已 ISSUED 蓝票引用（层层回退顺序 Gate：发票必须先红冲）
    //    红冲语义（用户指令 2026-08-21）：红字发票 ISSUE 后原票应收已回退（balanceAmount 归零/减少），
    //    视为已回退 → 允许反签收。红字发票本身（redLetter=true）不阻止。
    const issuedInvoices = await tx.invoice.findMany({
      where: { deliveryId: id, deletedAt: null, status: { in: ["ISSUED", "PARTIALLY_PAID", "PAID"] } },
      select: { id: true, redLetter: true },
    });
    const blueIds = issuedInvoices.filter((inv) => !inv.redLetter).map((inv) => inv.id);
    const reducedCount = blueIds.length > 0
      ? await tx.invoice.count({
          where: { redInvoiceRefId: { in: blueIds }, redLetter: true, deletedAt: null },
        })
      : 0;
    const unReduced = blueIds.length - reducedCount;
    if (unReduced > 0) {
      return { error: "INVOICE_REF_EXISTS" as const, count: unReduced };
    }

    // 3. 锁 SalesOrder
    const lockedSo = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "SalesOrder" WHERE "id" = ${delivery.salesOrderId} AND "deletedAt" IS NULL FOR UPDATE`,
    );
    if (lockedSo.length === 0) return { error: "SO_NOT_FOUND" as const };

    // 4. 状态回退 + POD 回退
    const updated = await tx.delivery.update({
      where: { id },
      data: {
        status: "DISPATCHED",
        podStatus: "PENDING",
        podReceivedAt: null,
        podConfirmedById: null,
        version: { increment: 1 },
        updatedById: user!.id,
      },
    });

    // 5. Snapshot 留痕（复用 DELIVERED 快照类型记录反签收事实；含 changeReason）
    const revisionNo = await latestDeliveryRevisionNo(tx, id);
    await createDeliverySnapshot(
      tx,
      id,
      "DELIVERED",
      revisionNo,
      {
        status: "UNCONFIRMED",
        previousStatus: "DELIVERED",
        unconfirmedAt: new Date().toISOString(),
        unconfirmedBy: user?.id,
        changeReason: changeReason ?? "送货单反签收",
      },
      user?.id,
    );

    // 6. 重算 SO 交付投影（deliveredQty 排除本单 → SO 状态回退）
    const aggregation = await recalcSalesOrderDeliveryProjections(tx, delivery.salesOrderId, user?.id);
    const soAfter = await tx.salesOrder.findFirst({ where: { id: delivery.salesOrderId } });

    return { delivery: updated, soAfter, aggregation };
  });

  if ("error" in result) {
    switch (result.error) {
      case "NOT_FOUND":
        return failNotFound(ERROR_CODES.DELIVERY_NOT_FOUND, "交付单不存在");
      case "SO_NOT_FOUND":
        return failNotFound(ERROR_CODES.SALES_ORDER_NOT_FOUND, "来源销售订单不存在");
      case "INVALID_STATE":
        return failConflict(ERROR_CODES.DELIVERY_INVALID_STATE, `仅 DELIVERED 状态可反签收（当前 ${result.status}）`);
      case "INVOICE_REF_EXISTS":
        return failConflict(ERROR_CODES.DELIVERY_INVALID_STATE, `送货单仍有 ${result.count} 张已开票发票引用，禁止反签收（请先红冲并删除发票）`);
    }
  }

  // 7. 事件 + 审计（事务外）
  try {
    await publishDeliveryEvent({
      eventType: "DeliveryUnconfirmed",
      actorId: user?.id,
      entityId: id,
      payload: {
        deliveryId: id,
        deliveryCode: result.delivery.code,
        salesOrderId: result.delivery.salesOrderId,
        customerId: result.delivery.customerId,
        changeReason: changeReason ?? "送货单反签收",
      },
      meta,
    });
    await writeAuditLog({
      actorId: user?.id,
      action: "delivery.unconfirm",
      entityType: "delivery",
      entityId: id,
      afterData: {
        status: "DISPATCHED",
        podStatus: "PENDING",
        soStatus: result.aggregation.soStatus,
        changeReason: changeReason ?? "送货单反签收",
      },
      ...meta,
    });
  } catch (e) {
    console.error("[delivery.unconfirm] event/audit failed", e);
  }

  return ok({ id, status: result.delivery.status, soStatus: result.aggregation.soStatus });
}
