import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { handleServerError } from "@/lib/api/server-error";

export const dynamic = "force-dynamic";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; contactId: string; relationId: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "partner-contact:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "partner-contact.relations.delete");
  const { id, contactId, relationId } = await params;
  const meta = requestMeta(request);
  try {
    // 2A-3 Scope Hardening：relation 必须属于 :contactId 且 sourceContact 属于 BusinessPartner :id（fail-closed 404）
    const existing = await prisma.contactRelation.findFirst({
      where: { id: relationId, deletedAt: null, sourceContactId: contactId, sourceContact: { partnerId: id } },
    });
    if (!existing) return failNotFound(ERROR_CODES.CONTACT_RELATION_NOT_FOUND, "联系人关系不存在");
    await prisma.contactRelation.update({
      where: { id: relationId },
      data: { deletedAt: new Date(), updatedById: user!.id, version: { increment: 1 } },
    });
    await writeAuditLog({
      actorId: user!.id, action: "partner-contact.relation.delete", entityType: "contactRelation",
      entityId: relationId, afterData: { sourceContactId: existing.sourceContactId, relationType: existing.relationType }, ...meta,
    });
    return ok({ id: relationId, deleted: true });
  } catch (err) {
    return handleServerError(request, user?.id, "partner-contact.relations.delete", err);
  }
}
