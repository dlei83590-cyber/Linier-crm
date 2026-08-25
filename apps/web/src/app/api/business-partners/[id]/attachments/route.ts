import { NextRequest } from "next/server";
import type { AttachmentType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { handleServerError } from "@/lib/api/server-error";
import { z } from "zod";

export const dynamic = "force-dynamic";

/**
 * GET/POST /api/business-partners/:id/attachments — Customer 360「文档」Tab（Phase 3 MVP）
 *
 * 复用 File Center：FileAttachment（businessType="business-partner"，businessId=客户 id）零新表。
 * 文件元数据创建走既有 POST /api/files（file:create）；挂载走本 POST（file-attachment:create）；
 * 查看/下载：真实二进制存储未接入（HOLD：附件系统重建 / 文档管理平台）。
 * 权限：复用 file-attachment:view/create/delete——不新增权限模块（ADR-0028）。
 */

const createSchema = z.object({
  fileId: z.string().min(1).max(64),
  attachmentType: z.enum(["DRAWING", "CERTIFICATE", "PHOTO", "MANUAL", "MODEL_3D", "VIDEO", "INSPECTION_REPORT"]).optional(),
  sort: z.number().int().default(0),
});

/** GET /api/business-partners/:id/attachments（客户文档列表；file-attachment:view） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "file-attachment:view");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-attachment.list");

  const { id } = await params;
  const bp = await prisma.businessPartner.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!bp) return failNotFound(ERROR_CODES.NOT_FOUND, "往来单位不存在");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);

  const where = { businessType: "business-partner", businessId: id, deletedAt: null };
  const [total, items] = await Promise.all([
    prisma.fileAttachment.count({ where }),
    prisma.fileAttachment.findMany({
      where,
      orderBy: [{ sort: "asc" }, { createdAt: "desc" }],
      skip,
      take,
      include: {
        file: { select: { id: true, name: true, originalName: true, extension: true, mimeType: true, size: true, currentVersion: true, storagePath: true } },
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/business-partners/:id/attachments（文件挂载到客户；file-attachment:create） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "file-attachment:create");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-attachment.create");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  try {
    const created = await prisma.$transaction(async (tx) => {
      const bp = await tx.businessPartner.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
      if (!bp) throw new Error("PARTNER_INVALID");

      const file = await tx.file.findFirst({ where: { id: parsed.data.fileId, deletedAt: null }, select: { id: true } });
      if (!file) throw new Error("FILE_INVALID");

      const dup = await tx.fileAttachment.findFirst({
        where: { fileId: parsed.data.fileId, businessType: "business-partner", businessId: id, deletedAt: null },
        select: { id: true },
      });
      if (dup) throw new Error("DUPLICATE");

      return tx.fileAttachment.create({
        data: {
          fileId: parsed.data.fileId,
          businessType: "business-partner",
          businessId: id,
          attachmentType: parsed.data.attachmentType as AttachmentType | undefined,
          sort: parsed.data.sort,
          createdById: user!.id,
          updatedById: user!.id,
        },
      });
    });

    await writeAuditLog({
      actorId: user?.id,
      action: "customer-attachment.create",
      entityType: "customerAttachment",
      entityId: created.id,
      meta: { businessPartnerId: id, fileId: parsed.data.fileId, attachmentType: created.attachmentType },
      ...meta,
    });

    return ok(created, undefined, 201);
  } catch (err) {
    if (err instanceof Error && err.message === "PARTNER_INVALID") {
      return failNotFound(ERROR_CODES.NOT_FOUND, "往来单位不存在");
    }
    if (err instanceof Error && err.message === "FILE_INVALID") {
      return failNotFound(ERROR_CODES.NOT_FOUND, "文件不存在");
    }
    if (err instanceof Error && err.message === "DUPLICATE") {
      return failConflict(ERROR_CODES.CONFLICT, "该文件已挂载到此客户");
    }
    return handleServerError(request, user?.id, "customer-attachment.create", err);
  }
}
