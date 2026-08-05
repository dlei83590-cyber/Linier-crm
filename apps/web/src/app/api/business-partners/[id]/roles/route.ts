import { NextRequest } from "next/server";
import type { PartnerRoleType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const roleCreateSchema = z.object({
  roleType: z.enum(["CUSTOMER", "SUPPLIER", "BOTH", "LOGISTICS", "OUTSOURCING"]),
  isPrimary: z.boolean().default(false),
});

/** GET /api/business-partners/:id/roles（BusinessPartnerRole 角色列表，BusinessPartner 唯一主体） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "business-partner-role:view");
  if (denied) return denied;
  requestLog(request, user?.id, "business-partner-role.list");

  const { id } = await params;
  const partner = await prisma.businessPartner.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!partner) return failNotFound(ERROR_CODES.NOT_FOUND, "往来单位不存在");

  const roles = await prisma.businessPartnerRole.findMany({
    where: { partnerId: id, deletedAt: null },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
  return ok(roles);
}

/** POST /api/business-partners/:id/roles（新增角色；角色可无限扩展） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "business-partner-role:create");
  if (denied) return denied;
  requestLog(request, user?.id, "business-partner-role.create");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = roleCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const partner = await prisma.businessPartner.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!partner) return failNotFound(ERROR_CODES.NOT_FOUND, "往来单位不存在");

  const existing = await prisma.businessPartnerRole.findFirst({
    where: { partnerId: id, roleType: parsed.data.roleType, deletedAt: null },
  });
  if (existing) return failConflict(ERROR_CODES.CONFLICT, "该角色已存在");

  const created = await prisma.$transaction(async (tx) => {
    if (parsed.data.isPrimary) {
      await tx.businessPartnerRole.updateMany({
        where: { partnerId: id, deletedAt: null },
        data: { isPrimary: false, updatedById: user?.id ?? null },
      });
    }
    return tx.businessPartnerRole.create({
      data: { partnerId: id, roleType: parsed.data.roleType as PartnerRoleType, isPrimary: parsed.data.isPrimary, createdById: user!.id, updatedById: user!.id },
    });
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "business-partner-role.create",
    entityType: "business-partner-role",
    entityId: created.id,
    meta: { partnerId: id, roleType: created.roleType },
    ...meta,
  });

  return ok(created, undefined, 201);
}

/** DELETE /api/business-partners/:id/roles/:roleId（移除角色，软删除） */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; roleId: string }> },
) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "business-partner-role:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "business-partner-role.delete");

  const { id, roleId } = await params;
  const meta = requestMeta(request);

  const result = await prisma.businessPartnerRole.updateMany({
    where: { id: roleId, partnerId: id, deletedAt: null },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });
  if (result.count === 0) return failNotFound(ERROR_CODES.NOT_FOUND, "角色不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "business-partner-role.delete",
    entityType: "business-partner-role",
    entityId: roleId,
    meta: { partnerId: id },
    ...meta,
  });

  return ok({ id: roleId, deleted: true });
}
