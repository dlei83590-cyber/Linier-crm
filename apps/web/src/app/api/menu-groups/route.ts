import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const menuGroupCreateSchema = z.object({
  code: z.string().min(2).max(64).regex(/^[A-Z0-9_]+$/, "Code 仅允许大写字母、数字、下划线"),
  name: z.string().min(1).max(100),
  icon: z.string().max(100).optional(),
  sort: z.number().int().default(0),
});

/** GET /api/menu-groups（菜单组列表，含菜单计数） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "menu-group:view");
  if (denied) return denied;
  requestLog(request, user?.id, "menu-group.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const code = searchParams.get("code")?.trim();
  const name = searchParams.get("name")?.trim();

  const where = {
    deletedAt: null,
    ...(code ? { code: { contains: code } } : {}),
    ...(name ? { name: { contains: name } } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.menuGroup.count({ where }),
    prisma.menuGroup.findMany({
      where,
      orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
      skip,
      take,
      include: { _count: { select: { menus: { where: { deletedAt: null } } } } },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/menu-groups（创建菜单组） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "menu-group:create");
  if (denied) return denied;
  requestLog(request, user?.id, "menu-group.create");

  const meta = requestMeta(request);
  const parsed = menuGroupCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const existing = await prisma.menuGroup.findUnique({ where: { code: parsed.data.code } });
  if (existing && !existing.deletedAt) {
    return failConflict(ERROR_CODES.CONFLICT, "菜单组编码已存在");
  }

  const created = await prisma.menuGroup.create({
    data: { ...parsed.data, createdById: user!.id, updatedById: user!.id },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "menu-group.create",
    entityType: "menu-group",
    entityId: created.id,
    afterData: { code: created.code, name: created.name },
    ...meta,
  });

  return ok(created, undefined, 201);
}
