import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound, fail } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { deliveryReadySchema } from "@/lib/api/schemas";
import { computeDeliveryAllocation, createDeliverySnapshot, latestDeliveryRevisionNo } from "@/lib/delivery/helpers";
import { publishDeliveryEvent } from "@/lib/delivery/events";

export const dynamic = "force-dynamic";

/**
 * POST /api/deliveries/:id/ready（DRAFT → READY；CTO Review ⑧：READY 后行彻底冻结，不支持重新 ready，错误→cancel→新建）
 * 校验（事务内）：
 *  至少 1 条有效 DeliveryLine；每条 quantity > 0；所有 sourceSalesOrderLineId 仍有效；
 *  重新执行 allocation 校验（排除本 Delivery 自身行）——避免 DRAFT 编辑期间其他 Delivery 抢占数量；
 *  全部涉及源行 FOR UPDATE 真实行锁（不信 DRAFT 阶段旧校验）。
 * 成功：status=READY + DeliverySnapshot(READY) + 发布 DeliveryReady。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "delivery:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "delivery.ready");

  const { id } = await params;
  const parsed = deliveryReadySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { changeReason } = parsed.data;
  const meta = requestMeta(request);

  const result = await prisma.$transaction(async (tx) => {
    // ① 真实行锁：锁定 Delivery，串行化同一交付单的并发 ready
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "Delivery" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
    );
    if (locked.length === 0) return { error: "NOT_FOUND" as const };

    const delivery = await tx.delivery.findFirst({
      where: { id, deletedAt: null },
      include: { lines: { where: { deletedAt: null }, orderBy: { lineNo: "asc" } } },
    });
    if (!delivery) return { error: "NOT_FOUND" as const };
    if (delivery.status !== "DRAFT") return { error: "INVALID_STATE" as const };

    // ② 校验行：至少 1 条、每条 quantity > 0
    if (delivery.lines.length === 0) return { error: "NO_LINES" as const };
    for (const line of delivery.lines) {
      if (line.quantity.lte(0)) return { error: "INVALID_LINE_QTY" as const };
      if (!line.sourceSalesOrderLineId) return { error: "SOURCE_LINE_INVALID" as const, lineId: line.id };
    }

    // ③ 重新 allocation 校验：按源行去重，FOR UPDATE 锁源行，排除本 Delivery 自身行后重新算 availableQty
    const sourceIds = [...new Set(delivery.lines.map((l) => l.sourceSalesOrderLineId).filter((v): v is string => !!v))].sort();
    for (const sourceId of sourceIds) {
      const lockedLine = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "SalesOrderLine" WHERE "id" = ${sourceId} AND "deletedAt" IS NULL FOR UPDATE`,
      );
      if (lockedLine.length === 0) return { error: "SOURCE_LINE_INVALID" as const, lineId: sourceId };
      const alloc = await computeDeliveryAllocation(tx, sourceId, undefined, id);
      if (!alloc) return { error: "SOURCE_LINE_INVALID" as const, lineId: sourceId };
      // 本 Delivery 对该源行的数量合计（多条行可能指向同一源行）
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

    // ④ 更新 status=READY（行冻结点）
    const saved = await tx.delivery.update({
      where: { id },
      data: { status: "READY", version: { increment: 1 }, updatedById: user!.id },
    });

    // ⑤ 固化 READY 快照（Decimal 一律 toString）
    const revisionNo = await latestDeliveryRevisionNo(tx, id);
    await createDeliverySnapshot(
      tx,
      id,
      "READY",
      revisionNo,
      {
        status: "READY",
        readyAt: new Date().toISOString(),
        readyBy: user?.id,
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

    return { delivery: saved, lineCount: delivery.lines.length };
  });

  if ("error" in result) {
    switch (result.error) {
      case "NOT_FOUND":
        return failNotFound(ERROR_CODES.DELIVERY_NOT_FOUND, "交付单不存在");
      case "INVALID_STATE":
        return failConflict(ERROR_CODES.DELIVERY_INVALID_STATE, "仅 DRAFT 状态可执行 ready（READY 后行彻底冻结）");
      case "NO_LINES":
        return failConflict(ERROR_CODES.DELIVERY_INVALID_STATE, "交付单至少需要一条有效交付行才能 ready");
      case "INVALID_LINE_QTY":
        return failConflict(ERROR_CODES.DELIVERY_INVALID_STATE, "交付行数量必须大于 0");
      case "SOURCE_LINE_INVALID":
        return fail(ERROR_CODES.DELIVERY_SOURCE_LINE_INVALID, "交付行来源销售订单行无效或已删除", 400, { lineId: result.lineId });
      case "QUANTITY_EXCEEDED":
        return failConflict(
          ERROR_CODES.DELIVERY_QUANTITY_EXCEEDED,
          `交付数量超过可交付量（请求 ${result.requested}，availableQty ${result.availableQty}），禁止超交`,
        );
    }
  }

  await publishDeliveryEvent({
    eventType: "DeliveryReady",
    actorId: user?.id,
    entityId: id,
    payload: {
      deliveryId: id,
      deliveryCode: result.delivery.code,
      salesOrderId: result.delivery.salesOrderId,
      customerId: result.delivery.customerId,
      lineCount: result.lineCount,
      changeReason: changeReason ?? "交付单就绪",
    },
    meta,
  });
  await writeAuditLog({
    actorId: user?.id,
    action: "delivery.ready",
    entityType: "delivery",
    entityId: id,
    afterData: { status: "READY", lineCount: result.lineCount },
    ...meta,
  });

  return ok({ id, status: "READY" });
}
