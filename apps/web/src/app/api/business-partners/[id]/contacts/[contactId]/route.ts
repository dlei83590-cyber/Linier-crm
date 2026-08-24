import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound, failServer } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { handleServerError } from "@/lib/api/server-error";
import { z } from "zod";

export const dynamic = "force-dynamic";

const contactUpdateSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    title: z.string().max(100).nullable().optional(),
    department: z.string().max(100).nullable().optional(),
    phone: z.string().max(50).nullable().optional(),
    mobile: z.string().max(50).nullable().optional(),
    email: z.string().max(200).nullable().optional(),
    wechat: z.string().max(100).nullable().optional(),
    contactNote: z.string().max(500).nullable().optional(),
    isPrimary: z.boolean().optional(),
    sort: z.coerce.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** PATCH /api/business-partners/:id/contacts/:contactId（partner-contact:edit；CAS；isPrimary 事务内排他 + partial unique 兜底） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; contactId: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "partner-contact:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "partner-contact.update");
  const { id, contactId } = await params;
  const meta = requestMeta(request);
  const parsed = contactUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const contact = await tx.partnerContact.findFirst({ where: { id: contactId, partnerId: id, deletedAt: null } });
      if (!contact) throw new Error("NOT_FOUND");
      if (contact.version !== parsed.data.version) throw new Error("VERSION_CONFLICT");

      // 主联系人唯一性：设为 primary 时同事务清除其他 active primary
      if (parsed.data.isPrimary) {
        await tx.partnerContact.updateMany({
          where: { partnerId: id, isPrimary: true, isActive: true, deletedAt: null, id: { not: contactId } },
          data: { isPrimary: false, updatedById: user!.id },
        });
      }

      const { version, ...updates } = parsed.data;
      const cas = await tx.partnerContact.updateMany({
        where: { id: contactId, partnerId: id, version, deletedAt: null },
        data: { ...updates, updatedById: user!.id, version: { increment: 1 } },
      });
      if (cas.count !== 1) throw new Error("VERSION_CONFLICT");
      return tx.partnerContact.findFirstOrThrow({ where: { id: contactId, deletedAt: null } });
    });

    await writeAuditLog({
      actorId: user!.id, action: "partner-contact.update", entityType: "partnerContact",
      entityId: contactId, afterData: { name: updated.name, isPrimary: updated.isPrimary, isActive: updated.isActive }, ...meta,
    });
    return ok(updated);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && (err as { code?: unknown }).code === "P2002") {
      return failConflict(ERROR_CODES.CONTACT_PRIMARY_CONFLICT, "并发设置主联系人冲突，请重试");
    }
    if (err instanceof Error && err.message === "NOT_FOUND") return failNotFound(ERROR_CODES.CONTACT_NOT_FOUND, "联系人不存在");
    if (err instanceof Error && err.message === "VERSION_CONFLICT") return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
    return handleServerError(request, user?.id, "partner-contact.update", err);
  }
}

/** DELETE /api/business-partners/:id/contacts/:contactId（partner-contact:delete；软删：deletedAt=now 且 isActive=false） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; contactId: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "partner-contact:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "partner-contact.delete");
  const { id, contactId } = await params;
  const meta = requestMeta(request);

  try {
    const deleted = await prisma.$transaction(async (tx) => {
      const contact = await tx.partnerContact.findFirst({ where: { id: contactId, partnerId: id, deletedAt: null } });
      if (!contact) throw new Error("NOT_FOUND");
      const now = new Date();
      await tx.partnerContact.update({
        where: { id: contactId },
        data: { deletedAt: now, isActive: false, updatedById: user!.id, version: { increment: 1 } },
      });
      return contact;
    });
    await writeAuditLog({
      actorId: user!.id, action: "partner-contact.delete", entityType: "partnerContact",
      entityId: contactId, afterData: { partnerId: id, name: deleted.name, deletedAt: new Date().toISOString() }, ...meta,
    });
    return ok({ id: contactId, deleted: true });
  } catch (err) {
    if (err instanceof Error && err.message === "NOT_FOUND") return failNotFound(ERROR_CODES.CONTACT_NOT_FOUND, "联系人不存在");
    return handleServerError(request, user?.id, "partner-contact.delete", err);
  }
}
