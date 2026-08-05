import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const defUpdateSchema = z
  .object({
    code: z.string().min(1).max(64).optional(),
    name: z.string().min(1).max(100).optional(),
    unit: z.string().max(50).nullable().optional(),
    dataType: z.enum(["STRING", "DECIMAL", "INTEGER", "BOOLEAN", "DATE"]).optional(),
    isRequired: z.boolean().optional(),
    sort: z.number().int().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/specification-definitions/:id */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item-specification:view");
  if (denied) return denied;
  requestLog(request, user?.id, "specification-definition.get");

  const { id } = await params;
  const def = await prisma.specificationDefinition.findFirst({ where: { id, deletedAt: null } });
  if (!def) return failNotFound(ERROR_CODES.NOT_FOUND, "规格定义不存在");
  return ok(def);
}

/** PATCH /api/specification-definitions/:id（乐观锁） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item-specification:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "specification-definition.update");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = defUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;

  const existing = await prisma.specificationDefinition.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "规格定义不存在");
  if (existing.version !== version) {
    return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
  }

  const updated = await prisma.specificationDefinition.update({
    where: { id },
    data: { ...updates, version: { increment: 1 }, updatedById: user!.id },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "specification-definition.update",
    entityType: "specification-definition",
    entityId: id,
    beforeData: { name: existing.name, dataType: existing.dataType },
    afterData: { name: updated.name, dataType: updated.dataType },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/specification-definitions/:id（软删除；被规格引用时拒绝） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "item-specification:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "specification-definition.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const def = await prisma.specificationDefinition.findFirst({ where: { id, deletedAt: null } });
  if (!def) return failNotFound(ERROR_CODES.NOT_FOUND, "规格定义不存在");

  const refCount = await prisma.itemSpecification.count({ where: { definitionId: id, deletedAt: null } });
  if (refCount > 0) return failConflict(ERROR_CODES.CONFLICT, "规格定义已被物料规格引用，不能删除");

  await prisma.specificationDefinition.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "specification-definition.delete",
    entityType: "specification-definition",
    entityId: id,
    ...meta,
  });

  return ok({ id, deleted: true });
}
