import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog, assertProjectWritable } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const progressUpdateSchema = z
  .object({
    recordedAt: z.string().datetime().optional(),
    progressPercent: z.coerce.number().min(0).max(100).optional(),
    summary: z.string().min(1).max(2000).optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/projects/:id/progress/:prid（进展记录详情） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; prid: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-progress:view");
  if (denied) return denied;
  requestLog(request, user?.id, "project-progress.get");

  const { id, prid } = await params;
  const item = await prisma.projectProgress.findFirst({ where: { id: prid, projectId: id, deletedAt: null } });
  if (!item) return failNotFound(ERROR_CODES.NOT_FOUND, "进展记录不存在");
  return ok(item);
}

/** PATCH /api/projects/:id/progress/:prid（乐观锁 version） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; prid: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-progress:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "project-progress.update");

  const { id, prid } = await params;
  const meta = requestMeta(request);
  const parsed = progressUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;
  const txResult = await prisma.$transaction(async (tx) => {
    const gate = await assertProjectWritable(tx, id);
    if (!gate.ok) return { error: gate.response };

    const existing = await tx.projectProgress.findFirst({ where: { id: prid, projectId: id, deletedAt: null } });
    if (!existing) return { error: failNotFound(ERROR_CODES.NOT_FOUND, "进展记录不存在") };
    if (existing.version !== version) {
      return { error: failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试") };
    }

    const updated = await tx.projectProgress.update({
      where: { id: prid },
      data: {
        ...updates,
        recordedAt: updates.recordedAt === undefined ? undefined : new Date(updates.recordedAt),
        version: { increment: 1 },
        updatedById: user!.id,
      },
    });
    // B2-2B Backend Aggregate Integrity：Project.progressPercent = 最近一次写入（create/edit）的非删除 Progress 记录进度。
    // PATCH 使本条成为「最近写入」，故同步 header（与 POST 语义一致，均在 assertProjectWritable 锁内同事务）。
    await tx.project.update({
      where: { id },
      data: { progressPercent: updated.progressPercent, updatedById: user!.id },
    });
    return { existing, updated };
  });
  if ("error" in txResult) return txResult.error;

  await writeAuditLog({
    actorId: user?.id,
    action: "project-progress.update",
    entityType: "projectProgress",
    entityId: prid,
    beforeData: { progressPercent: txResult.existing.progressPercent, summary: txResult.existing.summary },
    afterData: { progressPercent: txResult.updated.progressPercent, summary: txResult.updated.summary },
    ...meta,
  });

  return ok(txResult.updated);
}

/** DELETE /api/projects/:id/progress/:prid（软删除） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; prid: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-progress:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "project-progress.delete");

  const { id, prid } = await params;
  const meta = requestMeta(request);

  const txResult = await prisma.$transaction(async (tx) => {
    const gate = await assertProjectWritable(tx, id);
    if (!gate.ok) return { error: gate.response };

    const existing = await tx.projectProgress.findFirst({ where: { id: prid, projectId: id, deletedAt: null } });
    if (!existing) return { error: failNotFound(ERROR_CODES.NOT_FOUND, "进展记录不存在") };

    await tx.projectProgress.update({
      where: { id: prid },
      data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
    });
    // B2-2B Backend Aggregate Integrity：删除后 header 回退到剩余记录中「最近写入」（updatedAt desc）的 progressPercent；
    // 无剩余记录 → null（明确语义：进度清空，不保留被删记录旧值）。同一事务 + assertProjectWritable 锁内。
    const latestRemaining = await tx.projectProgress.findFirst({
      where: { projectId: id, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      select: { progressPercent: true },
    });
    await tx.project.update({
      where: { id },
      data: { progressPercent: latestRemaining?.progressPercent ?? null, updatedById: user!.id },
    });
    return { ok: true };
  });
  if ("error" in txResult) return txResult.error;

  await writeAuditLog({
    actorId: user?.id,
    action: "project-progress.delete",
    entityType: "projectProgress",
    entityId: prid,
    ...meta,
  });

  return ok({ id: prid, deleted: true });
}
