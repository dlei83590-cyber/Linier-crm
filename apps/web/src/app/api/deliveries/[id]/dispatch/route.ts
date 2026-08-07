import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { deliveryDispatchSchema } from "@/lib/api/schemas";
import { createDeliverySnapshot, latestDeliveryRevisionNo } from "@/lib/delivery/helpers";
import { publishDeliveryEvent } from "@/lib/delivery/events";

export const dynamic = "force-dynamic";

/**
 * POST /api/deliveries/:id/dispatch（READY → DISPATCHED；已出库/运输中）
 * 可同时更新物流信息：carrier / trackingNo / expectedArrivalDate。
 * 生成 DeliverySnapshot(DISPATCHED)；**不增加 deliveredQty**（发运 ≠ 客户收货，CTO Review ⑥）。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "delivery:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "delivery.dispatch");

  const { id } = await params;
  const parsed = deliveryDispatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { changeReason, ...fields } = parsed.data;
  const meta = requestMeta(request);

  const result = await prisma.$transaction(async (tx) => {
    // ① 真实行锁：锁定 Delivery，串行化同一交付单的并发 dispatch
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "Delivery" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
    );
    if (locked.length === 0) return { error: "NOT_FOUND" as const };

    const delivery = await tx.delivery.findFirst({ where: { id, deletedAt: null } });
    if (!delivery) return { error: "NOT_FOUND" as const };
    if (delivery.status !== "READY") return { error: "INVALID_STATE" as const };

    // ② 更新 status=DISPATCHED + 可选物流信息（deliveredQty 不动：发运不等于收货）
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
    });

    // ③ 固化 DISPATCHED 快照
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
        carrier: saved.carrier,
        trackingNo: saved.trackingNo,
        expectedArrivalDate: saved.expectedArrivalDate?.toISOString() ?? null,
      },
      user?.id,
    );

    return { delivery: saved };
  });

  if ("error" in result) {
    switch (result.error) {
      case "NOT_FOUND":
        return failNotFound(ERROR_CODES.DELIVERY_NOT_FOUND, "交付单不存在");
      case "INVALID_STATE":
        return failConflict(ERROR_CODES.DELIVERY_INVALID_STATE, "仅 READY 状态可执行 dispatch");
    }
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
      changeReason: changeReason ?? "交付单发运",
    },
    meta,
  });
  await writeAuditLog({
    actorId: user?.id,
    action: "delivery.dispatch",
    entityType: "delivery",
    entityId: id,
    afterData: { status: "DISPATCHED", fields: Object.keys(fields) },
    ...meta,
  });

  return ok({ id, status: "DISPATCHED" });
}
