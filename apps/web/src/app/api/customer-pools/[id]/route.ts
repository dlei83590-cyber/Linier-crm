import { NextRequest } from "next/server";
import type { CustomerPoolScopeType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, fail, failValidation, failNotFound, failConflict } from "@/lib/api/response";
import { handleServerError } from "@/lib/api/server-error";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { casUpdate } from "@/lib/api/cas";
import { z } from "zod";
import { validatePoolScope } from "@/lib/customer-pool/validators";

export const dynamic = "force-dynamic";

const poolUpdateSchema = z.object({
  version: z.number().int().positive(),
  code: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(500).nullable().optional(),
  scopeType: z.enum(["GLOBAL", "REGION", "DEPARTMENT"]).optional(),
  scopeValue: z.string().max(200).nullable().optional(),
  isActive: z.boolean().optional(),
});

/** GET /api/customer-pools/:id */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "customer-pool:view");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-pool.get");

  const { id } = await params;
  const pool = await prisma.customerPool.findFirst({
    where: { id, deletedAt: null },
    include: {
      rules: { where: { deletedAt: null }, orderBy: { priority: "desc" } },
      _count: { select: { entries: true } },
    },
  });
  if (!pool) return failNotFound(ERROR_CODES.POOL_NOT_FOUND, "公海池不存在");
  return ok(pool);
}

/** PATCH /api/customer-pools/:id（乐观锁 version；scopeType/value 组合校验） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "customer-pool:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-pool.update");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = poolUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;

  const existing = await prisma.customerPool.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.POOL_NOT_FOUND, "公海池不存在");

  // code 唯一（排除自身）
  if (updates.code) {
    const codeExisting = await prisma.customerPool.findUnique({ where: { code: updates.code } });
    if (codeExisting && codeExisting.id !== id && !codeExisting.deletedAt) {
      return failConflict(ERROR_CODES.POOL_CODE_EXISTS, "公海池编码已存在");
    }
  }

  // scopeType/scopeValue 组合校验（若任一变更则按合并后值校验）
  const nextScopeType = updates.scopeType ?? existing.scopeType;
  const nextScopeValue = updates.scopeValue !== undefined ? updates.scopeValue : existing.scopeValue;
  const scopeCheck = validatePoolScope(nextScopeType, nextScopeValue);
  if (!scopeCheck.ok) {
    return fail(scopeCheck.errorCode ?? ERROR_CODES.POOL_SCOPE_INVALID, scopeCheck.message ?? "scope 非法", 400);
  }

  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      const cas = await casUpdate(tx, "customerPool", id, version, {
        ...updates,
        scopeValue: updates.scopeValue !== undefined ? (updates.scopeValue?.trim() || null) : undefined,
        updatedById: user?.id ?? null,
      });
      if (cas.outcome === "NOT_FOUND") throw new Error("NOT_FOUND");
      if (cas.outcome === "CONFLICT") throw new Error("VERSION_CONFLICT");
      const saved = await tx.customerPool.findFirst({ where: { id, deletedAt: null } });
      if (!saved) throw new Error("NOT_FOUND");
      return saved;
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_FOUND") return failNotFound(ERROR_CODES.POOL_NOT_FOUND, "公海池不存在");
    if (msg === "VERSION_CONFLICT") return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
    if (e !== null && typeof e === "object" && (e as { code?: unknown }).code === "P2002") {
      return failConflict(ERROR_CODES.POOL_CODE_EXISTS, "公海池编码已存在");
    }
    return handleServerError(request, user?.id, "customer-pool.update", e);
  }

  await writeAuditLog({
    actorId: user?.id,
    action: "customer-pool.update",
    entityType: "customerPool",
    entityId: id,
    beforeData: { code: existing.code, name: existing.name },
    afterData: { code: updated.code, name: updated.name, scopeType: updated.scopeType },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/customer-pools/:id（软删；entries/rules 保留，规则评估跳过 inactive/deleted 池） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "customer-pool:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-pool.delete");

  const { id } = await params;
  const meta = requestMeta(request);
  const existing = await prisma.customerPool.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.POOL_NOT_FOUND, "公海池不存在");

  try {
    await prisma.customerPool.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
    });
  } catch (e) {
    return handleServerError(request, user?.id, "customer-pool.delete", e);
  }

  await writeAuditLog({
    actorId: user?.id,
    action: "customer-pool.delete",
    entityType: "customerPool",
    entityId: id,
    beforeData: { code: existing.code, name: existing.name },
    ...meta,
  });

  return ok({ id, deleted: true });
}
