import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { invoiceUpdateSchema } from "@/lib/api/schemas";
import { createInvoiceRevision } from "@/lib/invoice/helpers";
import { publishInvoiceEvent } from "@/lib/invoice/events";

export const dynamic = "force-dynamic";

const EDITABLE_STATUSES = ["DRAFT"] as const;

/**
 * GET /api/invoices/:id（详情：Invoice + Customer + Workflow + Delivery/SalesOrder Summary + Lines + Latest Revision/Snapshot）
 * 一次带出 Dashboard 所需全部数据，避免前端 5~6 个额外请求（CTO 指令）。
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "invoice:view");
  if (denied) return denied;
  requestLog(request, user?.id, "invoice.get");

  const { id } = await params;
  const invoice = await prisma.invoice.findFirst({
    where: { id, deletedAt: null },
    include: {
      customer: { select: { id: true, code: true, name: true } },
      // 来源交付摘要 + 经 Delivery 溯源 SalesOrder 摘要（Invoice.salesOrderId 为冗余投影，无直接 relation）
      delivery: {
        select: { id: true, code: true, status: true, deliveryDate: true },
        include: {
          salesOrder: { select: { id: true, code: true, status: true, currency: true } },
        },
      },
      workflowInstance: { select: { id: true, status: true, currentStepNo: true, startedAt: true, completedAt: true } },
      lines: {
        where: { deletedAt: null },
        orderBy: { lineNo: "asc" },
        include: { item: { select: { id: true, code: true, name: true, model: true } }, priceSnapshot: true },
      },
      revisions: { where: { deletedAt: null }, orderBy: { revisionNo: "desc" }, take: 1 },
      snapshots: { where: { deletedAt: null }, orderBy: { generatedAt: "desc" }, take: 1 },
    },
  });
  if (!invoice) return failNotFound(ERROR_CODES.INVOICE_NOT_FOUND, "发票不存在");

  return ok(invoice);
}

/**
 * PATCH /api/invoices/:id（更新头，仅 DRAFT；乐观锁 version）
 * CTO Phase 4 锁定：只允许非财务字段 remark / dueDate / paymentTerm（schema 无 reference 列，不新增）；
 * 禁止修改 quantity/unitPrice/taxRate/lineAmount/totalAmount/paidAmount/balanceAmount/code/status——
 * 这些必须继续由系统动作或 4E 维护。
 * 非财务编辑 → 系统生成 Revision + 发布 InvoiceUpdated；本阶段不触发 Workflow（Commit C 才接审批重审）。
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "invoice:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "invoice.update");

  const { id } = await params;
  const parsed = invoiceUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version, changeReason, ...fields } = parsed.data;
  const meta = requestMeta(request);

  const invoice = await prisma.invoice.findFirst({ where: { id, deletedAt: null } });
  if (!invoice) return failNotFound(ERROR_CODES.INVOICE_NOT_FOUND, "发票不存在");
  if ((EDITABLE_STATUSES as readonly string[]).includes(invoice.status) === false) {
    return failConflict(ERROR_CODES.INVOICE_INVALID_STATE, `仅 DRAFT 状态可编辑（当前 ${invoice.status}）`);
  }
  if (invoice.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.invoice.update({
      where: { id },
      data: {
        ...(fields.remark !== undefined ? { remark: fields.remark } : {}),
        ...(fields.dueDate !== undefined ? { dueDate: fields.dueDate ? new Date(fields.dueDate) : null } : {}),
        ...(fields.paymentTerm !== undefined ? { paymentTerm: fields.paymentTerm } : {}),
        version: { increment: 1 },
        updatedById: user!.id,
      },
    });
    // 非财务编辑 → 系统生成 Revision（不允许自由编辑 Revision）
    await createInvoiceRevision(tx, id, changeReason ?? "更新发票头", { invoice: saved }, user?.id);
    return saved;
  });

  await publishInvoiceEvent({
    eventType: "InvoiceUpdated",
    actorId: user?.id,
    entityId: id,
    payload: {
      invoiceId: id,
      invoiceCode: updated.code,
      deliveryId: updated.deliveryId,
      salesOrderId: updated.salesOrderId,
      customerId: updated.customerId,
      currency: updated.currency,
      invoiceTotal: updated.invoiceTotal,
      changeReason: changeReason ?? "更新发票头",
    },
    meta,
  }).catch(() => undefined);
  await writeAuditLog({
    actorId: user?.id,
    action: "invoice.update",
    entityType: "invoice",
    entityId: id,
    afterData: { fields: Object.keys(fields), version: updated.version },
    ...meta,
  });

  return ok(updated);
}
