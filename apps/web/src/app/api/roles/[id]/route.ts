import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

/** Role 无 version → PATCH 无 CAS；无 DELETE（UserRole 引用完整性 + 无软删字段） */
const roleUpdateSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(500).nullable().optional(),
    permissionCodes: z.array(z.string().min(1)).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "至少提供一个更新字段" });

/** GET /api/roles/:id（详情含权限全量 code 列表） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "role:view");
  if (denied) return denied;
  requestLog(request, user?.id, "role.get");

  const { id } = await params;
  const role = await prisma.role.findUnique({
    where: { id },
    include: {
      permissions: { orderBy: [{ module: "asc" }, { code: "asc" }], select: { id: true, code: true, module: true, name: true } },
      _count: { select: { users: true } },
    },
  });
  if (!role) return failNotFound(ERROR_CODES.NOT_FOUND, "角色不存在");
  return ok(role);
}

/** PATCH /api/roles/:id（name/description/permissionCodes 全量替换 RolePermissions；无 CAS） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "role:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "role.update");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = roleUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const existing = await prisma.role.findUnique({
    where: { id },
    select: { id: true, code: true, name: true, permissions: { select: { code: true } } },
  });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "角色不存在");

  // 权限分配（系统权限树）：去重后按 Permission 目录 code 校验；未知 code → 400（不做静默裁剪）
  const permissionCodes = [...new Set(parsed.data.permissionCodes ?? [])];
  if (parsed.data.permissionCodes && permissionCodes.length > 0) {
    const found = await prisma.permission.findMany({ where: { code: { in: permissionCodes } }, select: { code: true } });
    if (found.length !== permissionCodes.length) {
      return failValidation({ permissionCodes: "存在无效权限码" });
    }
  }

  // ADR-0057 安全不变量①（裁决 Q2）：SUPER_ADMIN 权限恒为全集，禁止通过 API 修改（防一次误操作锁死系统）
  if (parsed.data.permissionCodes && existing.code === "SUPER_ADMIN") {
    return failConflict(ERROR_CODES.CONFLICT, "SUPER_ADMIN 角色权限由系统治理（恒为全集），不允许修改");
  }

  // ADR-0057 安全不变量②（防自锁）：不得让系统失去全部 role:edit 持有者
  // （DB 权威下权限回收立即影响访问控制，需保证至少一个角色仍可管理角色）
  if (parsed.data.permissionCodes && !permissionCodes.includes("role:edit")) {
    const otherRoleEditHolders = await prisma.role.count({
      where: { id: { not: id }, permissions: { some: { code: "role:edit" } } },
    });
    if (otherRoleEditHolders === 0) {
      return failConflict(ERROR_CODES.CONFLICT, "系统必须保留至少一个持有 role:edit 的角色（防自锁）");
    }
  }

  const updated = await prisma.role.update({
    where: { id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      ...(parsed.data.permissionCodes
        ? { permissions: { set: permissionCodes.map((code) => ({ code })) } }
        : {}),
    },
  });

  // 权限分配审计证据：记录权限总数与本次新增/移除明细（before/after 双写，可追溯谁授予/回收了什么）
  const beforeCodes = existing.permissions.map((p) => p.code);
  const afterCodes = parsed.data.permissionCodes ? permissionCodes : beforeCodes;
  const beforeSet = new Set(beforeCodes);
  const afterSet = new Set(afterCodes);

  await writeAuditLog({
    actorId: user?.id,
    action: "role.update",
    entityType: "role",
    entityId: id,
    beforeData: { code: existing.code, name: existing.name, permissionCount: beforeSet.size },
    afterData: {
      code: updated.code,
      name: updated.name,
      permissionCount: afterSet.size,
      permissionAdded: afterCodes.filter((c) => !beforeSet.has(c)).sort(),
      permissionRemoved: beforeCodes.filter((c) => !afterSet.has(c)).sort(),
    },
    ...meta,
  });

  return ok(updated);
}