import { NextRequest } from "next/server";
import type { RiskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog, assertProjectWritable } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const riskCreateSchema = z.object({
  description: z.string().min(1).max(1000),
  impact: z.string().max(500).nullable().optional(),
  probability: z.enum(["HIGH", "MEDIUM", "LOW"]).nullable().optional(),
  mitigation: z.string().max(1000).nullable().optional(),
  ownerId: z.string().min(1).nullable().optional(),
  status: z.enum(["OPEN", "MITIGATING", "CLOSED"]).optional(),
});

/** GET /api/projects/:id/risks（项目风险，含应对方案/责任人/关闭状态，Sprint 3C-5） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-risk:view");
  if (denied) return denied;
  requestLog(request, user?.id, "project-risk.list");

  const { id } = await params;
  const project = await prisma.project.findFirst({ where: { id, deletedAt: null } });
  if (!project) return failConflict(ERROR_CODES.NOT_FOUND, "项目不存在");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const status = searchParams.get("status")?.trim();
  const probability = searchParams.get("probability")?.trim();

  const where = {
    projectId: id,
    deletedAt: null,
    ...(status ? { status: status as RiskStatus } : {}),
    ...(probability ? { probability } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.projectRisk.count({ where }),
    prisma.projectRisk.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/projects/:id/risks（新增风险；触发 ProjectRiskRaised Domain Event） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-risk:create");
  if (denied) return denied;
  requestLog(request, user?.id, "project-risk.create");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = riskCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const writableErr = await assertProjectWritable(id);
  if (writableErr) return writableErr;

  const created = await prisma.projectRisk.create({
    data: {
      projectId: id,
      description: parsed.data.description,
      impact: parsed.data.impact ?? null,
      probability: parsed.data.probability ?? null,
      mitigation: parsed.data.mitigation ?? null,
      ownerId: parsed.data.ownerId ?? null,
      status: (parsed.data.status as RiskStatus) ?? "OPEN",
      approvalStatus: "APPROVED",
      createdById: user!.id,
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "project-risk.create",
    entityType: "projectRisk",
    entityId: created.id,
    afterData: { projectId: id, description: created.description, status: created.status },
    ...meta,
  });

  // Domain Event：ProjectRiskRaised（EVENTS.md 注册；事件总线 Sprint 4 前落地）

  return ok(created, undefined, 201);
}
