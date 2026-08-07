import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { publishSalesOrderEvent } from "@/lib/sales-order/events";

export const dynamic = "force-dynamic";

/** 允许取消的状态（CTO Sprint 4B：DRAFT/CONFIRMED 可取消；已交付/完成禁止） */
const CANCELLABLE = ["DRAFT", "CONFIRMED"] as const;

/**
 * POST /api/sales-orders/:id/cancel（取消订单，Action API）
 * 允许 DRAFT / CONFIRMED；禁止 PARTIALLY_DELIVERED / DELIVERED / COMPLETED（需走后续变更流程）。
 * 成功：status=CANCELLED + QuotationSnapshot(CANCELLED) + 发布 SalesOrderCancelled。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  // cancel 映射现有动作（CTO：新动作不破坏 RBAC 规范）
  const denied = requirePermission(user, "sales-order:close");
  if (denied) return denied;
  requestLog(request, user?.id, "sales-order.cancel");

  const { id } = await params;
  const meta = requestMeta(request);

  const salesOrder = await prisma.salesOrder.findFirst({ where: { id, deletedAt: null } });
  if (!salesOrder) return failNotFound(ERROR_CODES.SALES_ORDER_NOT_FOUND, "销售订单不存在");
  if ((CANCELLABLE as readonly string[]).includes(salesOrder.status) === false) {
    return failConflict(ERROR_CODES.SALES_ORDER_INVALID_STATE, "当前状态不允许取消（已交付/已完成禁止取消）");
  }

  const actorId = user!.id;
  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.salesOrder.update({
      where: { id },
      data: { status: "CANCELLED", updatedById: actorId },
    });
    const latestRevision = await tx.salesOrderRevision.findFirst({
      where: { salesOrderId: id, deletedAt: null },
      orderBy: { revisionNo: "desc" },
    });
    await tx.salesOrderSnapshot.create({
      data: {
        salesOrderId: id,
        snapshotType: "CANCELLED",
        revisionNo: latestRevision?.revisionNo ?? 1,
        snapshotData: {
          status: "CANCELLED",
          totalAmount: saved.totalAmount.toString(),
          currency: saved.currency,
          cancelledBy: actorId,
          cancelledAt: new Date().toISOString(),
        },
        generatedById: actorId,
        createdById: actorId,
        updatedById: actorId,
      },
    });
    return saved;
  });

  try {
    await publishSalesOrderEvent({
      eventType: "SalesOrderCancelled",
      actorId,
      entityId: id,
      payload: {
        salesOrderId: id,
        salesOrderCode: updated.code,
        quotationId: updated.quotationId,
        customerId: updated.customerId,
        projectId: updated.projectId,
        currency: updated.currency,
        totalAmount: updated.totalAmount,
        cancelledBy: actorId,
      },
      meta,
    });
    await writeAuditLog({
      actorId,
      action: "sales-order.cancel",
      entityType: "salesOrder",
      entityId: id,
      afterData: { status: "CANCELLED" },
      ...meta,
    });
  } catch {
    // 事件/审计失败不阻断主流程
  }

  return ok({ id, status: "CANCELLED" });
}
