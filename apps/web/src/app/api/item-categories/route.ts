import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const categoryCreateSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(100),
  categoryPath: z.string().min(1).max(100), // CTO #2138：如 001 / 001.003 / 001.003.005
  level: z.number().int().min(1).max(2).default(1),
  sort: z.number().int().default(0),
});

/** GET /api/item-categories（分页 + 过滤；level/categoryPath 可选；categoryPath 前缀查询子树免递归） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item-category:view");
  if (denied) return denied;
  requestLog(request, user?.id, "item-category.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const level = searchParams.get("level")?.trim();
  const categoryPath = searchParams.get("categoryPath")?.trim();

  const where = {
    deletedAt: null,
    ...(level ? { level: Number(level) } : {}),
    ...(categoryPath ? { categoryPath: { startsWith: categoryPath } } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.itemCategory.count({ where }),
    prisma.itemCategory.findMany({
      where,
      orderBy: [{ categoryPath: "asc" }, { sort: "asc" }],
      skip,
      take,
      include: {
        _count: { select: { items: { where: { deletedAt: null } } } },
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/item-categories（新增分类；categoryPath 唯一；Level2 需父级 Level1 存在） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item-category:create");
  if (denied) return denied;
  requestLog(request, user?.id, "item-category.create");

  const meta = requestMeta(request);
  const parsed = categoryCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  if (parsed.data.level === 2) {
    const parentPath = parsed.data.categoryPath.split(".").slice(0, -1).join(".");
    if (!parentPath) return failConflict(ERROR_CODES.CONFLICT, "Level2 分类的 categoryPath 必须包含父级段（如 001.003）");
    const parent = await prisma.itemCategory.findFirst({ where: { categoryPath: parentPath, deletedAt: null } });
    if (!parent) return failConflict(ERROR_CODES.NOT_FOUND, "父分类不存在");
    if (parent.level !== 1) return failConflict(ERROR_CODES.CONFLICT, "SubCategory 不能作为父分类（CTO：仅两级）");
  }

  const existing = await prisma.itemCategory.findUnique({ where: { code: parsed.data.code } });
  if (existing && !existing.deletedAt) {
    return failConflict(ERROR_CODES.CONFLICT, "分类编码已存在");
  }
  const existingPath = await prisma.itemCategory.findUnique({ where: { categoryPath: parsed.data.categoryPath } });
  if (existingPath && !existingPath.deletedAt) {
    return failConflict(ERROR_CODES.CONFLICT, "分类路径已存在");
  }

  const created = await prisma.itemCategory.create({
    data: { ...parsed.data, createdById: user!.id, updatedById: user!.id },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "item-category.create",
    entityType: "item-category",
    entityId: created.id,
    afterData: { code: created.code, name: created.name, categoryPath: created.categoryPath, level: created.level },
    ...meta,
  });

  return ok(created, undefined, 201);
}
