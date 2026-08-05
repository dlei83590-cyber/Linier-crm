import { NextRequest } from "next/server";
import type { AttachmentType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failNotFound, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const attachmentCreateSchema = z.object({
  fileId: z.string().min(1),
  attachmentType: z.enum(["DRAWING", "CERTIFICATE", "PHOTO", "MANUAL", "MODEL_3D", "VIDEO", "INSPECTION_REPORT"]).optional(),
  sort: z.number().int().default(0),
});

/** GET /api/items/:id/attachments（附件列表，复用 File Center FileAttachment，businessType=item） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item-attachment:view");
  if (denied) return denied;
  requestLog(request, user?.id, "item-attachment.list");

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);

  const item = await prisma.item.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!item) return failNotFound(ERROR_CODES.NOT_FOUND, "物料不存在");

  const [total, items] = await Promise.all([
    prisma.fileAttachment.count({ where: { businessType: "item", businessId: id, deletedAt: null } }),
    prisma.fileAttachment.findMany({
      where: { businessType: "item", businessId: id, deletedAt: null },
      orderBy: [{ sort: "asc" }, { createdAt: "desc" }],
      skip,
      take,
      include: { file: { select: { id: true, name: true, mimeType: true, size: true, storagePath: true } } },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/items/:id/attachments（关联附件，写入 FileAttachment businessType=item） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item-attachment:create");
  if (denied) return denied;
  requestLog(request, user?.id, "item-attachment.create");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = attachmentCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const item = await prisma.item.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!item) return failNotFound(ERROR_CODES.NOT_FOUND, "物料不存在");

  const file = await prisma.file.findFirst({ where: { id: parsed.data.fileId, deletedAt: null } });
  if (!file) return failNotFound(ERROR_CODES.NOT_FOUND, "文件不存在");

  const created = await prisma.fileAttachment.create({
    data: {
      fileId: parsed.data.fileId,
      businessType: "item",
      businessId: id,
      attachmentType: parsed.data.attachmentType as AttachmentType | undefined,
      sort: parsed.data.sort,
      createdById: user!.id,
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "item-attachment.create",
    entityType: "item-attachment",
    entityId: created.id,
    meta: { itemId: id, fileId: parsed.data.fileId, attachmentType: created.attachmentType },
    ...meta,
  });

  return ok(created, undefined, 201);
}
