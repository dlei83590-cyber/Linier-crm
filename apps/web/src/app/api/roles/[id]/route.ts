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

  const existing = await prisma.role.findUnique({ where: { id }, select: { id: true, code: true, name: true } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "角色不存在");

  const permissionCodes = parsed.data.permissionCodes ?? [];
  if (parsed.data.permissionCodes && permissionCodes.length > 0) {
    const found = await prisma.permission.findMany({ where: { code: { in: permissionCodes } }, select: { code: true } });
    if (found.length !== permissionCodes.length) {
      return failValidation({ permissionCodes: "存在无效权限码" });
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

  await writeAuditLog({
    actorId: user?.id,
    action: "role.update",
    entityType: "role",
    entityId: id,
    beforeData: { code: existing.code, name: existing.name },
    afterData: { code: updated.code, name: updated.name },
    ...meta,
  });

  return ok(updated);
}