import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const categoryUpdateSchema = z
  .object({
    code: z.string().min(1).max(64).optional(),
    name: z.string().min(1).max(100).optional(),
    categoryPath: z.string().min(1).max(100).optional(),
    sort: z.number().int().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/item-categories/:id（详情含物料计数；子树查询用 categoryPath 前缀） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item-category:view");
  if (denied) return denied;
  requestLog(request, user?.id, "item-category.get");

  const { id } = await params;
  const category = await prisma.itemCategory.findFirst({
    where: { id, deletedAt: null },
    include: {
      _count: { select: { items: { where: { deletedAt: null } } } },
    },
  });
  if (!category) return failNotFound(ERROR_CODES.NOT_FOUND, "分类不存在");

  // 子树（categoryPath 前缀，免递归，CTO #2138）
  const descendants = await prisma.itemCategory.findMany({
    where: { categoryPath: { startsWith: `${category.categoryPath}.` }, deletedAt: null },
    orderBy: { categoryPath: "asc" },
  });

  return ok({ ...category, descendants });
}

/** PATCH /api/item-categories/:id（乐观锁） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item-category:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "item-category.update");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = categoryUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;

  const existing = await prisma.itemCategory.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "分类不存在");
  if (existing.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }
  if (updates.categoryPath && updates.categoryPath !== existing.categoryPath) {
    const dup = await prisma.itemCategory.findUnique({ where: { categoryPath: updates.categoryPath } });
    if (dup && !dup.deletedAt) return failConflict(ERROR_CODES.CONFLICT, "分类路径已存在");
  }

  const updated = await prisma.itemCategory.update({
    where: { id },
    data: { ...updates, version: { increment: 1 }, updatedById: user!.id },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "item-category.update",
    entityType: "item-category",
    entityId: id,
    beforeData: { name: existing.name, categoryPath: existing.categoryPath },
    afterData: { name: updated.name, categoryPath: updated.categoryPath },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/item-categories/:id（软删除；有子分类或物料时拒绝） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item-category:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "item-category.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const category = await prisma.itemCategory.findFirst({
    where: { id, deletedAt: null },
    include: { _count: { select: { items: { where: { deletedAt: null } } } } },
  });
  if (!category) return failNotFound(ERROR_CODES.NOT_FOUND, "分类不存在");

  // 子树存在（categoryPath 前缀）或物料存在 → 拒绝
  const hasDescendants = await prisma.itemCategory.count({
    where: { categoryPath: { startsWith: `${category.categoryPath}.` }, deletedAt: null },
  });
  if (hasDescendants > 0) return failConflict(ERROR_CODES.CONFLICT, "存在子分类，不能删除");
  if (category._count.items > 0) return failConflict(ERROR_CODES.CONFLICT, "分类下存在物料，不能删除");

  await prisma.itemCategory.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "item-category.delete",
    entityType: "item-category",
    entityId: id,
    ...meta,
  });

  return ok({ id, deleted: true });
}
