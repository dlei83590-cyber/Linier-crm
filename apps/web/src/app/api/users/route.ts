import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { hashPassword } from "@/lib/auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

/** 系统用户管理（Pending Pages Completion Gate — Batch 2；User 无 version/deletedAt → 无 CAS、停用语义） */
const userCreateSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(6).max(128),
  name: z.string().max(100).nullable().optional(),
  departmentId: z.string().min(1).nullable().optional(),
  roleIds: z.array(z.string().min(1)).optional(),
  isActive: z.boolean().optional(),
});

/** GET /api/users（分页 + email/name/departmentId/isActive 过滤；含部门与角色摘要，不含 passwordHash） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "user:view");
  if (denied) return denied;
  requestLog(request, user?.id, "user.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const email = searchParams.get("email")?.trim();
  const name = searchParams.get("name")?.trim();
  const departmentId = searchParams.get("departmentId")?.trim();
  const isActive = searchParams.get("isActive")?.trim();

  const where = {
    ...(email ? { email: { contains: email, mode: "insensitive" as const } } : {}),
    ...(name ? { name: { contains: name, mode: "insensitive" as const } } : {}),
    ...(departmentId ? { departmentId } : {}),
    ...(isActive === "true" ? { isActive: true } : isActive === "false" ? { isActive: false } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true,
        departmentId: true,
        department: { select: { id: true, code: true, name: true } },
        roles: { select: { role: { select: { id: true, code: true, name: true } } } },
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/users（创建用户：email 唯一；密码服务端 bcrypt hash；角色/部门可选） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "user:create");
  if (denied) return denied;
  requestLog(request, user?.id, "user.create");

  const meta = requestMeta(request);
  const parsed = userCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) {
    return failConflict(ERROR_CODES.CONFLICT, "邮箱已存在");
  }

  if (parsed.data.departmentId) {
    const dept = await prisma.department.findUnique({ where: { id: parsed.data.departmentId } });
    if (!dept) return failConflict(ERROR_CODES.NOT_FOUND, "部门不存在");
  }

  const roleIds = parsed.data.roleIds ?? [];
  if (roleIds.length > 0) {
    const roles = await prisma.role.findMany({ where: { id: { in: roleIds } }, select: { id: true } });
    if (roles.length !== roleIds.length) {
      return failValidation({ roleIds: "存在无效角色" });
    }
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const created = await prisma.user.create({
    data: {
      email: parsed.data.email,
      passwordHash,
      name: parsed.data.name ?? null,
      departmentId: parsed.data.departmentId ?? null,
      isActive: parsed.data.isActive ?? true,
      ...(roleIds.length > 0
        ? { roles: { create: roleIds.map((roleId) => ({ role: { connect: { id: roleId } } })) } }
        : {}),
    },
    select: { id: true, email: true, name: true, isActive: true, createdAt: true },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "user.create",
    entityType: "user",
    entityId: created.id,
    afterData: { email: created.email, isActive: created.isActive },
    ...meta,
  });

  return ok(created, undefined, 201);
}