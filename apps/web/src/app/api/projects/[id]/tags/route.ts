import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog, assertProjectWritable } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const tagCreateSchema = z.object({
  tagId: z.string().min(1),
});

/** GET /api/projects/:id/tags（项目标签，复用全局 Tag 主数据，Sprint 3C-5） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-tag:view");
  if (denied) return denied;
  requestLog(request, user?.id, "project-tag.list");

  const { id } = await params;
  const project = await prisma.project.findFirst({ where: { id, deletedAt: null } });
  if (!project) return failConflict(ERROR_CODES.NOT_FOUND, "项目不存在");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);

  const where = { projectId: id, deletedAt: null };
  const [total, items] = await Promise.all([
    prisma.projectTag.count({ where }),
    prisma.projectTag.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip,
      take,
      include: { tag: { select: { id: true, code: true, name: true, color: true } } },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/projects/:id/tags（打标签；重复 projectId+tagId → 409） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-tag:create");
  if (denied) return denied;
  requestLog(request, user?.id, "project-tag.create");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = tagCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const writableErr = await assertProjectWritable(id);
  if (writableErr) return writableErr;

  const tag = await prisma.tag.findFirst({ where: { id: parsed.data.tagId, deletedAt: null, enabled: true } });
  if (!tag) return failConflict(ERROR_CODES.NOT_FOUND, "标签不存在或已停用");

  const existing = await prisma.projectTag.findUnique({
    where: { projectId_tagId: { projectId: id, tagId: parsed.data.tagId } },
  });
  if (existing && !existing.deletedAt) {
    return failConflict(ERROR_CODES.CONFLICT, "该标签已绑定此项目");
  }

  const created = await prisma.projectTag.create({
    data: {
      projectId: id,
      tagId: parsed.data.tagId,
      approvalStatus: "APPROVED",
      createdById: user!.id,
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "project-tag.create",
    entityType: "projectTag",
    entityId: created.id,
    afterData: { projectId: id, tagId: created.tagId },
    ...meta,
  });

  return ok(created, undefined, 201);
}
