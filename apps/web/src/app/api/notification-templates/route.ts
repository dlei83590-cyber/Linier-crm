import { NextRequest } from "next/server";
import type { NotificationChannelType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, clientIp, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { notificationTemplateCreateSchema } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";

/** GET /api/notification-templates（分页 + code/name/channel 搜索） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "notification-template:view");
  if (denied) return denied;
  requestLog(request, user?.id, "notification-template.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const code = searchParams.get("code")?.trim();
  const name = searchParams.get("name")?.trim();
  const channel = searchParams.get("channel")?.trim();

  const where = {
    deletedAt: null,
    ...(code ? { code: { contains: code } } : {}),
    ...(name ? { name: { contains: name } } : {}),
    ...(channel ? { channel: channel as NotificationChannelType } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.notificationTemplate.count({ where }),
    prisma.notificationTemplate.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip,
      take,
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/notification-templates（创建通知模板） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "notification-template:create");
  if (denied) return denied;
  requestLog(request, user?.id, "notification-template.create");

  const parsed = notificationTemplateCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const existing = await prisma.notificationTemplate.findUnique({ where: { code: parsed.data.code } });
  if (existing && !existing.deletedAt) {
    return failConflict(ERROR_CODES.NOTIFICATION_TEMPLATE_CODE_EXISTS, "通知模板编码已存在");
  }

  const created = await prisma.notificationTemplate.create({
    data: { ...parsed.data, createdById: user!.id, updatedById: user!.id },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "notification-template.create",
    entityType: "notification-template",
    entityId: created.id,
    ipAddress: clientIp(request),
    meta: { code: created.code, channel: created.channel },
  });

  return ok(created, undefined, 201);
}
