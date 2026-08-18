import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { hashPassword } from "@/lib/auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

/** User 无 version 字段 → PATCH 不做 CAS；DELETE = 停用（isActive=false，不物理删除） */
const userUpdateSchema = z
  .object({
    name: z.string().max(100).nullable().optional(),
    departmentId: z.string().min(1).nullable().optional(),
    isActive: z.boolean().optional(),
    password: z.string().min(6).max(128).optional(),
    roleIds: z.array(z.string().min(1)).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "至少提供一个更新字段" });

/** GET /api/users/:id（详情，不含 passwordHash） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "user:view");
  if (denied) return denied;
  requestLog(request, user?.id, "user.get");

  const { id } = await params;
  const target = await prisma.user.findUnique({
    where: { id },
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
  });
  if (!target) return failNotFound(ERROR_CODES.NOT_FOUND, "用户不存在");
  return ok(target);
}

/** PATCH /api/users/:id（name/departmentId/isActive/password 重置/roleIds 全量替换；无 CAS） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "user:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "user.update");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = userUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const existing = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "用户不存在");

  if (parsed.data.departmentId) {
    const dept = await prisma.department.findUnique({ where: { id: parsed.data.departmentId } });
    if (!dept) return failConflict(ERROR_CODES.NOT_FOUND, "部门不存在");
  }

  const roleIds = parsed.data.roleIds ?? [];
  if (parsed.data.roleIds && roleIds.length > 0) {
    const roles = await prisma.role.findMany({ where: { id: { in: roleIds } }, select: { id: true } });
    if (roles.length !== roleIds.length) {
      return failValidation({ roleIds: "存在无效角色" });
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.user.update({
      where: { id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.departmentId !== undefined ? { departmentId: parsed.data.departmentId } : {}),
        ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
        ...(parsed.data.password ? { passwordHash: await hashPassword(parsed.data.password) } : {}),
      },
      select: { id: true, email: true, name: true, isActive: true, departmentId: true },
    });
    if (parsed.data.roleIds) {
      await tx.userRole.deleteMany({ where: { userId: id } });
      if (roleIds.length > 0) {
        await tx.userRole.createMany({
          data: roleIds.map((roleId) => ({ userId: id, roleId })),
        });
      }
    }
    return result;
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "user.update",
    entityType: "user",
    entityId: id,
    beforeData: { email: existing.email },
    afterData: { email: updated.email, isActive: updated.isActive },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/users/:id（停用语义：User 无 deletedAt → isActive=false，保留审计与单据引用） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "user:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "user.deactivate");

  const { id } = await params;
  const meta = requestMeta(request);

  const existing = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "用户不存在");

  await prisma.user.update({
    where: { id },
    data: { isActive: false },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "user.deactivate",
    entityType: "user",
    entityId: id,
    ...meta,
  });

  return ok({ id, deactivated: true });
}