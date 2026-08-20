import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { casUpdate } from "@/lib/api/cas";
import { z } from "zod";

export const dynamic = "force-dynamic";

const tagUpdateSchema = z
  .object({
    code: z.string().min(2).max(64).optional(),
    name: z.string().min(1).max(100).optional(),
    color: z.string().max(20).nullable().optional(),
    sort: z.number().int().optional(),
    enabled: z.boolean().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/tags/:id */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "tag:view");
  if (denied) return denied;
  requestLog(request, user?.id, "tag.get");

  const { id } = await params;
  const tag = await prisma.tag.findFirst({ where: { id, deletedAt: null } });
  if (!tag) return failNotFound(ERROR_CODES.NOT_FOUND, "标签不存在");
  return ok(tag);
}

/** PATCH /api/tags/:id（乐观锁 version） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "tag:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "tag.update");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = tagUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;

  const existing = await prisma.tag.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "标签不存在");
  

  const cas = await casUpdate(prisma, 'tag', id, version, {...updates, updatedById: user!.id
});
  if (cas.outcome === 'NOT_FOUND') return failNotFound(ERROR_CODES.NOT_FOUND, "标签不存在");
  if (cas.outcome === 'CONFLICT') return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  const updated = await prisma.tag.findFirst({ where: { id, deletedAt: null } });
  if (!updated) return failNotFound(ERROR_CODES.NOT_FOUND, "标签不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "tag.update",
    entityType: "tag",
    entityId: id,
    beforeData: { name: existing.name, sort: existing.sort },
    afterData: { name: updated.name, sort: updated.sort },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/tags/:id（软删除） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "tag:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "tag.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const result = await prisma.tag.updateMany({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date(), enabled: false, updatedById: user?.id ?? null },
  });
  if (result.count === 0) return failNotFound(ERROR_CODES.NOT_FOUND, "标签不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "tag.delete",
    entityType: "tag",
    entityId: id,
    ...meta,
  });

  return ok({ id, deleted: true });
}
