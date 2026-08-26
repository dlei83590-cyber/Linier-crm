import { NextRequest } from "next/server";
import type { DocumentType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { casUpdate } from "@/lib/api/cas";
import { currentPeriodKey } from "@/lib/gl/period";
import { z } from "zod";

export const dynamic = "force-dynamic";

const DOC_TYPES = [
  "QUOTATION", "SALES_ORDER", "PURCHASE_ORDER", "PURCHASE_REQUISITION", "PROFORMA_INVOICE",
  "COMMERCIAL_INVOICE", "DELIVERY_ORDER", "GOODS_RECEIPT_NOTE", "GOODS_ISSUE", "INVOICE",
  "CREDIT_NOTE", "DEBIT_NOTE", "PAYMENT_VOUCHER", "RECEIPT", "WRITE_OFF", "EXPENSE",
  "JOURNAL", "CONTRACT", "PROJECT", "PURCHASE_RECEIPT", "WAREHOUSE_RECEIPT", "PURCHASE_RETURN",
  "INVENTORY_MOVEMENT", "INVENTORY_TRANSFER", "STOCK_COUNT", "INVENTORY_ADJUSTMENT",
  "INVENTORY_CONVERSION", "SUPPLIER_INVOICE",
] as const;

/** 更新 schema：模板行配置（code/name/docType/prefix/padLength/startNo/periodPattern/perPeriodReset/isActive）
 * 期间行 nextNo 由取号引擎管理，不在模板行 PATCH 中编辑；重置期间序号走 POST /:id/reset。 */
const documentSequenceUpdateSchema = z
  .object({
    code: z.string().min(1).max(64).optional(),
    name: z.string().min(1).max(200).optional(),
    docType: z.enum(DOC_TYPES).optional(),
    prefix: z.string().max(32).nullable().optional(),
    padLength: z.number().int().min(1).max(12).optional(),
    startNo: z.number().int().min(1).optional(),
    periodPattern: z.string().max(64).nullable().optional(),
    perPeriodReset: z.boolean().optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/document-sequences/:id（详情，含编号格式预览） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "document-sequence:view");
  if (denied) return denied;
  requestLog(request, user?.id, "document-sequence.get");

  const { id } = await params;
  const seq = await prisma.documentSequence.findFirst({ where: { id, deletedAt: null } });
  if (!seq) return failNotFound(ERROR_CODES.NOT_FOUND, "单据序列不存在");
  return ok(seq);
}

/** PATCH /api/document-sequences/:id（乐观锁 version；模板行配置编辑，期间行 nextNo 由引擎管理） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "document-sequence:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "document-sequence.update");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = documentSequenceUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;
  const existing = await prisma.documentSequence.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "单据序列不存在");
  

  if (updates.code) {
    const codeExisting = await prisma.documentSequence.findUnique({ where: { code: updates.code } });
    if (codeExisting && codeExisting.id !== id && !codeExisting.deletedAt) {
      return failConflict(ERROR_CODES.CONFLICT, "单据序列编码已存在");
    }
  }

  const cas = await casUpdate(prisma, 'documentSequence', id, version, {
      ...updates,
      docType: updates.docType as DocumentType | undefined,
      updatedById: user?.id ?? null,
    
});
  if (cas.outcome === 'NOT_FOUND') return failNotFound(ERROR_CODES.NOT_FOUND, "单据序列不存在");
  if (cas.outcome === 'CONFLICT') return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  const updated = await prisma.documentSequence.findFirst({ where: { id, deletedAt: null } });
  if (!updated) return failNotFound(ERROR_CODES.NOT_FOUND, "单据序列不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "document-sequence.update",
    entityType: "documentSequence",
    entityId: id,
    beforeData: { code: existing.code, name: existing.name },
    afterData: { code: updated.code, name: updated.name },
    ...meta,
  });

  return ok(updated);
}

/** POST /api/document-sequences/:id/reset（重置期间序号：将指定期间的 nextNo 重置为 startNo；默认当前业务月）
 * 单据序列重构（ADR-0055）：模板行承载配置，期间行 code={docType}:{YYYYMM} 承载按月计数；
 * 重置仅作用于期间行（回拨到 startNo 有与已发号码重复的风险——仅限期间尚未发号或管理员明确跳号修复场景）。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "document-sequence:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "document-sequence.reset");

  const { id } = await params;
  const meta = requestMeta(request);
  const body = await request.json().catch(() => ({}));
  const periodKey =
    typeof body?.periodKey === "string" && /^\d{6}$/.test(body.periodKey)
      ? body.periodKey
      : currentPeriodKey();

  const seq = await prisma.documentSequence.findFirst({ where: { id, deletedAt: null } });
  if (!seq) return failNotFound(ERROR_CODES.NOT_FOUND, "单据序列不存在");
  if (seq.docType === "JOURNAL") {
    return failConflict(ERROR_CODES.CONFLICT, "日记账序列由凭证字引擎管理（记202608-0001），请勿在此重置");
  }

  const periodCode = seq.docType + ":" + periodKey;
  const periodRow = await prisma.documentSequence.findFirst({ where: { code: periodCode } });
  if (!periodRow) {
    return ok({ reset: true, periodKey, nextNo: seq.startNo, existed: false });
  }
  await prisma.documentSequence.update({
    where: { id: periodRow.id },
    data: { nextNo: seq.startNo, updatedById: user?.id ?? null },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "document-sequence.reset",
    entityType: "documentSequence",
    entityId: id,
    afterData: { periodKey, nextNo: seq.startNo },
    ...meta,
  });

  return ok({ reset: true, periodKey, nextNo: seq.startNo, existed: true });
}

/** DELETE /api/document-sequences/:id（软删除） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "document-sequence:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "document-sequence.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const existing = await prisma.documentSequence.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "单据序列不存在");

  await prisma.documentSequence.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "document-sequence.delete",
    entityType: "documentSequence",
    entityId: id,
    ...meta,
  });

  return ok({ id, deleted: true });
}