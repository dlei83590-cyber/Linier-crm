import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { handleServerError } from "@/lib/api/server-error";

export const dynamic = "force-dynamic";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; contactId: string; specialDateId: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "partner-contact:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "partner-contact.special-dates.delete");
  const { specialDateId } = await params;
  const meta = requestMeta(request);
  try {
    const existing = await prisma.contactSpecialDate.findFirst({ where: { id: specialDateId, deletedAt: null } });
    if (!existing) return failNotFound(ERROR_CODES.CONTACT_NOT_FOUND, "特殊日期不存在");
    await prisma.contactSpecialDate.update({
      where: { id: specialDateId },
      data: { deletedAt: new Date(), updatedById: user!.id, version: { increment: 1 } },
    });
    await writeAuditLog({
      actorId: user!.id, action: "partner-contact.special-date.delete", entityType: "contactSpecialDate",
      entityId: specialDateId, afterData: { contactId: existing.contactId, type: existing.type }, ...meta,
    });
    return ok({ id: specialDateId, deleted: true });
  } catch (err) {
    return handleServerError(request, user?.id, "partner-contact.special-dates.delete", err);
  }
}
