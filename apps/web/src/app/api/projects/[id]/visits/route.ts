import { NextRequest } from "next/server";
import type { VisitType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const visitCreateSchema = z.object({
  visitType: z.enum(["VISIT", "PHONE", "VIDEO", "MEETING", "OTHER"]).optional(),
  visitedAt: z.string().datetime().optional(),
  visitorId: z.string().min(1).nullable().optional(),
  contactName: z.string().max(100).nullable().optional(),
  summary: z.string().min(1).max(2000),
  nextAction: z.string().max(500).nullable().optional(),
  reminderAt: z.string().datetime().nullable().optional(),
});

/** GET /api/projects/:id/visits（客户走访与沟通记录，支持下次行动与提醒，Sprint 3C-5） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-visit:view");
  if (denied) return denied;
  requestLog(request, user?.id, "project-visit.list");

  const { id } = await params;
  const project = await prisma.project.findFirst({ where: { id, deletedAt: null } });
  if (!project) return failConflict(ERROR_CODES.NOT_FOUND, "项目不存在");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const visitType = searchParams.get("visitType")?.trim();
  const contactName = searchParams.get("contactName")?.trim();

  const where = {
    projectId: id,
    deletedAt: null,
    ...(visitType ? { visitType: visitType as VisitType } : {}),
    ...(contactName ? { contactName: { contains: contactName } } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.projectVisit.count({ where }),
    prisma.projectVisit.findMany({ where, orderBy: { visitedAt: "desc" }, skip, take }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/projects/:id/visits（新增走访/沟通记录） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-visit:create");
  if (denied) return denied;
  requestLog(request, user?.id, "project-visit.create");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = visitCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const project = await prisma.project.findFirst({ where: { id, deletedAt: null } });
  if (!project) return failConflict(ERROR_CODES.NOT_FOUND, "项目不存在");

  const created = await prisma.projectVisit.create({
    data: {
      projectId: id,
      visitType: (parsed.data.visitType as VisitType) ?? "VISIT",
      visitedAt: parsed.data.visitedAt ? new Date(parsed.data.visitedAt) : new Date(),
      visitorId: parsed.data.visitorId ?? null,
      contactName: parsed.data.contactName ?? null,
      summary: parsed.data.summary,
      nextAction: parsed.data.nextAction ?? null,
      reminderAt: parsed.data.reminderAt ? new Date(parsed.data.reminderAt) : null,
      approvalStatus: "APPROVED",
      createdById: user!.id,
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "project-visit.create",
    entityType: "projectVisit",
    entityId: created.id,
    afterData: { projectId: id, visitType: created.visitType, summary: created.summary },
    ...meta,
  });

  return ok(created, undefined, 201);
}
