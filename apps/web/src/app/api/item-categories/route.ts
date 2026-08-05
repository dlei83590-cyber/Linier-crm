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
  parentId: z.string().min(1).optional(),
  level: z.number().int().min(1).max(2).default(1),
  sort: z.number().int().default(0),
});

/** GET /api/item-categories（分页 + 过滤；level/parentId 可选） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item-category:view");
  if (denied) return denied;
  requestLog(request, user?.id, "item-category.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const level = searchParams.get("level")?.trim();
  const parentId = searchParams.get("parentId")?.trim();

  const where = {
    deletedAt: null,
    ...(level ? { level: Number(level) } : {}),
    ...(parentId ? { parentId } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.itemCategory.count({ where }),
    prisma.itemCategory.findMany({
      where,
      orderBy: [{ level: "asc" }, { sort: "asc" }],
      skip,
      take,
      include: {
        parent: { select: { id: true, code: true, name: true } },
        _count: { select: { children: { where: { deletedAt: null } }, items: { where: { deletedAt: null } } } },
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/item-categories（新增分类；父级校验 level=1；编码唯一） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item-category:create");
  if (denied) return denied;
  requestLog(request, user?.id, "item-category.create");

  const meta = requestMeta(request);
  const parsed = categoryCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  if (parsed.data.parentId) {
    const parent = await prisma.itemCategory.findFirst({ where: { id: parsed.data.parentId, deletedAt: null } });
    if (!parent) return failConflict(ERROR_CODES.NOT_FOUND, "父分类不存在");
    if (parent.level !== 1) return failConflict(ERROR_CODES.CONFLICT, "SubCategory 不能作为父分类（CTO：仅两级）");
  }

  const existing = await prisma.itemCategory.findUnique({ where: { code: parsed.data.code } });
  if (existing && !existing.deletedAt) {
    return failConflict(ERROR_CODES.CONFLICT, "分类编码已存在");
  }

  const created = await prisma.itemCategory.create({
    data: { ...parsed.data, createdById: user!.id, updatedById: user!.id },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "item-category.create",
    entityType: "item-category",
    entityId: created.id,
    afterData: { code: created.code, name: created.name, level: created.level },
    ...meta,
  });

  return ok(created, undefined, 201);
}
