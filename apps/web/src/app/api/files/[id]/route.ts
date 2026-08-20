import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { casUpdate } from "@/lib/api/cas";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const fileUpdateSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    originalName: z.string().max(255).nullable().optional(),
    extension: z.string().max(20).nullable().optional(),
    mimeType: z.string().max(100).nullable().optional(),
    size: z.number().int().nonnegative().optional(),
    storagePath: z.string().max(500).nullable().optional(),
    checksum: z.string().max(128).nullable().optional(),
    folderId: z.string().min(1).nullable().optional(),
    ownerId: z.string().min(1).nullable().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/files/:id（详情含版本与附件） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "file:view");
  if (denied) return denied;
  requestLog(request, user?.id, "file.get");

  const { id } = await params;
  const file = await prisma.file.findFirst({
    where: { id, deletedAt: null },
    include: {
      folder: { select: { id: true, name: true } },
      versions: { where: { deletedAt: null }, orderBy: { versionNo: "desc" } },
      attachments: { where: { deletedAt: null }, orderBy: { sort: "asc" } },
    },
  });
  if (!file) return failNotFound(ERROR_CODES.NOT_FOUND, "文件不存在");
  return ok(file);
}

/** PATCH /api/files/:id（乐观锁 version） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "file:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "file.update");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = fileUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;

  const existing = await prisma.file.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "文件不存在");

  // A4-CAS：原子乐观锁（消除 read-check-update TOCTOU）
  const cas = await casUpdate(prisma, "file", id, version, {
    ...updates,
    updatedById: user!.id,
  });
  if (cas.outcome === "CONFLICT") {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }
  if (cas.outcome === "NOT_FOUND") {
    return failNotFound(ERROR_CODES.NOT_FOUND, "文件不存在");
  }

  const updated = await prisma.file.findFirst({ where: { id, deletedAt: null } });
  if (!updated) return failNotFound(ERROR_CODES.NOT_FOUND, "文件不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "file.update",
    entityType: "file",
    entityId: id,
    beforeData: { name: existing.name, size: existing.size },
    afterData: { name: updated.name, size: updated.size },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/files/:id（软删除，含版本与附件级联标记） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "file:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "file.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const result = await prisma.$transaction(async (tx) => {
    const file = await tx.file.findFirst({ where: { id, deletedAt: null } });
    if (!file) return null;
    const now = new Date();
    await tx.fileVersion.updateMany({
      where: { fileId: id, deletedAt: null },
      data: { deletedAt: now, isActive: false, updatedById: user?.id ?? null },
    });
    await tx.fileAttachment.updateMany({
      where: { fileId: id, deletedAt: null },
      data: { deletedAt: now, isActive: false, updatedById: user?.id ?? null },
    });
    await tx.file.update({
      where: { id },
      data: { deletedAt: now, isActive: false, updatedById: user?.id ?? null },
    });
    return { id };
  });

  if (!result) return failNotFound(ERROR_CODES.NOT_FOUND, "文件不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "file.delete",
    entityType: "file",
    entityId: id,
    ...meta,
  });

  return ok({ id, deleted: true });
}
