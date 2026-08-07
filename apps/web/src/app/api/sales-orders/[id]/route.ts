import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { salesOrderUpdateSchema } from "@/lib/api/schemas";
import { createSalesOrderRevision } from "@/lib/sales-order/helpers";
import { maybeTriggerSalesOrderApproval } from "@/lib/sales-order/workflow-sync";
import { publishSalesOrderEvent } from "@/lib/sales-order/events";

export const dynamic = "force-dynamic";

const EDITABLE_STATUSES = ["DRAFT"] as const;

/** GET /api/sales-orders/:id（详情含 lines/revisions/snapshots + customer + quotation 摘要） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "sales-order:view");
  if (denied) return denied;
  requestLog(request, user?.id, "sales-order.get");

  const { id } = await params;
  const salesOrder = await prisma.salesOrder.findFirst({
    where: { id, deletedAt: null },
    include: {
      customer: { select: { id: true, code: true, name: true } },
      quotation: { select: { id: true, code: true, status: true } },
      lines: {
        where: { deletedAt: null },
        orderBy: { lineNo: "asc" },
        include: { item: { select: { id: true, code: true, name: true, model: true } }, priceSnapshot: true },
      },
      revisions: { where: { deletedAt: null }, orderBy: { revisionNo: "desc" } },
      snapshots: { where: { deletedAt: null }, orderBy: { generatedAt: "desc" } },
    },
  });
  if (!salesOrder) return failNotFound(ERROR_CODES.SALES_ORDER_NOT_FOUND, "销售订单不存在");

  return ok(salesOrder);
}

/**
 * PATCH /api/sales-orders/:id（更新头，仅 DRAFT；乐观锁 version；CONFIRMED 后禁止直接改数量/UOM，走后续 amendment 流程）
 * CTO 锁定项②：允许改交期/付款条件/贸易术语/备注等商业条件；禁止直接改价格（价格继承 Quotation，
 * schema 无 unitPrice 字段；改价必须重新走 PricingEngine 并生成新 Revision + Snapshot + 审批）。
 * 商业条件变更 → 系统生成 Revision；发布 SalesOrderUpdated。
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "sales-order:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "sales-order.update");

  const { id } = await params;
  const parsed = salesOrderUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version, changeReason, ...fields } = parsed.data;
  const meta = requestMeta(request);

  const salesOrder = await prisma.salesOrder.findFirst({ where: { id, deletedAt: null } });
  if (!salesOrder) return failNotFound(ERROR_CODES.SALES_ORDER_NOT_FOUND, "销售订单不存在");
  if ((EDITABLE_STATUSES as readonly string[]).includes(salesOrder.status) === false) {
    return failConflict(ERROR_CODES.SALES_ORDER_NOT_EDITABLE, "仅 DRAFT 状态可编辑（CONFIRMED 后需走 amendment 流程）");
  }
  if (salesOrder.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.salesOrder.update({
      where: { id },
      data: {
        ...(fields.requestedDeliveryDate !== undefined
          ? { requestedDeliveryDate: fields.requestedDeliveryDate ? new Date(fields.requestedDeliveryDate) : null }
          : {}),
        ...(fields.paymentTerm !== undefined ? { paymentTerm: fields.paymentTerm } : {}),
        ...(fields.incoterm !== undefined ? { incoterm: fields.incoterm } : {}),
        ...(fields.remark !== undefined ? { remark: fields.remark } : {}),
        version: { increment: 1 },
        updatedById: user!.id,
      },
    });
    // 商业条件变更 → 系统生成 Revision（不允许自由编辑 Revision）
    await createSalesOrderRevision(tx, id, changeReason ?? "更新销售订单头", { salesOrder: saved }, user?.id);
    return saved;
  });

  // Sprint 4B Workflow 条件触发（CTO 锁定项③）：修改付款条件/交货条件等关键商业字段 → 触发新审批（有策略时）
  const keyCommercialChanged =
    (fields.paymentTerm !== undefined && fields.paymentTerm !== salesOrder.paymentTerm) ||
    (fields.incoterm !== undefined && fields.incoterm !== salesOrder.incoterm) ||
    (fields.requestedDeliveryDate !== undefined &&
      (fields.requestedDeliveryDate ? new Date(fields.requestedDeliveryDate).getTime() : null) !==
        (salesOrder.requestedDeliveryDate ? salesOrder.requestedDeliveryDate.getTime() : null));
  await maybeTriggerSalesOrderApproval({
    salesOrderId: id,
    keyCommercialChanged,
    actorId: user!.id,
    meta,
  });

  await publishSalesOrderEvent({
    eventType: "SalesOrderUpdated",
    actorId: user?.id,
    entityId: id,
    payload: {
      salesOrderId: id,
      salesOrderCode: updated.code,
      quotationId: updated.quotationId,
      customerId: updated.customerId,
      projectId: updated.projectId,
      currency: updated.currency,
      totalAmount: updated.totalAmount,
      changeReason: changeReason ?? "更新销售订单头",
    },
    meta,
  });
  await writeAuditLog({
    actorId: user?.id,
    action: "sales-order.update",
    entityType: "salesOrder",
    entityId: id,
    afterData: { fields: Object.keys(fields), version: updated.version },
    ...meta,
  });

  return ok(updated);
}
