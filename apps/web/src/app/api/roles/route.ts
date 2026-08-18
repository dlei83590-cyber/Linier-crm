import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

/** 角色权限（Pending Pages Completion Gate — Batch 2；Role 无 version/deletedAt → 无 CAS、无 DELETE） */
const roleCreateSchema = z.object({
  code: z.string().min(1).max(64).regex(/^[A-Z][A-Z0-9_]*$/, "角色编码须为大写字母/数字/下划线"),
  name: z.string().min(1).max(200),
  description: z.string().max(500).nullable().optional(),
  permissionCodes: z.array(z.string().min(1)).optional(),
});

/** GET /api/roles（分页 + code/name 过滤；含权限计数） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "role:view");
  if (denied) return denied;
  requestLog(request, user?.id, "role.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const code = searchParams.get("code")?.trim();
  const name = searchParams.get("name")?.trim();

  const where = {
    ...(code ? { code: { contains: code, mode: "insensitive" as const } } : {}),
    ...(name ? { name: { contains: name, mode: "insensitive" as const } } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.role.count({ where }),
    prisma.role.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        _count: { select: { permissions: true, users: true } },
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/roles（创建角色：code 唯一；permissionCodes 按 Permission 目录 code 连接，未知 code → 400） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "role:create");
  if (denied) return denied;
  requestLog(request, user?.id, "role.create");

  const meta = requestMeta(request);
  const parsed = roleCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const existing = await prisma.role.findUnique({ where: { code: parsed.data.code } });
  if (existing) {
    return failConflict(ERROR_CODES.CONFLICT, "角色编码已存在");
  }

  const permissionCodes = parsed.data.permissionCodes ?? [];
  if (permissionCodes.length > 0) {
    const found = await prisma.permission.findMany({ where: { code: { in: permissionCodes } }, select: { code: true } });
    if (found.length !== permissionCodes.length) {
      return failValidation({ permissionCodes: "存在无效权限码" });
    }
  }

  const created = await prisma.role.create({
    data: {
      code: parsed.data.code,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      ...(permissionCodes.length > 0
        ? { permissions: { connect: permissionCodes.map((code) => ({ code })) } }
        : {}),
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "role.create",
    entityType: "role",
    entityId: created.id,
    afterData: { code: created.code, name: created.name },
    ...meta,
  });

  return ok(created, undefined, 201);
}