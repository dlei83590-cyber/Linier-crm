import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { casUpdate } from "@/lib/api/cas";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { deliveryUpdateSchema } from "@/lib/api/schemas";
import { createDeliveryRevision } from "@/lib/delivery/helpers";
import { publishDeliveryEvent } from "@/lib/delivery/events";

export const dynamic = "force-dynamic";

const EDITABLE_STATUSES = ["DRAFT"] as const;

/** GET /api/deliveries/:id（详情含 lines/revisions/snapshots + customer/salesOrder 摘要） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "delivery:view");
  if (denied) return denied;
  requestLog(request, user?.id, "delivery.get");

  const { id } = await params;
  const delivery = await prisma.delivery.findFirst({
    where: { id, deletedAt: null },
    include: {
      customer: { select: { id: true, code: true, name: true } },
      salesOrder: { select: { id: true, code: true, status: true } },
      lines: {
        where: { deletedAt: null },
        orderBy: { lineNo: "asc" },
        include: {
          item: { select: { id: true, code: true, name: true, model: true } },
          uom: { select: { id: true, code: true, name: true } },
          sourceSalesOrderLine: { select: { id: true, lineNo: true, quantity: true } },
        },
      },
      revisions: { where: { deletedAt: null }, orderBy: { revisionNo: "desc" } },
      snapshots: { where: { deletedAt: null }, orderBy: { generatedAt: "desc" } },
    },
  });
  if (!delivery) return failNotFound(ERROR_CODES.DELIVERY_NOT_FOUND, "交付单不存在");

  return ok(delivery);
}

/**
 * PATCH /api/deliveries/:id（更新头，仅 DRAFT；乐观锁 version）
 * CTO 锁定项⑧：READY 后行彻底冻结（不支持重新 ready，错误 → cancel → 新建）；
 * 头字段（交付日期/预计到达/承运方/运单号/备注）在 DRAFT 内可维护，变更自动生成 DeliveryRevision。
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "delivery:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "delivery.update");

  const { id } = await params;
  const parsed = deliveryUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version, changeReason, ...fields } = parsed.data;
  const meta = requestMeta(request);

  const delivery = await prisma.delivery.findFirst({ where: { id, deletedAt: null } });
  if (!delivery) return failNotFound(ERROR_CODES.DELIVERY_NOT_FOUND, "交付单不存在");
  if ((EDITABLE_STATUSES as readonly string[]).includes(delivery.status) === false) {
    return failConflict(ERROR_CODES.DELIVERY_INVALID_STATE, "仅 DRAFT 状态可编辑（READY 后行冻结，错误需取消后新建）");
  }

  // A4-CAS：原子乐观锁置于事务首部（消除 read-check-update TOCTOU）
  const result = await prisma.$transaction(async (tx) => {
    const cas = await casUpdate(tx, "delivery", id, version, {
      ...(fields.deliveryDate !== undefined ? { deliveryDate: new Date(fields.deliveryDate) } : {}),
      ...(fields.expectedArrivalDate !== undefined
        ? { expectedArrivalDate: fields.expectedArrivalDate ? new Date(fields.expectedArrivalDate) : null }
        : {}),
      ...(fields.carrier !== undefined ? { carrier: fields.carrier } : {}),
      ...(fields.trackingNo !== undefined ? { trackingNo: fields.trackingNo } : {}),
      ...(fields.remark !== undefined ? { remark: fields.remark } : {}),
      updatedById: user!.id,
    });
    if (cas.outcome !== "OK") return cas;
    const saved = await tx.delivery.findFirst({ where: { id, deletedAt: null } });
    if (!saved) return { outcome: "NOT_FOUND" as const };
    await createDeliveryRevision(tx, id, changeReason ?? "更新交付单头", { delivery: saved }, user?.id);
    return { outcome: "OK" as const, delivery: saved };
  });
  if (result.outcome === "NOT_FOUND") return failNotFound(ERROR_CODES.DELIVERY_NOT_FOUND, "交付单不存在");
  if (result.outcome === "CONFLICT") return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  const updated = result.delivery;

  await publishDeliveryEvent({
    eventType: "DeliveryUpdated",
    actorId: user?.id,
    entityId: id,
    payload: {
      deliveryId: id,
      deliveryCode: updated.code,
      salesOrderId: updated.salesOrderId,
      customerId: updated.customerId,
      changeReason: changeReason ?? "更新交付单头",
    },
    meta,
  });
  await writeAuditLog({
    actorId: user?.id,
    action: "delivery.update",
    entityType: "delivery",
    entityId: id,
    afterData: { fields: Object.keys(fields), version: updated.version },
    ...meta,
  });

  return ok(updated);
}
