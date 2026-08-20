import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { casUpdate } from "@/lib/api/cas";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound, fail } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { deliveryLineUpdateSchema } from "@/lib/api/schemas";
import { createDeliveryRevision, computeDeliveryAllocation } from "@/lib/delivery/helpers";
import { publishDeliveryEvent } from "@/lib/delivery/events";

export const dynamic = "force-dynamic";

const EDITABLE_STATUSES = ["DRAFT"] as const;

/**
 * PATCH /api/deliveries/:id/lines/:lineId（仅 DRAFT；乐观锁 version）
 * CTO Review ②防超交核心：事务内锁定 source SalesOrderLine（FOR UPDATE）→
 * confirmedDeliveredQty（DELIVERED/COMPLETED 累计）→ openDeliveryQty（其他 DRAFT/READY/DISPATCHED，
 * **排除当前 line**，避免旧 quantity 重复计入）→ availableQty = orderedQty - confirmed - open
 * → 校验 quantity <= availableQty（超出 → 409 DELIVERY_QUANTITY_EXCEEDED）→ 写行 → DeliveryRevision。
 * 本阶段不增加 SalesOrderLine.deliveredQty / remainingQty（仅 confirm-delivery 回写，锁定项）。
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; lineId: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "delivery-line:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "delivery-line.update");

  const { id, lineId } = await params;
  const parsed = deliveryLineUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version, changeReason, quantity, ...fields } = parsed.data;
  const meta = requestMeta(request);

  const delivery = await prisma.delivery.findFirst({ where: { id, deletedAt: null } });
  if (!delivery) return failNotFound(ERROR_CODES.DELIVERY_NOT_FOUND, "交付单不存在");
  if ((EDITABLE_STATUSES as readonly string[]).includes(delivery.status) === false) {
    return failConflict(ERROR_CODES.DELIVERY_INVALID_STATE, "仅 DRAFT 状态可编辑行（READY 后行冻结，错误需取消后新建）");
  }

  const line = await prisma.deliveryLine.findFirst({ where: { id: lineId, deliveryId: id, deletedAt: null } });
  if (!line) return failNotFound(ERROR_CODES.DELIVERY_LINE_NOT_FOUND, "交付行不存在");

  const nextQuantity = quantity !== undefined ? new Prisma.Decimal(quantity) : line.quantity;
  // 行编辑涉及数量 → 必须能溯源到销售订单行做防超交校验（SalesOrderLine 软删后 SetNull → 禁止改量）
  if (quantity !== undefined && !line.sourceSalesOrderLineId) {
    return fail(ERROR_CODES.DELIVERY_SOURCE_LINE_INVALID, "交付行来源销售订单行已失效，无法校验可交付量", 400);
  }

  let saved: unknown;
  try {
    saved = await prisma.$transaction(async (tx) => {
      // ① 锁定 source SalesOrderLine（FOR UPDATE），串行化同一订单行的并发分配
      if (line.sourceSalesOrderLineId) {
        const locked = await tx.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`SELECT "id" FROM "SalesOrderLine" WHERE "id" = ${line.sourceSalesOrderLineId} AND "deletedAt" IS NULL FOR UPDATE`,
        );
        if (locked.length === 0) {
          throw new Error("SOURCE_LINE_INVALID");
        }
      }

      // ② 动态计算可交付量（排除当前行：openDeliveryQty 不含自身旧 quantity）
      let exceeded: { requested: string; availableQty: string } | null = null;
      if (quantity !== undefined && line.sourceSalesOrderLineId) {
        const alloc = await computeDeliveryAllocation(tx, line.sourceSalesOrderLineId, lineId);
        if (!alloc) throw new Error("SOURCE_LINE_INVALID");
        if (nextQuantity.greaterThan(alloc.availableQty)) {
          exceeded = { requested: nextQuantity.toString(), availableQty: alloc.availableQty.toString() };
        }
      }
      if (exceeded) {
        throw new Error(
          `QUANTITY_EXCEEDED:${JSON.stringify(exceeded)}`,
        );
      }

      // ③ 更新行（A4-CAS：原子乐观锁；sourceSalesOrderLineId 溯源永不清除；deliveredQty/orderedQty 只读投影不动）
      const cas = await casUpdate(tx, "deliveryLine", lineId, version, {
        ...(fields.description !== undefined ? { description: fields.description } : {}),
        ...(fields.uomId !== undefined ? { uomId: fields.uomId } : {}),
        ...(fields.lineNo !== undefined ? { lineNo: fields.lineNo } : {}),
        ...(quantity !== undefined ? { quantity: nextQuantity } : {}),
        updatedById: user!.id,
      });
      if (cas.outcome !== "OK") {
        throw new Error(cas.outcome === "NOT_FOUND" ? "DELIVERY_LINE_NOT_FOUND" : "DELIVERY_LINE_VERSION_CONFLICT");
      }
      const updated = await tx.deliveryLine.findFirst({ where: { id: lineId, deletedAt: null } });
      if (!updated) throw new Error("DELIVERY_LINE_NOT_FOUND");

      // ④ 生成 DeliveryRevision
      await createDeliveryRevision(tx, id, changeReason ?? "更新交付行", { delivery, line: updated }, user?.id);
      return updated;
    });
  } catch (e) {
    if (e instanceof Error && e.message === "SOURCE_LINE_INVALID") {
      return fail(ERROR_CODES.DELIVERY_SOURCE_LINE_INVALID, "交付行来源销售订单行无效或已删除", 400);
    }
    if (e instanceof Error && e.message.startsWith("QUANTITY_EXCEEDED:")) {
      const detail = JSON.parse(e.message.slice("QUANTITY_EXCEEDED:".length)) as { requested: string; availableQty: string };
      return failConflict(
        ERROR_CODES.DELIVERY_QUANTITY_EXCEEDED,
        `交付数量超过可交付量（请求 ${detail.requested}，availableQty ${detail.availableQty}），禁止超交`,
      );
    }
    if (e instanceof Error && e.message === "DELIVERY_LINE_NOT_FOUND") {
      return failNotFound(ERROR_CODES.DELIVERY_LINE_NOT_FOUND, "交付行不存在");
    }
    if (e instanceof Error && e.message === "DELIVERY_LINE_VERSION_CONFLICT") {
      return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
    }
    throw e;
  }

  await publishDeliveryEvent({
    eventType: "DeliveryUpdated",
    actorId: user?.id,
    entityId: id,
    payload: {
      deliveryId: id,
      deliveryCode: delivery.code,
      salesOrderId: delivery.salesOrderId,
      customerId: delivery.customerId,
      changeReason: changeReason ?? "更新交付行",
    },
    meta,
  });
  await writeAuditLog({
    actorId: user?.id,
    action: "delivery-line.update",
    entityType: "deliveryLine",
    entityId: lineId,
    afterData: { deliveryId: id, fields: Object.keys(fields), quantityChanged: quantity !== undefined },
    ...meta,
  });

  return ok(saved);
}
