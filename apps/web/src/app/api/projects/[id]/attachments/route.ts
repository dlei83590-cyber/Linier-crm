import { NextRequest } from "next/server";
import type { AttachmentType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog, assertProjectWritable } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const attachmentCreateSchema = z.object({
  fileId: z.string().min(1),
  attachmentType: z.enum(["DRAWING", "CERTIFICATE", "PHOTO", "MANUAL", "MODEL_3D", "VIDEO", "INSPECTION_REPORT"]).optional(),
  sort: z.number().int().min(0).optional(),
});

/** GET /api/projects/:id/attachments（项目附件，统一走 File Center FileAttachment(businessType="project")，Sprint 3C-5） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-attachment:view");
  if (denied) return denied;
  requestLog(request, user?.id, "project-attachment.list");

  const { id } = await params;
  const project = await prisma.project.findFirst({ where: { id, deletedAt: null } });
  if (!project) return failConflict(ERROR_CODES.NOT_FOUND, "项目不存在");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);

  const where = { businessType: "project", businessId: id, deletedAt: null };
  const [total, items] = await Promise.all([
    prisma.fileAttachment.count({ where }),
    prisma.fileAttachment.findMany({
      where,
      orderBy: [{ sort: "asc" }, { createdAt: "desc" }],
      skip,
      take,
      include: { file: { select: { id: true, code: true, name: true, originalName: true, mimeType: true, size: true, storagePath: true } } },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/projects/:id/attachments（关联附件到项目；附件实体必须在 File Center） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-attachment:create");
  if (denied) return denied;
  requestLog(request, user?.id, "project-attachment.create");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = attachmentCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  // L1-B lifecycle integrity：mutation 与 Project header lock 同事务（B2-0 锁纪律：Project FOR UPDATE → Gate → mutation）；CLOSED → 409
  const txResult = await prisma.$transaction(async (tx) => {
    const gate = await assertProjectWritable(tx, id);
    if (!gate.ok) return { error: gate.response };

    const project = await tx.project.findFirst({ where: { id, deletedAt: null } });
    if (!project) return { error: failConflict(ERROR_CODES.NOT_FOUND, "项目不存在") };

    const file = await tx.file.findFirst({ where: { id: parsed.data.fileId, deletedAt: null } });
    if (!file) return { error: failConflict(ERROR_CODES.NOT_FOUND, "附件文件不存在（请先上传到 File Center）") };

    const created = await tx.fileAttachment.create({
      data: {
        fileId: parsed.data.fileId,
        businessType: "project", // backend authoritative 固定，不接受前端覆盖
        businessId: id,
        attachmentType: parsed.data.attachmentType as AttachmentType | undefined,
        sort: parsed.data.sort ?? 0,
        approvalStatus: "APPROVED",
        createdById: user!.id,
        updatedById: user!.id,
      },
    });
    return { created };
  });
  if ("error" in txResult) return txResult.error;

  await writeAuditLog({
    actorId: user?.id,
    action: "project-attachment.create",
    entityType: "fileAttachment",
    entityId: txResult.created.id,
    afterData: { projectId: id, fileId: txResult.created.fileId, attachmentType: txResult.created.attachmentType },
    ...meta,
  });

  return ok(txResult.created, undefined, 201);
}
