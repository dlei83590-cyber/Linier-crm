import { NextRequest } from "next/server";
import type { VisitType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog, assertProjectWritable } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const visitUpdateSchema = z
  .object({
    visitType: z.enum(["VISIT", "PHONE", "VIDEO", "MEETING", "OTHER"]).optional(),
    visitedAt: z.string().datetime().optional(),
    visitorId: z.string().min(1).nullable().optional(),
    contactName: z.string().max(100).nullable().optional(),
    summary: z.string().min(1).max(2000).optional(),
    nextAction: z.string().max(500).nullable().optional(),
    reminderAt: z.string().datetime().nullable().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/projects/:id/visits/:vid（走访记录详情） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; vid: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-visit:view");
  if (denied) return denied;
  requestLog(request, user?.id, "project-visit.get");

  const { id, vid } = await params;
  const item = await prisma.projectVisit.findFirst({ where: { id: vid, projectId: id, deletedAt: null } });
  if (!item) return failNotFound(ERROR_CODES.NOT_FOUND, "走访记录不存在");
  return ok(item);
}

/** PATCH /api/projects/:id/visits/:vid（乐观锁 version） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; vid: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-visit:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "project-visit.update");

  const { id, vid } = await params;
  const meta = requestMeta(request);
  const parsed = visitUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const txResult = await prisma.$transaction(async (tx) => {
    const gate = await assertProjectWritable(tx, id);
    if (!gate.ok) return { error: gate.response };


    const { version, ...updates } = parsed.data;
    const existing = await tx.projectVisit.findFirst({ where: { id: vid, projectId: id, deletedAt: null } });
    if (!existing) return { error: failNotFound(ERROR_CODES.NOT_FOUND, "走访记录不存在") };
    if (existing.version !== version) {
      return { error: failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试") };
    }

  const updated = await tx.projectVisit.update({
    where: { id: vid },
    data: {
      ...updates,
      visitType: updates.visitType as VisitType | undefined,
      visitedAt: updates.visitedAt === undefined ? undefined : new Date(updates.visitedAt),
      reminderAt: updates.reminderAt === undefined ? undefined : updates.reminderAt === null ? null : new Date(updates.reminderAt),
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
    action: "project-visit.update",
    entityType: "projectVisit",
    entityId: vid,
    beforeData: { visitType: existing.visitType, summary: existing.summary },
    afterData: { visitType: updated.visitType, summary: updated.summary },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/projects/:id/visits/:vid（软删除） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; vid: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-visit:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "project-visit.delete");

  const { id, vid } = await params;
  const meta = requestMeta(request);

  const txResult = await prisma.$transaction(async (tx) => {
    const gate = await assertProjectWritable(tx, id);
    if (!gate.ok) return { error: gate.response };

    const existing = await tx.projectVisit.findFirst({ where: { id: vid, projectId: id, deletedAt: null } });
    if (!existing) return { error: failNotFound(ERROR_CODES.NOT_FOUND, "走访记录不存在") };

  await tx.projectVisit.update({
    where: { id: vid },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });
    return { ok: true };
  });
  if ("error" in txResult) return txResult.error;

  await writeAuditLog({
    actorId: user?.id,
    action: "project-visit.delete",
    entityType: "projectVisit",
    entityId: vid,
    ...meta,
  });

  return ok({ id: vid, deleted: true });
}
