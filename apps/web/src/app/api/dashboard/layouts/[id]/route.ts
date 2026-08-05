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
    isDefault: z.boolean().optional(),
    grid: z.record(z.unknown()).nullable().optional(),
    enabled: z.boolean().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/dashboard/layouts/:id */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "dashboard-layout:view");
  if (denied) return denied;
  requestLog(request, user?.id, "layouts.get");

  const { id } = await params;
  const item = await prisma.DashboardLayout.findFirst({ where: { id, deletedAt: null } });
  if (!item) return failNotFound(ERROR_CODES.NOT_FOUND, "Dashboard Layout不存在");
  return ok(item);
}

/** PATCH /api/dashboard/layouts/:id（乐观锁 version） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "dashboard-layout:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "layouts.update");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;

  const existing = await prisma.DashboardLayout.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "Dashboard Layout不存在");
  if (existing.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }

  const updated = await prisma.DashboardLayout.update({
    where: { id },
    data: {
      ...updates,
      grid: updates.grid === undefined ? undefined : updates.grid === null ? Prisma.JsonNull : (updates.grid as Prisma.InputJsonValue),
      version: { increment: 1 },
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "layouts.update",
    entityType: "layouts",
    entityId: id,
    beforeData: { name: existing.name, enabled: existing.enabled },
    afterData: { name: updated.name, enabled: updated.enabled },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/dashboard/layouts/:id（软删除） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "dashboard-layout:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "layouts.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const result = await prisma.DashboardLayout.updateMany({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date(), enabled: false, updatedById: user?.id ?? null },
  });
  if (result.count === 0) return failNotFound(ERROR_CODES.NOT_FOUND, "Dashboard Layout不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "layouts.delete",
    entityType: "layouts",
    entityId: id,
    ...meta,
  });

  return ok({ id, deleted: true });
}
