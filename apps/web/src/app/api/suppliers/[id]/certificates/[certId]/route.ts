import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const certificateUpdateSchema = z
  .object({
    certType: z.string().min(1).max(100).optional(),
    certName: z.string().min(1).max(200).optional(),
    certNo: z.string().max(100).nullable().optional(),
    issueDate: z.string().datetime().nullable().optional(),
    expireDate: z.string().datetime().nullable().optional(),
    attachment: z.string().max(200).nullable().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** PATCH /api/suppliers/:id/certificates/:certId（乐观锁） */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; certId: string }> },
) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "supplier-certificate:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "supplier-certificate.update");

  const { id, certId } = await params;
  const meta = requestMeta(request);
  const parsed = certificateUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;

  const existing = await prisma.supplierCertificate.findFirst({
    where: { id: certId, supplierId: id, deletedAt: null },
  });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "证书不存在");
  if (existing.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }

  const updated = await prisma.supplierCertificate.update({
    where: { id: certId },
    data: {
      ...updates,
      issueDate: updates.issueDate === undefined ? undefined : updates.issueDate === null ? null : new Date(updates.issueDate),
      expireDate: updates.expireDate === undefined ? undefined : updates.expireDate === null ? null : new Date(updates.expireDate),
      version: { increment: 1 },
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "supplier-certificate.update",
    entityType: "supplier-certificate",
    entityId: certId,
    beforeData: { certName: existing.certName },
    afterData: { certName: updated.certName },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/suppliers/:id/certificates/:certId（软删除） */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; certId: string }> },
) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "supplier-certificate:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "supplier-certificate.delete");

  const { id, certId } = await params;
  const meta = requestMeta(request);

  const result = await prisma.supplierCertificate.updateMany({
    where: { id: certId, supplierId: id, deletedAt: null },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });
  if (result.count === 0) return failNotFound(ERROR_CODES.NOT_FOUND, "证书不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "supplier-certificate.delete",
    entityType: "supplier-certificate",
    entityId: certId,
    ...meta,
  });

  return ok({ id: certId, deleted: true });
}
