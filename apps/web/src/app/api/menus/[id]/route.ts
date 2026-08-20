import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { casUpdate } from "@/lib/api/cas";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const menuUpdateSchema = z
  .object({
    groupId: z.string().min(1).optional(),
    parentId: z.string().min(1).nullable().optional(),
    code: z.string().min(1).max(64).optional(),
    name: z.string().min(1).max(100).optional(),
    path: z.string().max(200).nullable().optional(),
    icon: z.string().max(100).nullable().optional(),
    sort: z.number().int().optional(),
    hidden: z.boolean().optional(),
    cache: z.boolean().optional(),
    externalLink: z.string().max(500).nullable().optional(),
    permission: z.string().max(100).nullable().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/menus/:id */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "menu:view");
  if (denied) return denied;
  requestLog(request, user?.id, "menu.get");

  const { id } = await params;
  const menu = await prisma.menu.findFirst({
    where: { id, deletedAt: null },
    include: { group: { select: { code: true, name: true } } },
  });
  if (!menu) return failNotFound(ERROR_CODES.NOT_FOUND, "菜单不存在");
  return ok(menu);
}

/** PATCH /api/menus/:id（乐观锁 version） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "menu:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "menu.update");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = menuUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;

  const existing = await prisma.menu.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "菜单不存在");
  if (updates.parentId === existing.id) {
    return failConflict(ERROR_CODES.CONFLICT, "父菜单不能是自身");
  }

  // A4-CAS：原子乐观锁（消除 read-check-update TOCTOU）
  const cas = await casUpdate(prisma, "menu", id, version, {
    ...updates,
    updatedById: user!.id,
  });
  if (cas.outcome === "NOT_FOUND") return failNotFound(ERROR_CODES.NOT_FOUND, "菜单不存在");
  if (cas.outcome === "CONFLICT") return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");

  const updated = await prisma.menu.findFirst({ where: { id, deletedAt: null } });
  if (!updated) return failNotFound(ERROR_CODES.NOT_FOUND, "菜单不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "menu.update",
    entityType: "menu",
    entityId: id,
    beforeData: { name: existing.name, sort: existing.sort, hidden: existing.hidden },
    afterData: { name: updated.name, sort: updated.sort, hidden: updated.hidden },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/menus/:id（软删除，含子树） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "menu:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "menu.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const result = await prisma.$transaction(async (tx) => {
    const menu = await tx.menu.findFirst({ where: { id, deletedAt: null } });
    if (!menu) return null;
    const now = new Date();
    // 递归收集子树
    const idsToDelete = new Set<string>([id]);
    let frontier = [id];
    while (frontier.length > 0) {
      const children = await tx.menu.findMany({
        where: { parentId: { in: frontier }, deletedAt: null },
        select: { id: true },
      });
      frontier = children.map((c) => c.id);
      frontier.forEach((c) => idsToDelete.add(c));
    }
    await tx.menu.updateMany({
      where: { id: { in: [...idsToDelete] } },
      data: { deletedAt: now, isActive: false, updatedById: user?.id ?? null },
    });
    return { count: idsToDelete.size };
  });

  if (!result) return failNotFound(ERROR_CODES.NOT_FOUND, "菜单不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "menu.delete",
    entityType: "menu",
    entityId: id,
    meta: { deletedCount: result.count },
    ...meta,
  });

  return ok({ id, deleted: true, deletedCount: result.count });
}
