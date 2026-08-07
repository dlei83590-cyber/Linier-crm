import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound, fail } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { quotationLineUpdateSchema } from "@/lib/api/schemas";
import { recalcQuotationTotals, createQuotationRevision } from "@/lib/quotation/helpers";
import { quotationPricingService } from "@/lib/pricing/QuotationPricingService";
import { publishQuotationEvent } from "@/lib/quotation/events";

export const dynamic = "force-dynamic";

const EDITABLE_STATUSES = ["DRAFT", "REJECTED"] as const;

/**
 * PATCH /api/quotations/:id/lines/:lineId（仅 DRAFT/REJECTED；乐观锁 version）
 * 禁止直接修改 unitPrice（schema 不含该字段）——数量变更后必须重新走 PricingEngine 生成新快照。
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; lineId: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "quotation-line:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "quotation-line.update");

  const { id, lineId } = await params;
  const parsed = quotationLineUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version, changeReason, quantity, ...fields } = parsed.data;
  const meta = requestMeta(request);

  const quotation = await prisma.quotation.findFirst({ where: { id, deletedAt: null } });
  if (!quotation) return failNotFound(ERROR_CODES.QUOTATION_NOT_FOUND, "报价单不存在");
  if ((EDITABLE_STATUSES as readonly string[]).includes(quotation.status) === false) {
    return failConflict(ERROR_CODES.QUOTATION_NOT_EDITABLE, "仅 DRAFT/REJECTED 状态可编辑行");
  }

  const line = await prisma.quotationLine.findFirst({ where: { id: lineId, quotationId: id, deletedAt: null } });
  if (!line) return failNotFound(ERROR_CODES.QUOTATION_LINE_NOT_FOUND, "报价行不存在");
  if (line.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }

  const nextQuantity = quantity !== undefined ? new Prisma.Decimal(quantity) : line.quantity;
  const repricing = quantity !== undefined && !line.quantity.equals(nextQuantity);

  // ① 更新业务字段（价格字段不动，等待定价回写）
  const updatedLine = await prisma.quotationLine.update({
    where: { id: lineId },
    data: {
      ...(fields.description !== undefined ? { description: fields.description } : {}),
      ...(fields.uomId !== undefined ? { uomId: fields.uomId } : {}),
      ...(fields.lineNo !== undefined ? { lineNo: fields.lineNo } : {}),
      ...(quantity !== undefined ? { quantity: nextQuantity } : {}),
      version: { increment: 1 },
      updatedById: user!.id,
    },
  });

  // ② 数量变更 → 重新定价（ADR-0015：新快照，禁止手工填价）
  if (repricing) {
    try {
      const pricing = await quotationPricingService.priceLines({
        quotationId: id,
        customerId: quotation.customerId,
        currency: quotation.currency,
        pricingDate: new Date(),
        taxProfileId: quotation.taxProfileId ?? undefined,
        lines: [{ lineId, itemId: line.itemId!, quantity: nextQuantity, uom: updatedLine.uomId ?? undefined }],
      });
      const r = pricing[0];
      await prisma.quotationLine.update({
        where: { id: lineId },
        data: {
          priceSnapshotId: r.priceSnapshotId,
          unitPrice: r.unitPrice,
          lineAmount: r.lineAmount,
          taxAmount: r.taxAmount,
          totalAmount: r.totalAmount,
          updatedById: user!.id,
        },
      });
    } catch {
      return fail(ERROR_CODES.QUOTATION_PRICE_FAILED, "报价定价失败：请检查物料价格配置", 400);
    }
  }

  // ③ 重算头合计 + Revision + 事件 + 审计
  const saved = await prisma.$transaction(async (tx) => {
    const lines = await tx.quotationLine.findMany({ where: { quotationId: id, deletedAt: null }, orderBy: { lineNo: "asc" } });
    await recalcQuotationTotals(tx, id, lines);
    const q = await tx.quotation.findFirst({ where: { id } });
    if (q) await createQuotationRevision(tx, id, changeReason ?? "更新报价行", { quotation: q, lines }, user?.id);
    const l = await tx.quotationLine.findFirst({ where: { id: lineId } });
    return { quotation: q, line: l };
  });

  await publishQuotationEvent({
    eventType: "QuotationUpdated",
    actorId: user?.id,
    entityId: id,
    payload: {
      quotationId: id,
      quotationCode: saved.quotation?.code ?? "",
      customerId: quotation.customerId,
      projectId: quotation.projectId,
      workflowInstanceId: quotation.workflowInstanceId,
      currency: quotation.currency,
      totalAmount: saved.quotation?.totalAmount,
    },
    meta,
  });
  await writeAuditLog({
    actorId: user?.id,
    action: "quotation-line.update",
    entityType: "quotationLine",
    entityId: lineId,
    afterData: { quotationId: id, fields: Object.keys(fields), repricing },
    ...meta,
  });

  return ok(saved.line);
}

/** DELETE /api/quotations/:id/lines/:lineId（软删行 → 重算头合计 + Revision） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; lineId: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "quotation-line:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "quotation-line.delete");

  const { id, lineId } = await params;
  const meta = requestMeta(request);

  const quotation = await prisma.quotation.findFirst({ where: { id, deletedAt: null } });
  if (!quotation) return failNotFound(ERROR_CODES.QUOTATION_NOT_FOUND, "报价单不存在");
  if ((EDITABLE_STATUSES as readonly string[]).includes(quotation.status) === false) {
    return failConflict(ERROR_CODES.QUOTATION_NOT_EDITABLE, "仅 DRAFT/REJECTED 状态可删除行");
  }
  const line = await prisma.quotationLine.findFirst({ where: { id: lineId, quotationId: id, deletedAt: null } });
  if (!line) return failNotFound(ERROR_CODES.QUOTATION_LINE_NOT_FOUND, "报价行不存在");

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.quotationLine.update({ where: { id: lineId }, data: { deletedAt: now, isActive: false, updatedById: user!.id } });
    const lines = await tx.quotationLine.findMany({ where: { quotationId: id, deletedAt: null }, orderBy: { lineNo: "asc" } });
    await recalcQuotationTotals(tx, id, lines);
    const q = await tx.quotation.findFirst({ where: { id } });
    if (q) await createQuotationRevision(tx, id, "删除报价行", { quotation: q, lines }, user?.id);
  });

  await publishQuotationEvent({
    eventType: "QuotationUpdated",
    actorId: user?.id,
    entityId: id,
    payload: {
      quotationId: id,
      quotationCode: quotation.code,
      customerId: quotation.customerId,
      projectId: quotation.projectId,
      workflowInstanceId: quotation.workflowInstanceId,
      currency: quotation.currency,
      totalAmount: null,
    },
    meta,
  });
  await writeAuditLog({
    actorId: user?.id,
    action: "quotation-line.delete",
    entityType: "quotationLine",
    entityId: lineId,
    afterData: { quotationId: id },
    ...meta,
  });

  return ok({ id: lineId, deleted: true });
}
