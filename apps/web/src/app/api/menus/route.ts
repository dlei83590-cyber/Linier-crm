import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const menuCreateSchema = z.object({
  groupId: z.string().min(1),
  parentId: z.string().min(1).optional(),
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(100),
  path: z.string().max(200).optional(),
  icon: z.string().max(100).optional(),
  sort: z.number().int().default(0),
  hidden: z.boolean().default(false),
  cache: z.boolean().default(false),
  externalLink: z.string().max(500).optional(),
  permission: z.string().max(100).optional(),
});

/** 构建菜单树（按 parentId 组装） */
function buildTree(items: { id: string; parentId: string | null }[]) {
  const map = new Map<string, { id: string; parentId: string | null; children: unknown[] } & Record<string, unknown>>();
  const roots: unknown[] = [];
  for (const item of items) {
    map.set(item.id, { ...item, children: [] });
  }
  for (const item of map.values()) {
    if (item.parentId && map.has(item.parentId)) {
      (map.get(item.parentId)!.children as unknown[]).push(item);
    } else {
      roots.push(item);
    }
  }
  return roots;
}

/** GET /api/menus?groupCode=&tree=true（列表/树，前端直接读取） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "menu:view");
  if (denied) return denied;
  requestLog(request, user?.id, "menu.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const groupCode = searchParams.get("groupCode")?.trim();
  const tree = searchParams.get("tree") === "true";

  const where = {
    deletedAt: null,
    isActive: true,
    ...(groupCode ? { group: { code: groupCode } } : {}),
  };

  if (tree) {
    const items = await prisma.menu.findMany({
      where,
      orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
      include: { group: { select: { code: true, name: true } } },
    });
    return ok(buildTree(items));
  }

  const [total, items] = await Promise.all([
    prisma.menu.count({ where }),
    prisma.menu.findMany({
      where,
      orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
      skip,
      take,
      include: { group: { select: { code: true, name: true } } },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/menus（创建菜单） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "menu:create");
  if (denied) return denied;
  requestLog(request, user?.id, "menu.create");

  const meta = requestMeta(request);
  const parsed = menuCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { groupId, parentId, ...data } = parsed.data;

  const group = await prisma.menuGroup.findFirst({ where: { id: groupId, deletedAt: null } });
  if (!group) {
    return failConflict(ERROR_CODES.NOT_FOUND, "菜单组不存在");
  }
  if (parentId) {
    const parent = await prisma.menu.findFirst({ where: { id: parentId, deletedAt: null } });
    if (!parent) {
      return failConflict(ERROR_CODES.NOT_FOUND, "父菜单不存在");
    }
  }

  const existing = await prisma.menu.findUnique({ where: { code: data.code } });
  if (existing && !existing.deletedAt) {
    return failConflict(ERROR_CODES.CONFLICT, "菜单编码已存在");
  }

  const created = await prisma.menu.create({
    data: {
      ...data,
      groupId,
      parentId: parentId ?? null,
      createdById: user!.id,
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "menu.create",
    entityType: "menu",
    entityId: created.id,
    afterData: { code: created.code, name: created.name },
    ...meta,
  });

  return ok(created, undefined, 201);
}
