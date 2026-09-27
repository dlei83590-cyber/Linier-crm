import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, fail, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { hashPassword } from "@/lib/auth";
import { DEFAULT_INITIAL_PASSWORD } from "@nilier-crm/shared";
import { z } from "zod";

export const dynamic = "force-dynamic";

/**
 * 系统用户管理（Pending Pages Completion Gate — Batch 2；User 无 version/deletedAt → 无 CAS、停用语义）
 *
 * ADR-0059：**不接受客户端自定义密码**——新建用户初始密码固定为 123456，
 * 且 mustChangePassword=true（首次登录必须改为强密码）。带 password 字段的请求 → 400 fail closed。
 */
const userCreateSchema = z.object({
  email: z.string().email().max(200),
  name: z.string().max(100).nullable().optional(),
  departmentId: z.string().min(1).nullable().optional(),
  roleIds: z.array(z.string().min(1)).optional(),
  /** ADR-0058：用户附加授权（权限目录 code；与角色权限并集生效） */
  permissionCodes: z.array(z.string().min(1)).optional(),
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
        // ADR-0058：附加授权计数（列表列展示）
        _count: { select: { permissions: true } },
        // ADR-0059：密码状态（是否仍为初始密码）
        mustChangePassword: true,
        passwordChangedAt: true,
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
  const raw = (await request.json().catch(() => null)) as unknown;

  // ADR-0059：密码不接受客户端设定（管理员只能「重置密码」为初始密码）
  if (raw !== null && typeof raw === "object" && "password" in raw) {
    return fail(
      ERROR_CODES.PASSWORD_DIRECT_SET_FORBIDDEN,
      `新建用户不接受自定义密码：初始密码固定为 ${DEFAULT_INITIAL_PASSWORD}，用户首次登录必须修改`,
      400,
    );
  }

  const parsed = userCreateSchema.safeParse(raw);
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

  // ADR-0058：附加授权按权限目录 code 校验（去重；未知 code → 400，不静默裁剪）
  const permissionCodes = [...new Set(parsed.data.permissionCodes ?? [])];
  if (permissionCodes.length > 0) {
    const found = await prisma.permission.findMany({
      where: { code: { in: permissionCodes } },
      select: { code: true },
    });
    if (found.length !== permissionCodes.length) {
      return failValidation({ permissionCodes: "存在无效权限码" });
    }
  }

  // ADR-0059：初始密码固定 123456 + mustChangePassword=true（首次登录强制改密）
  const passwordHash = await hashPassword(DEFAULT_INITIAL_PASSWORD);
  const created = await prisma.user.create({
    data: {
      email: parsed.data.email,
      passwordHash,
      mustChangePassword: true,
      name: parsed.data.name ?? null,
      departmentId: parsed.data.departmentId ?? null,
      isActive: parsed.data.isActive ?? true,
      ...(roleIds.length > 0
        ? { roles: { create: roleIds.map((roleId) => ({ role: { connect: { id: roleId } } })) } }
        : {}),
      ...(permissionCodes.length > 0
        ? { permissions: { connect: permissionCodes.map((code) => ({ code })) } }
        : {}),
    },
    select: {
      id: true,
      email: true,
      name: true,
      isActive: true,
      mustChangePassword: true,
      passwordChangedAt: true,
      createdAt: true,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "user.create",
    entityType: "user",
    entityId: created.id,
    afterData: {
      email: created.email,
      isActive: created.isActive,
      roleCount: roleIds.length,
      permissionCount: permissionCodes.length,
      // ADR-0059：初始密码下发（不记录密码明文，只记录状态）
      initialPasswordIssued: true,
      mustChangePassword: created.mustChangePassword,
    },
    ...meta,
  });

  return ok(created, undefined, 201);
}