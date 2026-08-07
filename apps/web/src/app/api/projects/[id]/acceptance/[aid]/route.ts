import { NextRequest } from "next/server";
import type { AcceptanceResult } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const acceptanceUpdateSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    expectedDate: z.string().datetime().nullable().optional(),
    actualDate: z.string().datetime().nullable().optional(),
    result: z.enum(["PASSED", "CONDITIONAL_PASS", "FAILED", "PENDING"]).optional(),
    resultNote: z.string().max(1000).nullable().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/projects/:id/acceptance/:aid（验收项详情） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; aid: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-acceptance:view");
  if (denied) return denied;
  requestLog(request, user?.id, "project-acceptance.get");

  const { id, aid } = await params;
  const item = await prisma.projectAcceptance.findFirst({ where: { id: aid, projectId: id, deletedAt: null } });
  if (!item) return failNotFound(ERROR_CODES.NOT_FOUND, "验收项不存在");
  return ok(item);
}

/** PATCH /api/projects/:id/acceptance/:aid（乐观锁 version） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; aid: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-acceptance:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "project-acceptance.update");

  const { id, aid } = await params;
  const meta = requestMeta(request);
  const parsed = acceptanceUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;
  const existing = await prisma.projectAcceptance.findFirst({ where: { id: aid, projectId: id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "验收项不存在");
  if (existing.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }

  const updated = await prisma.projectAcceptance.update({
    where: { id: aid },
    data: {
      ...updates,
      result: updates.result as AcceptanceResult | undefined,
      expectedDate: updates.expectedDate === undefined ? undefined : updates.expectedDate === null ? null : new Date(updates.expectedDate),
      actualDate: updates.actualDate === undefined ? undefined : updates.actualDate === null ? null : new Date(updates.actualDate),
      version: { increment: 1 },
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "project-acceptance.update",
    entityType: "projectAcceptance",
    entityId: aid,
    beforeData: { name: existing.name, result: existing.result },
    afterData: { name: updated.name, result: updated.result },
    ...meta,
  });

  // Domain Event：ProjectAccepted（当更新后 result=PASSED）

  return ok(updated);
}

/** DELETE /api/projects/:id/acceptance/:aid（软删除） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; aid: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-acceptance:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "project-acceptance.delete");

  const { id, aid } = await params;
  const meta = requestMeta(request);

  const existing = await prisma.projectAcceptance.findFirst({ where: { id: aid, projectId: id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "验收项不存在");

  await prisma.projectAcceptance.update({
    where: { id: aid },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "project-acceptance.delete",
    entityType: "projectAcceptance",
    entityId: aid,
    ...meta,
  });

  return ok({ id: aid, deleted: true });
}
