import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, clientIp, writeAuditLog } from "@/lib/api-helpers";
import { ok, fail, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { settingUpdateSchema, settingScopeSchema } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";

const SCOPE_VIEW_PERMISSION: Record<string, string> = {
  SYSTEM: "system-setting:view",
  TENANT: "tenant-setting:view",
  USER: "user-setting:view",
};
const SCOPE_PERMISSION: Record<string, string> = {
  SYSTEM: "system-setting:edit",
  TENANT: "tenant-setting:edit",
  USER: "user-setting:edit",
};
const SCOPE_DELETE_PERMISSION: Record<string, string> = {
  SYSTEM: "system-setting:delete",
  TENANT: "tenant-setting:delete",
  USER: "user-setting:delete",
};

/** 按 scope 路由到对应模型 */
function modelFor(scope: string) {
  if (scope === "SYSTEM") return prisma.systemSetting;
  if (scope === "TENANT") return prisma.tenantSetting;
  return prisma.userSetting;
}

/** GET /api/settings/:id?scope=... */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  if (!user) return fail(ERROR_CODES.AUTHENTICATION_ERROR, "Unauthorized", 401);
  requestLog(request, user.id, "settings.get");

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope")?.trim()?.toUpperCase() ?? "SYSTEM";
  if (!settingScopeSchema.safeParse(scope).success) {
    return failValidation({ scope: "scope 必须为 SYSTEM/TENANT/USER" });
  }
  const denied = requirePermission(user, SCOPE_VIEW_PERMISSION[scope]);
  if (denied) return denied;

  const item = await (modelFor(scope) as typeof prisma.systemSetting).findFirst({
    where: { id, deletedAt: null },
  });
  if (!item) return failNotFound(ERROR_CODES.SETTING_NOT_FOUND, "设置项不存在");
  return ok(item);
}

/** PATCH /api/settings/:id?scope=...（乐观锁） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  if (!user) return fail(ERROR_CODES.AUTHENTICATION_ERROR, "Unauthorized", 401);
  requestLog(request, user.id, "settings.update");

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope")?.trim()?.toUpperCase() ?? "SYSTEM";
  if (!settingScopeSchema.safeParse(scope).success) {
    return failValidation({ scope: "scope 必须为 SYSTEM/TENANT/USER" });
  }
  const denied = requirePermission(user, SCOPE_PERMISSION[scope]);
  if (denied) return denied;

  const parsed = settingUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;
  const model = modelFor(scope) as typeof prisma.systemSetting;

  const existing = await model.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.SETTING_NOT_FOUND, "设置项不存在");
  if (existing.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }

  const updated = await model.update({
    where: { id },
    data: {
      ...(updates.value !== undefined ? { value: updates.value } : {}),
      ...(updates.dataType !== undefined ? { dataType: updates.dataType } : {}),
      ...(updates.encrypted !== undefined ? { encrypted: updates.encrypted } : {}),
      ...(updates.description !== undefined ? { description: updates.description } : {}),
      version: { increment: 1 },
      updatedById: user.id,
    },
  });

  await writeAuditLog({
    actorId: user.id,
    action: `${scope.toLowerCase()}-setting.update`,
    entityType: `${scope.toLowerCase()}-setting`,
    entityId: id,
    ipAddress: clientIp(request),
    meta: { version: updated.version },
  });

  return ok(updated);
}

/** DELETE /api/settings/:id?scope=...（软删除） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  if (!user) return fail(ERROR_CODES.AUTHENTICATION_ERROR, "Unauthorized", 401);
  requestLog(request, user.id, "settings.delete");

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope")?.trim()?.toUpperCase() ?? "SYSTEM";
  if (!settingScopeSchema.safeParse(scope).success) {
    return failValidation({ scope: "scope 必须为 SYSTEM/TENANT/USER" });
  }
  const denied = requirePermission(user, SCOPE_DELETE_PERMISSION[scope]);
  if (denied) return denied;

  const model = modelFor(scope) as typeof prisma.systemSetting;
  const result = await model.updateMany({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date(), updatedById: user.id },
  });
  if (result.count === 0) return failNotFound(ERROR_CODES.SETTING_NOT_FOUND, "设置项不存在");

  await writeAuditLog({
    actorId: user.id,
    action: `${scope.toLowerCase()}-setting.delete`,
    entityType: `${scope.toLowerCase()}-setting`,
    entityId: id,
    ipAddress: clientIp(request),
  });

  return ok({ id, deleted: true });
}
