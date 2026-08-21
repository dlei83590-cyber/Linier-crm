import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { casUpdate } from "@/lib/api/cas";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, fail, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { invoiceUpdateSchema } from "@/lib/api/schemas";
import { createInvoiceRevision } from "@/lib/invoice/helpers";
import { publishInvoiceEvent } from "@/lib/invoice/events";
import { maybeTriggerInvoiceApproval } from "@/lib/invoice/workflow-sync";

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
      // 来源交付摘要 + 经 Delivery 溯源 SalesOrder 摘要（Invoice.salesOrderId 为冗余投影，无直接 relation；
      // Prisma 禁止 relation 同时用 select+include → 嵌套用 select）
      delivery: {
        select: {
          id: true,
          code: true,
          status: true,
          deliveryDate: true,
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
 * 非财务编辑 → 系统生成 Revision + 发布 InvoiceUpdated；
 * 重审规则（CTO Phase 4 锁定）：paymentTerm / dueDate 变更 → 失效原审批并重新提交（maybeTriggerInvoiceApproval）；
 * remark 修改不触发重审；命中 INVOICE 策略但定义缺失 → 409 INVOICE_WORKFLOW_FAILED（整体回滚）。
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

  // 关键财务字段变更判定（CTO Phase 4 指令：paymentTerm/dueDate 变更 → 触发重新审批；remark 不触发）
  const keyFinancialChanged =
    (fields.paymentTerm !== undefined && fields.paymentTerm !== invoice.paymentTerm) ||
    (fields.dueDate !== undefined &&
      (fields.dueDate ? new Date(fields.dueDate).getTime() : null) !==
        (invoice.dueDate ? invoice.dueDate.getTime() : null));

  let updated: Awaited<ReturnType<typeof prisma.invoice.update>>;
  try {
    // 单事务：更新头 + Revision + 审批触发（财务修改与审批状态切换统一事务，命中策略失败整体回滚显式报错）
    updated = await prisma.$transaction(async (tx) => {
      // A4-CAS：原子乐观锁置于事务首部（消除 read-check-update TOCTOU）
      const cas = await casUpdate(tx, "invoice", id, version, {
        ...(fields.remark !== undefined ? { remark: fields.remark } : {}),
        ...(fields.dueDate !== undefined ? { dueDate: fields.dueDate ? new Date(fields.dueDate) : null } : {}),
        ...(fields.paymentTerm !== undefined ? { paymentTerm: fields.paymentTerm } : {}),
        updatedById: user!.id,
      });
      if (cas.outcome !== "OK") {
        throw new Error(cas.outcome === "NOT_FOUND" ? "INVOICE_NOT_FOUND" : "INVOICE_VERSION_CONFLICT");
      }
      const saved = await tx.invoice.findFirst({ where: { id, deletedAt: null } });
      if (!saved) throw new Error("INVOICE_NOT_FOUND");
      // 非财务编辑 → 系统生成 Revision（不允许自由编辑 Revision）
      await createInvoiceRevision(tx, id, changeReason ?? "更新发票头", { invoice: saved }, user?.id);
      // 财务条件变更 → 审批触发（同一事务，传 tx）：无实例创建 / RUNNING 保持 / 终态复用重新 SUBMIT
      await maybeTriggerInvoiceApproval({ invoiceId: id, keyFinancialChanged, actorId: user!.id, meta, tx });
      return saved;
    });
  } catch (e) {
    if (e instanceof Error && e.message === "WORKFLOW_DEFINITION_NOT_FOUND") {
      return fail(ERROR_CODES.INVOICE_WORKFLOW_FAILED, "审批流程定义不存在或未发布（INVOICE_APPROVAL），发票变更已回滚", 409);
    }
    if (e instanceof Error && e.message === "INVOICE_NOT_FOUND") {
      return failNotFound(ERROR_CODES.INVOICE_NOT_FOUND, "发票不存在");
    }
    if (e instanceof Error && e.message === "INVOICE_VERSION_CONFLICT") {
      return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
    }
    throw e;
  }

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

/** DELETE /api/invoices/:id（层层回退-层层可删除：仅 CANCELLED 且无应收引用可软删除） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "invoice:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "invoice.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const invoice = await prisma.invoice.findFirst({ where: { id, deletedAt: null } });
  if (!invoice) return failNotFound(ERROR_CODES.INVOICE_NOT_FOUND, "发票不存在");
  if (invoice.status !== "CANCELLED") {
    return failConflict(ERROR_CODES.INVOICE_INVALID_STATE, "仅 CANCELLED 状态可删除（回退后清理列表）；已开票/已收款发票禁止删除");
  }
  // 引用防御：已生成应收（AR.invoiceId）禁止删除——保持应收溯源链（CTO 必改③：有 AR 的发票禁止删除）
  const arCount = await prisma.accountsReceivable.count({ where: { invoiceId: id, deletedAt: null } });
  if (arCount > 0) {
    return failConflict(ERROR_CODES.INVOICE_INVALID_STATE, "发票已生成应收，禁止删除（保持应收溯源）");
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.invoice.update({ where: { id }, data: { deletedAt: now, isActive: false, updatedById: user!.id } });
    await tx.invoiceLine.updateMany({ where: { invoiceId: id, deletedAt: null }, data: { deletedAt: now, isActive: false } });
    await tx.invoiceRevision.updateMany({ where: { invoiceId: id, deletedAt: null }, data: { deletedAt: now, isActive: false } });
    await tx.invoiceSnapshot.updateMany({ where: { invoiceId: id, deletedAt: null }, data: { deletedAt: now, isActive: false } });
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "invoice.delete",
    entityType: "invoice",
    entityId: id,
    afterData: { code: invoice.code },
    ...meta,
  });

  return ok({ id, deleted: true });
}
