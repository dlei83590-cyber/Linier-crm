import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { deliveryCancelSchema } from "@/lib/api/schemas";
import { createDeliverySnapshot, latestDeliveryRevisionNo } from "@/lib/delivery/helpers";
import { publishDeliveryEvent } from "@/lib/delivery/events";

export const dynamic = "force-dynamic";

/** 可取消状态（DRAFT/READY；DISPATCHED+ 禁止——已进入物流/交付环节不允许取消，CTO Review ⑧） */
const CANCELLABLE_STATUSES = ["DRAFT", "READY"] as const;

/**
 * POST /api/deliveries/:id/cancel（DRAFT/READY → CANCELLED）
 * 取消 DRAFT/READY 交付**不回滚 deliveredQty**（这些状态本就没进入实际交付累计）；
 * 也不需要写 SalesOrderLine 投影——CANCELLED 不在 open 占用集合，其他 Delivery 的
 * allocation 会在下次事务动态计算时自动释放（CTO Review：取消后重查可用量即可）。
 * 成功：status=CANCELLED + DeliverySnapshot(CANCELLED) + 发布 DeliveryCancelled。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "delivery:close");
  if (denied) return denied;
  requestLog(request, user?.id, "delivery.cancel");

  const { id } = await params;
  const parsed = deliveryCancelSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { changeReason } = parsed.data;
  const meta = requestMeta(request);

  const result = await prisma.$transaction(async (tx) => {
    // ① 真实行锁：锁定 Delivery，串行化同一交付单的并发 cancel
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "Delivery" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
    );
    if (locked.length === 0) return { error: "NOT_FOUND" as const };

    const delivery = await tx.delivery.findFirst({ where: { id, deletedAt: null } });
    if (!delivery) return { error: "NOT_FOUND" as const };
    if ((CANCELLABLE_STATUSES as readonly string[]).includes(delivery.status) === false) {
      return { error: "INVALID_STATE" as const, status: delivery.status };
    }

    // ② 更新 status=CANCELLED（不回滚 deliveredQty、不写 SO Line 投影）
    const saved = await tx.delivery.update({
      where: { id },
      data: { status: "CANCELLED", version: { increment: 1 }, updatedById: user!.id },
    });

    // ③ 固化 CANCELLED 快照
    const revisionNo = await latestDeliveryRevisionNo(tx, id);
    await createDeliverySnapshot(
      tx,
      id,
      "CANCELLED",
      revisionNo,
      {
        status: "CANCELLED",
        cancelledAt: new Date().toISOString(),
        cancelledBy: user?.id,
        changeReason: changeReason ?? "交付单取消",
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
        return failConflict(
          ERROR_CODES.DELIVERY_INVALID_STATE,
          `仅 DRAFT/READY 状态可取消（当前 ${result.status}；DISPATCHED 及以后禁止取消）`,
        );
    }
  }

  await publishDeliveryEvent({
    eventType: "DeliveryCancelled",
    actorId: user?.id,
    entityId: id,
    payload: {
      deliveryId: id,
      deliveryCode: result.delivery.code,
      salesOrderId: result.delivery.salesOrderId,
      customerId: result.delivery.customerId,
      changeReason: changeReason ?? "交付单取消",
    },
    meta,
  });
  await writeAuditLog({
    actorId: user?.id,
    action: "delivery.cancel",
    entityType: "delivery",
    entityId: id,
    afterData: { status: "CANCELLED" },
    ...meta,
  });

  return ok({ id, status: "CANCELLED" });
}
