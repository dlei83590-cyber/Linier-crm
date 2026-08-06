import { NextRequest } from "next/server";
import type { StakeholderRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const stakeholderUpdateSchema = z
  .object({
    role: z.enum(["REQUESTER", "TECHNICAL", "PURCHASER", "DECISION_MAKER", "END_USER"]).optional(),
    name: z.string().min(1).max(100).optional(),
    title: z.string().max(100).nullable().optional(),
    department: z.string().max(100).nullable().optional(),
    phone: z.string().max(50).nullable().optional(),
    email: z.string().email().nullable().optional(),
    note: z.string().max(500).nullable().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/projects/:id/stakeholders/:sid（关系人详情） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; sid: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-stakeholder:view");
  if (denied) return denied;
  requestLog(request, user?.id, "project-stakeholder.get");

  const { id, sid } = await params;
  const item = await prisma.projectStakeholder.findFirst({ where: { id: sid, projectId: id, deletedAt: null } });
  if (!item) return failNotFound(ERROR_CODES.NOT_FOUND, "关系人不存在");
  return ok(item);
}

/** PATCH /api/projects/:id/stakeholders/:sid（乐观锁 version） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; sid: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-stakeholder:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "project-stakeholder.update");

  const { id, sid } = await params;
  const meta = requestMeta(request);
  const parsed = stakeholderUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;
  const existing = await prisma.projectStakeholder.findFirst({ where: { id: sid, projectId: id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "关系人不存在");
  if (existing.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }

  const updated = await prisma.projectStakeholder.update({
    where: { id: sid },
    data: {
      ...updates,
      role: updates.role as StakeholderRole | undefined,
      version: { increment: 1 },
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "project-stakeholder.update",
    entityType: "projectStakeholder",
    entityId: sid,
    beforeData: { name: existing.name, role: existing.role },
    afterData: { name: updated.name, role: updated.role },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/projects/:id/stakeholders/:sid（软删除） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; sid: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-stakeholder:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "project-stakeholder.delete");

  const { id, sid } = await params;
  const meta = requestMeta(request);

  const existing = await prisma.projectStakeholder.findFirst({ where: { id: sid, projectId: id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "关系人不存在");

  await prisma.projectStakeholder.update({
    where: { id: sid },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "project-stakeholder.delete",
    entityType: "projectStakeholder",
    entityId: sid,
    ...meta,
  });

  return ok({ id: sid, deleted: true });
}
