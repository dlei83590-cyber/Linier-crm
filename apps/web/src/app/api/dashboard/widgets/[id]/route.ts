import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const updateSchema = z
  .object({
    code: z.string().min(1).max(64).optional(),
    name: z.string().min(1).max(100).optional(),
    widgetType: z.enum(["KPI", "CHART", "TABLE"]).optional(),
    dataSource: z.string().max(50).nullable().optional(),
    query: z.record(z.unknown()).nullable().optional(),
    refreshInterval: z.number().int().positive().nullable().optional(),
    sort: z.number().int().optional(),
    enabled: z.boolean().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/dashboard/widgets/:id */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "dashboard-widget:view");
  if (denied) return denied;
  requestLog(request, user?.id, "widgets.get");

  const { id } = await params;
  const item = await prisma.dashboardWidget.findFirst({ where: { id, deletedAt: null } });
  if (!item) return failNotFound(ERROR_CODES.NOT_FOUND, "Dashboard Widget不存在");
  return ok(item);
}

/** PATCH /api/dashboard/widgets/:id（乐观锁 version） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "dashboard-widget:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "widgets.update");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;

  const existing = await prisma.dashboardWidget.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "Dashboard Widget不存在");
  if (existing.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }

  const updated = await prisma.dashboardWidget.update({
    where: { id },
    data: {
      ...updates,
      query: updates.query === undefined ? undefined : updates.query === null ? Prisma.JsonNull : (updates.query as Prisma.InputJsonValue),
      version: { increment: 1 },
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "widgets.update",
    entityType: "widgets",
    entityId: id,
    beforeData: { name: existing.name, enabled: existing.enabled },
    afterData: { name: updated.name, enabled: updated.enabled },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/dashboard/widgets/:id（软删除） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "dashboard-widget:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "widgets.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const result = await prisma.dashboardWidget.updateMany({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date(), enabled: false, updatedById: user?.id ?? null },
  });
  if (result.count === 0) return failNotFound(ERROR_CODES.NOT_FOUND, "Dashboard Widget不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "widgets.delete",
    entityType: "widgets",
    entityId: id,
    ...meta,
  });

  return ok({ id, deleted: true });
}
