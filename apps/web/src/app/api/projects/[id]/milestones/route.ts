import { NextRequest } from "next/server";
import type { MilestoneStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog, assertProjectWritable } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const milestoneCreateSchema = z.object({
  name: z.string().min(1).max(200),
  plannedDate: z.string().datetime().nullable().optional(),
  actualDate: z.string().datetime().nullable().optional(),
  status: z.enum(["PLANNED", "IN_PROGRESS", "COMPLETED", "DELAYED"]).optional(),
  deliverable: z.string().max(500).nullable().optional(),
  delayReason: z.string().max(500).nullable().optional(),
});

/** GET /api/projects/:id/milestones（项目里程碑列表，Sprint 3C-5） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-milestone:view");
  if (denied) return denied;
  requestLog(request, user?.id, "project-milestone.list");

  const { id } = await params;
  const project = await prisma.project.findFirst({ where: { id, deletedAt: null } });
  if (!project) return failConflict(ERROR_CODES.NOT_FOUND, "项目不存在");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const status = searchParams.get("status")?.trim();
  const name = searchParams.get("name")?.trim();

  const where = {
    projectId: id,
    deletedAt: null,
    ...(status ? { status: status as MilestoneStatus } : {}),
    ...(name ? { name: { contains: name } } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.projectMilestone.count({ where }),
    prisma.projectMilestone.findMany({ where, orderBy: [{ plannedDate: "asc" }, { createdAt: "asc" }], skip, take }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/projects/:id/milestones（新增里程碑；COMPLETED 触发 ProjectMilestoneCompleted） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-milestone:create");
  if (denied) return denied;
  requestLog(request, user?.id, "project-milestone.create");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = milestoneCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const txResult = await prisma.$transaction(async (tx) => {
    const gate = await assertProjectWritable(tx, id);
    if (!gate.ok) return { error: gate.response };

  const created = await tx.projectMilestone.create({
    data: {
      projectId: id,
      name: parsed.data.name,
      plannedDate: parsed.data.plannedDate ? new Date(parsed.data.plannedDate) : null,
      actualDate: parsed.data.actualDate ? new Date(parsed.data.actualDate) : null,
      status: (parsed.data.status as MilestoneStatus) ?? "PLANNED",
      deliverable: parsed.data.deliverable ?? null,
      delayReason: parsed.data.delayReason ?? null,
      approvalStatus: "APPROVED",
      createdById: user!.id,
      updatedById: user!.id,
    },
  });
    return { created };
  });
  if ("error" in txResult) return txResult.error;
  const created = txResult.created;

  await writeAuditLog({
    actorId: user?.id,
    action: "project-milestone.create",
    entityType: "projectMilestone",
    entityId: created.id,
    afterData: { projectId: id, name: created.name, status: created.status },
    ...meta,
  });

  return ok(created, undefined, 201);
}
