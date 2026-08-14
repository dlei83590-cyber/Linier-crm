import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog, assertProjectWritable } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const memberUpdateSchema = z
  .object({
    userId: z.string().min(1).nullable().optional(),
    name: z.string().min(1).max(100).optional(),
    roleInProject: z.string().max(100).nullable().optional(),
    joinedAt: z.string().datetime().nullable().optional(),
    leftAt: z.string().datetime().nullable().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/projects/:id/members/:mid（成员详情） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; mid: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-member:view");
  if (denied) return denied;
  requestLog(request, user?.id, "project-member.get");

  const { id, mid } = await params;
  const item = await prisma.projectMember.findFirst({ where: { id: mid, projectId: id, deletedAt: null } });
  if (!item) return failNotFound(ERROR_CODES.NOT_FOUND, "成员不存在");
  return ok(item);
}

/** PATCH /api/projects/:id/members/:mid（乐观锁 version） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; mid: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-member:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "project-member.update");

  const { id, mid } = await params;
  const meta = requestMeta(request);
  const parsed = memberUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const txResult = await prisma.$transaction(async (tx) => {
    const gate = await assertProjectWritable(tx, id);
    if (!gate.ok) return { error: gate.response };


    const { version, ...updates } = parsed.data;
    const existing = await tx.projectMember.findFirst({ where: { id: mid, projectId: id, deletedAt: null } });
    if (!existing) return { error: failNotFound(ERROR_CODES.NOT_FOUND, "成员不存在") };
    if (existing.version !== version) {
      return { error: failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试") };
    }

  const updated = await tx.projectMember.update({
    where: { id: mid },
    data: {
      ...updates,
      joinedAt: updates.joinedAt === undefined ? undefined : updates.joinedAt === null ? null : new Date(updates.joinedAt),
      leftAt: updates.leftAt === undefined ? undefined : updates.leftAt === null ? null : new Date(updates.leftAt),
      version: { increment: 1 },
      updatedById: user!.id,
    },
  });
    return { updated, existing };
  });
  if ("error" in txResult) return txResult.error;
  const { updated, existing } = txResult;

  await writeAuditLog({
    actorId: user?.id,
    action: "project-member.update",
    entityType: "projectMember",
    entityId: mid,
    beforeData: { name: existing.name, roleInProject: existing.roleInProject },
    afterData: { name: updated.name, roleInProject: updated.roleInProject },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/projects/:id/members/:mid（软删除） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; mid: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-member:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "project-member.delete");

  const { id, mid } = await params;
  const meta = requestMeta(request);

  const txResult = await prisma.$transaction(async (tx) => {
    const gate = await assertProjectWritable(tx, id);
    if (!gate.ok) return { error: gate.response };

    const existing = await tx.projectMember.findFirst({ where: { id: mid, projectId: id, deletedAt: null } });
    if (!existing) return { error: failNotFound(ERROR_CODES.NOT_FOUND, "成员不存在") };

  await tx.projectMember.update({
    where: { id: mid },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });
    return { ok: true };
  });
  if ("error" in txResult) return txResult.error;

  await writeAuditLog({
    actorId: user?.id,
    action: "project-member.delete",
    entityType: "projectMember",
    entityId: mid,
    ...meta,
  });

  return ok({ id: mid, deleted: true });
}
