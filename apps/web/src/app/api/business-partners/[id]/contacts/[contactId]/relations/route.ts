import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failNotFound, failConflict } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { handleServerError } from "@/lib/api/server-error";
import { z } from "zod";

export const dynamic = "force-dynamic";

const relationCreateSchema = z.object({
  targetContactId: z.string().min(1),
  relationType: z.enum(["COLLEAGUE", "REPORTS_TO", "DECISION_MAKER", "INFLUENCER", "RELATIVE", "OTHER"]),
  note: z.string().max(500).nullable().optional(),
});

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; contactId: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "partner-contact:view");
  if (denied) return denied;
  requestLog(request, user?.id, "partner-contact.relations.list");
  const { id, contactId } = await params;
  // 2A-3 Scope Hardening：contactId 必须属于 BusinessPartner :id（fail-closed 404）
  const contact = await prisma.partnerContact.findFirst({ where: { id: contactId, partnerId: id, deletedAt: null } });
  if (!contact) return failNotFound(ERROR_CODES.CONTACT_NOT_FOUND, "联系人不存在");
  const items = await prisma.contactRelation.findMany({
    where: { sourceContactId: contact.id, deletedAt: null },
    include: { targetContact: { select: { id: true, name: true, title: true } } },
  });
  return ok(items);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; contactId: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "partner-contact:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "partner-contact.relations.create");
  const { id, contactId } = await params;
  const meta = requestMeta(request);
  const parsed = relationCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  try {
    if (parsed.data.targetContactId === contactId) {
      return failConflict(ERROR_CODES.CONTACT_RELATION_SELF, "source 与 target 不能相同");
    }
    const source = await prisma.partnerContact.findFirst({ where: { id: contactId, partnerId: id, deletedAt: null } });
    if (!source) return failNotFound(ERROR_CODES.CONTACT_NOT_FOUND, "源联系人不存在");
    const target = await prisma.partnerContact.findFirst({ where: { id: parsed.data.targetContactId, deletedAt: null } });
    if (!target) return failNotFound(ERROR_CODES.CONTACT_NOT_FOUND, "目标联系人不存在");
    // 一期仅同 BusinessPartner 内关系
    if (target.partnerId !== id) {
      return failConflict(ERROR_CODES.CONTACT_RELATION_CROSS_PARTNER, "一期仅允许同一客户内的联系人关系");
    }

    const created = await prisma.contactRelation.create({
      data: {
        sourceContactId: contactId,
        targetContactId: parsed.data.targetContactId,
        relationType: parsed.data.relationType,
        note: parsed.data.note ?? null,
        createdById: user!.id,
        updatedById: user!.id,
      },
    });
    await writeAuditLog({
      actorId: user!.id, action: "partner-contact.relation.create", entityType: "contactRelation",
      entityId: created.id, afterData: { sourceContactId: contactId, targetContactId: parsed.data.targetContactId, relationType: created.relationType }, ...meta,
    });
    return ok(created, undefined, 201);
  } catch (err) {
    return handleServerError(request, user?.id, "partner-contact.relations.create", err);
  }
}
