import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, clientIp, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { casUpdate } from "@/lib/api/cas";
import { notificationTemplateUpdateSchema } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";

/** GET /api/notification-templates/:id */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "notification-template:view");
  if (denied) return denied;
  requestLog(request, user?.id, "notification-template.get");

  const { id } = await params;
  const template = await prisma.notificationTemplate.findFirst({
    where: { id, deletedAt: null },
  });
  if (!template) {
    return failNotFound(ERROR_CODES.NOTIFICATION_TEMPLATE_NOT_FOUND, "通知模板不存在");
  }
  return ok(template);
}

/** PATCH /api/notification-templates/:id（乐观锁） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "notification-template:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "notification-template.update");

  const { id } = await params;
  const parsed = notificationTemplateUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;

  const existing = await prisma.notificationTemplate.findFirst({ where: { id, deletedAt: null } });
  if (!existing) {
    return failNotFound(ERROR_CODES.NOTIFICATION_TEMPLATE_NOT_FOUND, "通知模板不存在");
  }
  

  const cas = await casUpdate(prisma, 'notificationTemplate', id, version, {
});
  if (cas.outcome === 'NOT_FOUND') return failNotFound(ERROR_CODES.NOT_FOUND, "资源不存在");
  if (cas.outcome === 'CONFLICT') return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  const updated = await prisma.notificationTemplate.findFirst({ where: { id, deletedAt: null } });
  if (!updated) return failNotFound(ERROR_CODES.NOT_FOUND, "资源不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "notification-template.update",
    entityType: "notification-template",
    entityId: id,
    ipAddress: clientIp(request),
    meta: { version: updated.version },
  });

  return ok(updated);
}

/** DELETE /api/notification-templates/:id（软删除） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "notification-template:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "notification-template.delete");

  const { id } = await params;
  const result = await prisma.notificationTemplate.updateMany({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });
  if (result.count === 0) {
    return failNotFound(ERROR_CODES.NOTIFICATION_TEMPLATE_NOT_FOUND, "通知模板不存在");
  }

  await writeAuditLog({
    actorId: user?.id,
    action: "notification-template.delete",
    entityType: "notification-template",
    entityId: id,
    ipAddress: clientIp(request),
  });

  return ok({ id, deleted: true });
}
