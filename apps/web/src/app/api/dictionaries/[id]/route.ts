import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, clientIp, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { casUpdate } from "@/lib/api/cas";
import { dictionaryTypeUpdateSchema } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";

/** GET /api/dictionaries/:id（详情 + 字典项列表） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "dictionary-type:view");
  if (denied) return denied;
  requestLog(request, user?.id, "dictionary-type.get");

  const { id } = await params;
  const type = await prisma.dictionaryType.findFirst({
    where: { id, deletedAt: null },
    include: {
      items: { where: { deletedAt: null }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }] },
    },
  });
  if (!type) {
    return failNotFound(ERROR_CODES.DICTIONARY_TYPE_NOT_FOUND, "字典类型不存在");
  }
  return ok(type);
}

/** PATCH /api/dictionaries/:id（乐观锁） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "dictionary-type:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "dictionary-type.update");

  const { id } = await params;
  const parsed = dictionaryTypeUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;

  const existing = await prisma.dictionaryType.findFirst({ where: { id, deletedAt: null } });
  if (!existing) {
    return failNotFound(ERROR_CODES.DICTIONARY_TYPE_NOT_FOUND, "字典类型不存在");
  }
  

  const cas = await casUpdate(prisma, 'dictionaryType', id, version, { ...updates, version: { increment: 1 }, updatedById: user!.id 
});
  if (cas.outcome === 'NOT_FOUND') return failNotFound(ERROR_CODES.NOT_FOUND, "资源不存在");
  if (cas.outcome === 'CONFLICT') return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  const updated = await prisma.dictionaryType.findFirst({ where: { id, deletedAt: null } });
  if (!updated) return failNotFound(ERROR_CODES.NOT_FOUND, "资源不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "dictionary-type.update",
    entityType: "dictionary-type",
    entityId: id,
    ipAddress: clientIp(request),
    meta: { version: updated.version },
  });

  return ok(updated);
}

/** DELETE /api/dictionaries/:id（软删除） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "dictionary-type:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "dictionary-type.delete");

  const { id } = await params;
  const result = await prisma.dictionaryType.updateMany({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date(), enabled: false, updatedById: user?.id ?? null },
  });
  if (result.count === 0) {
    return failNotFound(ERROR_CODES.DICTIONARY_TYPE_NOT_FOUND, "字典类型不存在");
  }

  await writeAuditLog({
    actorId: user?.id,
    action: "dictionary-type.delete",
    entityType: "dictionary-type",
    entityId: id,
    ipAddress: clientIp(request),
  });

  return ok({ id, deleted: true });
}
