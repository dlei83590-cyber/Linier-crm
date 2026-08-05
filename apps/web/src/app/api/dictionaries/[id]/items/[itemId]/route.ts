import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, clientIp, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { dictionaryItemUpdateSchema } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";

/** PATCH /api/dictionaries/:id/items/:itemId（乐观锁） */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "dictionary-item:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "dictionary-item.update");

  const { itemId } = await params;
  const parsed = dictionaryItemUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;

  const existing = await prisma.dictionaryItem.findFirst({ where: { id: itemId, deletedAt: null } });
  if (!existing) {
    return failNotFound(ERROR_CODES.DICTIONARY_ITEM_NOT_FOUND, "字典项不存在");
  }
  if (existing.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }

  const updated = await prisma.dictionaryItem.update({
    where: { id: itemId },
    data: { ...updates, version: { increment: 1 }, updatedById: user!.id },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "dictionary-item.update",
    entityType: "dictionary-item",
    entityId: itemId,
    ipAddress: clientIp(request),
    meta: { version: updated.version },
  });

  return ok(updated);
}

/** DELETE /api/dictionaries/:id/items/:itemId（软删除） */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "dictionary-item:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "dictionary-item.delete");

  const { itemId } = await params;
  const result = await prisma.dictionaryItem.updateMany({
    where: { id: itemId, deletedAt: null },
    data: { deletedAt: new Date(), enabled: false, updatedById: user?.id ?? null },
  });
  if (result.count === 0) {
    return failNotFound(ERROR_CODES.DICTIONARY_ITEM_NOT_FOUND, "字典项不存在");
  }

  await writeAuditLog({
    actorId: user?.id,
    action: "dictionary-item.delete",
    entityType: "dictionary-item",
    entityId: itemId,
    ipAddress: clientIp(request),
  });

  return ok({ id: itemId, deleted: true });
}
