import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const attachmentCreateSchema = z.object({
  fileId: z.string().min(1),
  businessType: z.string().min(1).max(50),
  businessId: z.string().min(1).max(100),
  sort: z.number().int().default(0),
});

/** GET /api/attachments?businessType=&businessId=（按业务单据查附件） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "file-attachment:view");
  if (denied) return denied;
  requestLog(request, user?.id, "file-attachment.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const businessType = searchParams.get("businessType")?.trim();
  const businessId = searchParams.get("businessId")?.trim();

  const where = {
    deletedAt: null,
    ...(businessType ? { businessType } : {}),
    ...(businessId ? { businessId } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.fileAttachment.count({ where }),
    prisma.fileAttachment.findMany({
      where,
      orderBy: [{ sort: "asc" }, { createdAt: "desc" }],
      skip,
      take,
      include: {
        file: { select: { id: true, name: true, mimeType: true, size: true, currentVersion: true } },
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/attachments（文件挂到业务单据） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "file-attachment:create");
  if (denied) return denied;
  requestLog(request, user?.id, "file-attachment.create");

  const meta = requestMeta(request);
  const parsed = attachmentCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const file = await prisma.file.findFirst({ where: { id: parsed.data.fileId, deletedAt: null } });
  if (!file) return failConflict(ERROR_CODES.NOT_FOUND, "文件不存在");

  const dup = await prisma.fileAttachment.findFirst({
    where: {
      fileId: parsed.data.fileId,
      businessType: parsed.data.businessType,
      businessId: parsed.data.businessId,
      deletedAt: null,
    },
  });
  if (dup) return failConflict(ERROR_CODES.CONFLICT, "该文件已挂载到同一业务单据");

  const created = await prisma.fileAttachment.create({
    data: { ...parsed.data, createdById: user!.id, updatedById: user!.id },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "file-attachment.create",
    entityType: "file-attachment",
    entityId: created.id,
    meta: { fileId: parsed.data.fileId, businessType: parsed.data.businessType, businessId: parsed.data.businessId },
    ...meta,
  });

  return ok(created, undefined, 201);
}
