import { NextRequest } from "next/server";
import type { QualificationType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const qualificationUpdateSchema = z
  .object({
    qualType: z.enum(["BUSINESS_LICENSE", "ISO9001", "ISO14001", "IATF16949", "CE", "ROHS", "OTHER"]).optional(),
    qualName: z.string().min(1).max(200).optional(),
    certNo: z.string().max(100).nullable().optional(),
    issueDate: z.string().datetime().nullable().optional(),
    expireDate: z.string().datetime().nullable().optional(),
    status: z.enum(["VALID", "EXPIRING", "EXPIRED"]).optional(),
    attachment: z.string().max(200).nullable().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** PATCH /api/suppliers/:id/qualifications/:qualId（乐观锁） */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; qualId: string }> },
) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "supplier-qualification:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "supplier-qualification.update");

  const { id, qualId } = await params;
  const meta = requestMeta(request);
  const parsed = qualificationUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;

  const existing = await prisma.supplierQualification.findFirst({
    where: { id: qualId, supplierId: id, deletedAt: null },
  });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "资质不存在");
  if (existing.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }

  const updated = await prisma.supplierQualification.update({
    where: { id: qualId },
    data: {
      ...updates,
      qualType: updates.qualType as QualificationType | undefined,
      issueDate: updates.issueDate === undefined ? undefined : updates.issueDate === null ? null : new Date(updates.issueDate),
      expireDate: updates.expireDate === undefined ? undefined : updates.expireDate === null ? null : new Date(updates.expireDate),
      version: { increment: 1 },
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "supplier-qualification.update",
    entityType: "supplier-qualification",
    entityId: qualId,
    beforeData: { qualName: existing.qualName, status: existing.status },
    afterData: { qualName: updated.qualName, status: updated.status },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/suppliers/:id/qualifications/:qualId（软删除） */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; qualId: string }> },
) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "supplier-qualification:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "supplier-qualification.delete");

  const { id, qualId } = await params;
  const meta = requestMeta(request);

  const result = await prisma.supplierQualification.updateMany({
    where: { id: qualId, supplierId: id, deletedAt: null },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });
  if (result.count === 0) return failNotFound(ERROR_CODES.NOT_FOUND, "资质不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "supplier-qualification.delete",
    entityType: "supplier-qualification",
    entityId: qualId,
    ...meta,
  });

  return ok({ id: qualId, deleted: true });
}
