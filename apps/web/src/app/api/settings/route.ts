import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, clientIp, writeAuditLog } from "@/lib/api-helpers";
import { ok, fail, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { settingCreateSchema, settingScopeSchema } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";

/** 按 scope 选择权限码 */
const SCOPE_PERMISSION: Record<string, string> = {
  SYSTEM: "system-setting:view",
  TENANT: "tenant-setting:view",
  USER: "user-setting:view",
};

/** GET /api/settings?scope=SYSTEM|TENANT|USER（三层 Key-Value 列表） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  if (!user) {
    return fail(ERROR_CODES.AUTHENTICATION_ERROR, "Unauthorized", 401);
  }
  requestLog(request, user.id, "settings.list");

  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope")?.trim()?.toUpperCase() ?? "SYSTEM";
  if (!settingScopeSchema.safeParse(scope).success) {
    return failValidation({ scope: "scope 必须为 SYSTEM/TENANT/USER" });
  }
  const denied = requirePermission(user, SCOPE_PERMISSION[scope]);
  if (denied) return denied;

  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const key = searchParams.get("key")?.trim();
  const whereBase = { deletedAt: null, ...(key ? { key: { contains: key } } : {}) };

  let total: number;
  let items: unknown[];
  if (scope === "SYSTEM") {
    const rows = await prisma.systemSetting.findMany({
      where: whereBase,
      orderBy: { updatedAt: "desc" },
      skip,
      take,
    });
    total = await prisma.systemSetting.count({ where: whereBase });
    items = rows.map(maskEncrypted);
  } else if (scope === "TENANT") {
    const tenantId = searchParams.get("tenantId")?.trim();
    const where = { ...whereBase, ...(tenantId ? { tenantId } : {}) };
    const rows = await prisma.tenantSetting.findMany({ where, orderBy: { updatedAt: "desc" }, skip, take });
    total = await prisma.tenantSetting.count({ where });
    items = rows.map(maskEncrypted);
  } else {
    const userId = searchParams.get("userId")?.trim() ?? user.id;
    const where = { ...whereBase, userId };
    const rows = await prisma.userSetting.findMany({ where, orderBy: { updatedAt: "desc" }, skip, take });
    total = await prisma.userSetting.count({ where });
    items = rows.map(maskEncrypted);
  }

  return ok(items, { page, pageSize, total });
}

/** 加密项打码：encrypted=true 时 value 返回掩码，不返回明文 */
function maskEncrypted<T extends { encrypted: boolean; value: string | null }>(item: T): T {
  if (item.encrypted) {
    return { ...item, value: "******" };
  }
  return item;
}

/** POST /api/settings（三层创建；TENANT 需 tenantId，USER 默认当前用户） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  if (!user) {
    return fail(ERROR_CODES.AUTHENTICATION_ERROR, "Unauthorized", 401);
  }
  requestLog(request, user.id, "settings.create");

  const parsed = settingCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { scope, tenantId, userId, ...data } = parsed.data;

  const denied = requirePermission(user, SCOPE_PERMISSION[scope]);
  if (denied) return denied;

  if (scope === "TENANT" && !tenantId) {
    return failValidation({ tenantId: "scope=TENANT 时必须提供 tenantId" });
  }

  let created: unknown;
  let entityType: string;
  if (scope === "SYSTEM") {
    const existing = await prisma.systemSetting.findUnique({ where: { key: data.key } });
    if (existing && !existing.deletedAt) {
      return failConflict(ERROR_CODES.SETTING_KEY_EXISTS, "系统设置键已存在");
    }
    created = await prisma.systemSetting.create({
      data: { ...data, createdById: user.id, updatedById: user.id },
    });
    entityType = "system-setting";
  } else if (scope === "TENANT") {
    const existing = await prisma.tenantSetting.findUnique({
      where: { tenantId_key: { tenantId: tenantId!, key: data.key } },
    });
    if (existing && !existing.deletedAt) {
      return failConflict(ERROR_CODES.SETTING_KEY_EXISTS, "租户设置键已存在");
    }
    created = await prisma.tenantSetting.create({
      data: { ...data, tenantId: tenantId!, createdById: user.id, updatedById: user.id },
    });
    entityType = "tenant-setting";
  } else {
    const uid = userId ?? user.id;
    const existing = await prisma.userSetting.findUnique({
      where: { userId_key: { userId: uid, key: data.key } },
    });
    if (existing && !existing.deletedAt) {
      return failConflict(ERROR_CODES.SETTING_KEY_EXISTS, "用户设置键已存在");
    }
    created = await prisma.userSetting.create({
      data: { ...data, userId: uid, createdById: user.id, updatedById: user.id },
    });
    entityType = "user-setting";
  }

  await writeAuditLog({
    actorId: user.id,
    action: `${entityType}.create`,
    entityType,
    entityId: (created as { id: string }).id,
    ipAddress: clientIp(request),
    meta: { scope, key: data.key },
  });

  return ok(created, undefined, 201);
}
