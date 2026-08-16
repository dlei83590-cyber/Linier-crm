import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog, assertProjectWritable } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const progressCreateSchema = z.object({
  recordedAt: z.string().datetime().optional(),
  progressPercent: z.coerce.number().min(0).max(100),
  summary: z.string().min(1).max(2000),
});

/** GET /api/projects/:id/progress（项目进展记录；写时同步 Project.progressPercent，Sprint 3C-5） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-progress:view");
  if (denied) return denied;
  requestLog(request, user?.id, "project-progress.list");

  const { id } = await params;
  const project = await prisma.project.findFirst({ where: { id, deletedAt: null } });
  if (!project) return failConflict(ERROR_CODES.NOT_FOUND, "项目不存在");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);

  const where = { projectId: id, deletedAt: null };
  const [total, items] = await Promise.all([
    prisma.projectProgress.count({ where }),
    prisma.projectProgress.findMany({ where, orderBy: { recordedAt: "desc" }, skip, take }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/projects/:id/progress（新增进展；同步 Project.progressPercent 汇总字段） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-progress:create");
  if (denied) return denied;
  requestLog(request, user?.id, "project-progress.create");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = progressCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const txResult = await prisma.$transaction(async (tx) => {
    const gate = await assertProjectWritable(tx, id);
    if (!gate.ok) return { error: gate.response };

    const progress = await tx.projectProgress.create({
      data: {
        projectId: id,
        recordedAt: parsed.data.recordedAt ? new Date(parsed.data.recordedAt) : new Date(),
        progressPercent: parsed.data.progressPercent,
        summary: parsed.data.summary,
        approvalStatus: "APPROVED",
        createdById: user!.id,
        updatedById: user!.id,
      },
    });
    // 同步 Project 汇总进度（CTO #3C5：progressPercent 最小增量字段）
    await tx.project.update({
      where: { id },
      data: { progressPercent: parsed.data.progressPercent, updatedById: user!.id },
    });
    return { created: progress };
  });
  if ("error" in txResult) return txResult.error;
  const created = txResult.created;

  await writeAuditLog({
    actorId: user?.id,
    action: "project-progress.create",
    entityType: "projectProgress",
    entityId: created.id,
    afterData: { projectId: id, progressPercent: created.progressPercent, summary: created.summary },
    ...meta,
  });

  return ok(created, undefined, 201);
}
