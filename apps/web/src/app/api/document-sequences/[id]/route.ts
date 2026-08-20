import { NextRequest } from "next/server";
import type { DocumentType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { casUpdate } from "@/lib/api/cas";
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

/** 更新 schema：nextNo 不可由客户端修改（编号引擎唯一事实源，防跳号/并发错号） */
const documentSequenceUpdateSchema = z
  .object({
    code: z.string().min(1).max(64).optional(),
    name: z.string().min(1).max(200).optional(),
    docType: z.enum(DOC_TYPES).optional(),
    prefix: z.string().max(32).nullable().optional(),
    padLength: z.number().int().min(1).max(12).optional(),
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

/** PATCH /api/document-sequences/:id（乐观锁 version；nextNo 只读） */
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