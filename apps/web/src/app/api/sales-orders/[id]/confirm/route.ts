import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failConflict, failNotFound, failServer } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { publishSalesOrderEvent } from "@/lib/sales-order/events";

export const dynamic = "force-dynamic";

/**
 * POST /api/sales-orders/:id/confirm（确认订单，Action API，不 PATCH status 之外的其他字段）
 * CTO 锁定项③：SO Confirm **不重复审批**——Accepted Quotation 已完成商业审批，confirm 只做订单确认与状态流转
 * （DRAFT → CONFIRMED）；只有当 SO 修改了数量/价格/付款条件/交货条件等关键商业字段时，才触发新的审批流程（后续阶段）。
 * 成功：status=CONFIRMED + QuotationSnapshot(CONFIRMED) + 发布 SalesOrderConfirmed。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  // confirm 映射现有动作（CTO：新动作不破坏 RBAC 规范）
  const denied = requirePermission(user, "sales-order:approve");
  if (denied) return denied;
  requestLog(request, user?.id, "sales-order.confirm");

  const { id } = await params;
  const meta = requestMeta(request);

  const salesOrder = await prisma.salesOrder.findFirst({ where: { id, deletedAt: null } });
  if (!salesOrder) return failNotFound(ERROR_CODES.SALES_ORDER_NOT_FOUND, "销售订单不存在");
  if (salesOrder.status !== "DRAFT") {
    return failConflict(ERROR_CODES.SALES_ORDER_INVALID_STATE, "仅 DRAFT 状态可确认订单");
  }

  const actorId = user!.id;
  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.salesOrder.update({
      where: { id },
      data: { status: "CONFIRMED", updatedById: actorId },
    });
    const latestRevision = await tx.salesOrderRevision.findFirst({
      where: { salesOrderId: id, deletedAt: null },
      orderBy: { revisionNo: "desc" },
    });
    await tx.salesOrderSnapshot.create({
      data: {
        salesOrderId: id,
        snapshotType: "CONFIRMED",
        revisionNo: latestRevision?.revisionNo ?? 1,
        snapshotData: {
          status: "CONFIRMED",
          totalAmount: saved.totalAmount.toString(),
          currency: saved.currency,
          confirmedBy: actorId,
          confirmedAt: new Date().toISOString(),
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
      eventType: "SalesOrderConfirmed",
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
        confirmedBy: actorId,
      },
      meta,
    });
    await writeAuditLog({
      actorId,
      action: "sales-order.confirm",
      entityType: "salesOrder",
      entityId: id,
      afterData: { status: "CONFIRMED" },
      ...meta,
    });
  } catch {
    // 事件/审计失败不阻断主流程
  }

  return ok({ id, status: "CONFIRMED" });
}
