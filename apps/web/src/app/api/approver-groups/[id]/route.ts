import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { casUpdate } from "@/lib/api/cas";
import { authenticate, requirePermission, clientIp, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { approverGroupUpdateSchema } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";

/** GET /api/approver-groups/:id */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "approver-group:view");
  if (denied) return denied;
  requestLog(request, user?.id, "approver-group.get");

  const { id } = await params;
  const group = await prisma.approverGroup.findFirst({
    where: { id, deletedAt: null },
    include: { members: { where: { deletedAt: null } } },
  });
  if (!group) {
    return failNotFound(ERROR_CODES.APPROVER_GROUP_NOT_FOUND, "审批组不存在");
  }
  return ok(group);
}

/** PATCH /api/approver-groups/:id（乐观锁；成员全量替换） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "approver-group:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "approver-group.update");

  const { id } = await params;
  const parsed = approverGroupUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, memberUserIds, ...updates } = parsed.data;

  const existing = await prisma.approverGroup.findFirst({ where: { id, deletedAt: null } });
  if (!existing) {
    return failNotFound(ERROR_CODES.APPROVER_GROUP_NOT_FOUND, "审批组不存在");
  }

  // A4-CAS：原子乐观锁置于事务首部（头部字段 CAS；成员替换紧随其后，不再二次 bump version）
  const result = await prisma.$transaction(async (tx) => {
    const cas = await casUpdate(tx, "approverGroup", id, version, {
      ...(updates.name !== undefined ? { name: updates.name } : {}),
      ...(updates.description !== undefined ? { description: updates.description } : {}),
      ...(updates.code !== undefined ? { code: updates.code } : {}),
      updatedById: user!.id,
    });
    if (cas.outcome !== "OK") return cas;
    const g = await tx.approverGroup.update({
      where: { id },
      data: memberUserIds
        ? {
            members: {
              deleteMany: {},
              create: memberUserIds.map((userId) => ({
                userId,
                createdById: user!.id,
                updatedById: user!.id,
              })),
            },
          }
        : {},
      include: { members: { where: { deletedAt: null } } },
    });
    return { outcome: "OK" as const, group: g };
  });
  if (result.outcome === "NOT_FOUND") {
    return failNotFound(ERROR_CODES.APPROVER_GROUP_NOT_FOUND, "审批组不存在");
  }
  if (result.outcome === "CONFLICT") {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }
  const updated = result.group;

  await writeAuditLog({
    actorId: user?.id,
    action: "approver-group.update",
    entityType: "approver-group",
    entityId: id,
    ipAddress: clientIp(request),
    meta: { version: updated.version },
  });

  return ok(updated);
}

/** DELETE /api/approver-groups/:id（软删除） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "approver-group:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "approver-group.delete");

  const { id } = await params;
  const result = await prisma.approverGroup.updateMany({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });
  if (result.count === 0) {
    return failNotFound(ERROR_CODES.APPROVER_GROUP_NOT_FOUND, "审批组不存在");
  }

  await writeAuditLog({
    actorId: user?.id,
    action: "approver-group.delete",
    entityType: "approver-group",
    entityId: id,
    ipAddress: clientIp(request),
  });

  return ok({ id, deleted: true });
}
