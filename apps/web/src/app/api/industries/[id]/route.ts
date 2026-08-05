import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const industryUpdateSchema = z
  .object({
    code: z.string().min(2).max(64).optional(),
    name: z.string().min(1).max(100).optional(),
    sort: z.number().int().optional(),
    enabled: z.boolean().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/industries/:id */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "industry:view");
  if (denied) return denied;
  requestLog(request, user?.id, "industry.get");

  const { id } = await params;
  const industry = await prisma.industry.findFirst({ where: { id, deletedAt: null } });
  if (!industry) return failNotFound(ERROR_CODES.NOT_FOUND, "行业不存在");
  return ok(industry);
}

/** PATCH /api/industries/:id（乐观锁 version） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "industry:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "industry.update");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = industryUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;

  const existing = await prisma.industry.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "行业不存在");
  if (existing.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }

  const updated = await prisma.industry.update({
    where: { id },
    data: { ...updates, version: { increment: 1 }, updatedById: user!.id },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "industry.update",
    entityType: "industry",
    entityId: id,
    beforeData: { name: existing.name, sort: existing.sort },
    afterData: { name: updated.name, sort: updated.sort },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/industries/:id（软删除） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "industry:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "industry.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const result = await prisma.industry.updateMany({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date(), enabled: false, updatedById: user?.id ?? null },
  });
  if (result.count === 0) return failNotFound(ERROR_CODES.NOT_FOUND, "行业不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "industry.delete",
    entityType: "industry",
    entityId: id,
    ...meta,
  });

  return ok({ id, deleted: true });
}
