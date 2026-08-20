import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { casUpdate } from "@/lib/api/cas";
import { z } from "zod";

export const dynamic = "force-dynamic";

const folderUpdateSchema = z
  .object({
    code: z.string().min(2).max(64).optional(),
    name: z.string().min(1).max(100).optional(),
    parentId: z.string().min(1).nullable().optional(),
    sort: z.number().int().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/file-folders/:id */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "file-folder:view");
  if (denied) return denied;
  requestLog(request, user?.id, "file-folder.get");

  const { id } = await params;
  const folder = await prisma.fileFolder.findFirst({
    where: { id, deletedAt: null },
    include: {
      children: { where: { deletedAt: null }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }] },
    },
  });
  if (!folder) return failNotFound(ERROR_CODES.NOT_FOUND, "文件夹不存在");
  return ok(folder);
}

/** PATCH /api/file-folders/:id（乐观锁 version） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "file-folder:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "file-folder.update");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = folderUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;

  const existing = await prisma.fileFolder.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "文件夹不存在");
  
  if (updates.parentId === existing.id) {
    return failConflict(ERROR_CODES.CONFLICT, "父文件夹不能是自身");
  }

  const cas = await casUpdate(prisma, 'fileFolder', id, version, { ...updates, version: { increment: 1 }, updatedById: user!.id 
});
  if (cas.outcome === 'NOT_FOUND') return failNotFound(ERROR_CODES.NOT_FOUND, "文件夹不存在");
  if (cas.outcome === 'CONFLICT') return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  const updated = await prisma.fileFolder.findFirst({ where: { id, deletedAt: null } });
  if (!updated) return failNotFound(ERROR_CODES.NOT_FOUND, "文件夹不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "file-folder.update",
    entityType: "file-folder",
    entityId: id,
    beforeData: { name: existing.name, sort: existing.sort },
    afterData: { name: updated.name, sort: updated.sort },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/file-folders/:id（软删除） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "file-folder:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "file-folder.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const result = await prisma.fileFolder.updateMany({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });
  if (result.count === 0) return failNotFound(ERROR_CODES.NOT_FOUND, "文件夹不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "file-folder.delete",
    entityType: "file-folder",
    entityId: id,
    ...meta,
  });

  return ok({ id, deleted: true });
}
