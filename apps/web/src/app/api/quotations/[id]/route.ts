import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { quotationUpdateSchema } from "@/lib/api/schemas";
import { createQuotationRevision, effectiveStatusOf } from "@/lib/quotation/helpers";
import { publishQuotationEvent } from "@/lib/quotation/events";

export const dynamic = "force-dynamic";

const EDITABLE_STATUSES = ["DRAFT", "REJECTED"] as const;

/** GET /api/quotations/:id（详情含 lines/revisions/snapshots/customer + 惰性过期投影） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "quotation:view");
  if (denied) return denied;
  requestLog(request, user?.id, "quotation.get");

  const { id } = await params;
  const quotation = await prisma.quotation.findFirst({
    where: { id, deletedAt: null },
    include: {
      customer: { select: { id: true, code: true, name: true } },
      lines: {
        where: { deletedAt: null },
        orderBy: { lineNo: "asc" },
        include: { item: { select: { id: true, code: true, name: true, model: true } }, priceSnapshot: true },
      },
      revisions: { where: { deletedAt: null }, orderBy: { revisionNo: "desc" } },
      snapshots: { where: { deletedAt: null }, orderBy: { generatedAt: "desc" } },
    },
  });
  if (!quotation) return failNotFound(ERROR_CODES.QUOTATION_NOT_FOUND, "报价单不存在");

  return ok({ ...quotation, ...effectiveStatusOf(quotation) });
}

/**
 * PATCH /api/quotations/:id（仅 DRAFT/REJECTED 可编辑；乐观锁 version；不直接改 status/行价）
 * 商业内容变更（有效期/税档/备注）→ 系统生成 Revision；发布 QuotationUpdated。
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "quotation:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "quotation.update");

  const { id } = await params;
  const parsed = quotationUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { version, changeReason, ...fields } = parsed.data;
  const meta = requestMeta(request);

  const quotation = await prisma.quotation.findFirst({ where: { id, deletedAt: null } });
  if (!quotation) return failNotFound(ERROR_CODES.QUOTATION_NOT_FOUND, "报价单不存在");
  if ((EDITABLE_STATUSES as readonly string[]).includes(quotation.status) === false) {
    return failConflict(ERROR_CODES.QUOTATION_NOT_EDITABLE, "仅 DRAFT/REJECTED 状态可编辑");
  }
  if (quotation.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.quotation.update({
      where: { id },
      data: {
        ...(fields.validFrom !== undefined ? { validFrom: fields.validFrom ? new Date(fields.validFrom) : null } : {}),
        ...(fields.validUntil !== undefined ? { validUntil: fields.validUntil ? new Date(fields.validUntil) : null } : {}),
        ...(fields.taxProfileId !== undefined ? { taxProfileId: fields.taxProfileId } : {}),
        ...(fields.remark !== undefined ? { remark: fields.remark } : {}),
        version: { increment: 1 },
        updatedById: user!.id,
      },
    });
    // 商业内容变更 → 系统生成 Revision（不允许自由编辑 Revision）
    await createQuotationRevision(tx, id, changeReason ?? "更新报价单头", { quotation: saved }, user?.id);
    return saved;
  });

  await publishQuotationEvent({
    eventType: "QuotationUpdated",
    actorId: user?.id,
    entityId: id,
    payload: {
      quotationId: id,
      quotationCode: updated.code,
      customerId: updated.customerId,
      projectId: updated.projectId,
      workflowInstanceId: updated.workflowInstanceId,
      currency: updated.currency,
      totalAmount: updated.totalAmount,
    },
    meta,
  });
  await writeAuditLog({
    actorId: user?.id,
    action: "quotation.update",
    entityType: "quotation",
    entityId: id,
    afterData: { fields: Object.keys(fields), version: updated.version },
    ...meta,
  });

  return ok({ ...updated, ...effectiveStatusOf(updated) });
}

/** DELETE /api/quotations/:id（仅 DRAFT；软删除 + 级联软删 lines/revisions/snapshots） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "quotation:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "quotation.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const quotation = await prisma.quotation.findFirst({ where: { id, deletedAt: null } });
  if (!quotation) return failNotFound(ERROR_CODES.QUOTATION_NOT_FOUND, "报价单不存在");
  if (quotation.status !== "DRAFT") {
    return failConflict(ERROR_CODES.QUOTATION_NOT_EDITABLE, "仅 DRAFT 状态可删除");
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.quotation.update({ where: { id }, data: { deletedAt: now, isActive: false, updatedById: user!.id } });
    await tx.quotationLine.updateMany({ where: { quotationId: id, deletedAt: null }, data: { deletedAt: now, isActive: false } });
    await tx.quotationRevision.updateMany({ where: { quotationId: id, deletedAt: null }, data: { deletedAt: now, isActive: false } });
    await tx.quotationSnapshot.updateMany({ where: { quotationId: id, deletedAt: null }, data: { deletedAt: now, isActive: false } });
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "quotation.delete",
    entityType: "quotation",
    entityId: id,
    afterData: { code: quotation.code },
    ...meta,
  });

  return ok({ id, deleted: true });
}
