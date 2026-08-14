import { NextRequest } from "next/server";
import type { StakeholderRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog, assertProjectWritable } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const stakeholderCreateSchema = z.object({
  role: z.enum(["REQUESTER", "TECHNICAL", "PURCHASER", "DECISION_MAKER", "END_USER"]),
  name: z.string().min(1).max(100),
  title: z.string().max(100).nullable().optional(),
  department: z.string().max(100).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  email: z.string().email().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

/** GET /api/projects/:id/stakeholders（项目客户关系人，与内部成员分开，Sprint 3C-5） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-stakeholder:view");
  if (denied) return denied;
  requestLog(request, user?.id, "project-stakeholder.list");

  const { id } = await params;
  const project = await prisma.project.findFirst({ where: { id, deletedAt: null } });
  if (!project) return failConflict(ERROR_CODES.NOT_FOUND, "项目不存在");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const role = searchParams.get("role")?.trim();
  const name = searchParams.get("name")?.trim();

  const where = {
    projectId: id,
    deletedAt: null,
    ...(role ? { role: role as StakeholderRole } : {}),
    ...(name ? { name: { contains: name } } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.projectStakeholder.count({ where }),
    prisma.projectStakeholder.findMany({ where, orderBy: [{ role: "asc" }, { createdAt: "asc" }], skip, take }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/projects/:id/stakeholders（新增客户关系人） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-stakeholder:create");
  if (denied) return denied;
  requestLog(request, user?.id, "project-stakeholder.create");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = stakeholderCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const txResult = await prisma.$transaction(async (tx) => {
    const gate = await assertProjectWritable(tx, id);
    if (!gate.ok) return { error: gate.response };

  const created = await tx.projectStakeholder.create({
    data: {
      projectId: id,
      role: parsed.data.role as StakeholderRole,
      name: parsed.data.name,
      title: parsed.data.title ?? null,
      department: parsed.data.department ?? null,
      phone: parsed.data.phone ?? null,
      email: parsed.data.email ?? null,
      note: parsed.data.note ?? null,
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
    action: "project-stakeholder.create",
    entityType: "projectStakeholder",
    entityId: created.id,
    afterData: { projectId: id, role: created.role, name: created.name },
    ...meta,
  });

  return ok(created, undefined, 201);
}
