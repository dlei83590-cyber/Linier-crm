import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const menuGroupUpdateSchema = z
  .object({
    code: z.string().min(2).max(64).optional(),
    name: z.string().min(1).max(100).optional(),
    icon: z.string().max(100).nullable().optional(),
    sort: z.number().int().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/menu-groups/:id */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "menu-group:view");
  if (denied) return denied;
  requestLog(request, user?.id, "menu-group.get");

  const { id } = await params;
  const group = await prisma.menuGroup.findFirst({
    where: { id, deletedAt: null },
    include: { menus: { where: { deletedAt: null }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }] } },
  });
  if (!group) return failNotFound(ERROR_CODES.NOT_FOUND, "菜单组不存在");
  return ok(group);
}

/** PATCH /api/menu-groups/:id（乐观锁 version） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "menu-group:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "menu-group.update");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = menuGroupUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;

  const existing = await prisma.menuGroup.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "菜单组不存在");
  if (existing.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }

  const updated = await prisma.menuGroup.update({
    where: { id },
    data: { ...updates, version: { increment: 1 }, updatedById: user!.id },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "menu-group.update",
    entityType: "menu-group",
    entityId: id,
    beforeData: { name: existing.name, sort: existing.sort },
    afterData: { name: updated.name, sort: updated.sort },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/menu-groups/:id（软删除；组下菜单级联隐藏） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "menu-group:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "menu-group.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const result = await prisma.$transaction(async (tx) => {
    const group = await tx.menuGroup.findFirst({ where: { id, deletedAt: null } });
    if (!group) return null;
    const now = new Date();
    await tx.menu.updateMany({
      where: { groupId: id, deletedAt: null },
      data: { deletedAt: now, isActive: false, updatedById: user?.id ?? null },
    });
    await tx.menuGroup.update({
      where: { id },
      data: { deletedAt: now, isActive: false, updatedById: user?.id ?? null },
    });
    return { id };
  });

  if (!result) return failNotFound(ERROR_CODES.NOT_FOUND, "菜单组不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "menu-group.delete",
    entityType: "menu-group",
    entityId: id,
    meta: { cascaded: true },
    ...meta,
  });

  return ok({ id, deleted: true });
}
