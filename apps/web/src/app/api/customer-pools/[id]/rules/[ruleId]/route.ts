import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, fail, failValidation, failNotFound, failConflict } from "@/lib/api/response";
import { handleServerError } from "@/lib/api/server-error";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { casUpdate } from "@/lib/api/cas";
import { z } from "zod";
import { validateRule } from "@/lib/customer-pool/validators";

export const dynamic = "force-dynamic";

const ruleUpdateSchema = z.object({
  version: z.number().int().positive(),
  ruleType: z.enum(["FIELD_MATCH", "INACTIVITY"]).optional(),
  matchMode: z.enum(["ALL", "ANY"]).optional(),
  condition: z.array(z.record(z.string(), z.unknown())).optional(),
  priority: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

/** 校验规则归属 pool（fail-closed：rule 必须属于 :id 且均未删除） */
async function findRule(poolId: string, ruleId: string) {
  const rule = await prisma.customerPoolRule.findFirst({
    where: { id: ruleId, poolId, deletedAt: null },
  });
  return rule;
}

/** PATCH /api/customer-pools/:id/rules/:ruleId（乐观锁 version；INACTIVITY 启用仍拒绝） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; ruleId: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "customer-pool:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-pool-rule.update");

  const { id, ruleId } = await params;
  const meta = requestMeta(request);
  const parsed = ruleUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const pool = await prisma.customerPool.findFirst({ where: { id, deletedAt: null } });
  if (!pool) return failNotFound(ERROR_CODES.POOL_NOT_FOUND, "公海池不存在");

  const existing = await findRule(id, ruleId);
  if (!existing) return failNotFound(ERROR_CODES.POOL_RULE_NOT_FOUND, "规则不存在");

  const { version, ...updates } = parsed.data;

  // 若变更 ruleType/condition → 重新校验（INACTIVITY 始终拒绝；FIELD_MATCH condition 白名单）
  const nextRuleType = updates.ruleType ?? existing.ruleType;
  const nextMatchMode = updates.matchMode ?? existing.matchMode;
  const nextCondition = updates.condition !== undefined ? updates.condition : (existing.condition as unknown[]);
  const ruleCheck = validateRule(nextRuleType, nextMatchMode, nextCondition);
  if (!ruleCheck.ok) {
    return fail(ruleCheck.errorCode ?? ERROR_CODES.POOL_RULE_INVALID, ruleCheck.message ?? "规则非法", 400);
  }

  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      const cas = await casUpdate(tx, "customerPoolRule", ruleId, version, {
        ...updates,
        condition: updates.condition !== undefined ? (updates.condition as Prisma.InputJsonValue) : undefined,
        updatedById: user?.id ?? null,
      });
      if (cas.outcome === "NOT_FOUND") throw new Error("NOT_FOUND");
      if (cas.outcome === "CONFLICT") throw new Error("VERSION_CONFLICT");
      const saved = await tx.customerPoolRule.findFirst({ where: { id: ruleId, poolId: id, deletedAt: null } });
      if (!saved) throw new Error("NOT_FOUND");
      return saved;
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_FOUND") return failNotFound(ERROR_CODES.POOL_RULE_NOT_FOUND, "规则不存在");
    if (msg === "VERSION_CONFLICT") return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
    return handleServerError(request, user?.id, "customer-pool-rule.update", e);
  }

  await writeAuditLog({
    actorId: user?.id,
    action: "customer-pool-rule.update",
    entityType: "customerPoolRule",
    entityId: ruleId,
    beforeData: { ruleType: existing.ruleType, priority: existing.priority },
    afterData: { ruleType: updated.ruleType, priority: updated.priority },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/customer-pools/:id/rules/:ruleId（软删） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; ruleId: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "customer-pool:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-pool-rule.delete");

  const { id, ruleId } = await params;
  const meta = requestMeta(request);

  const pool = await prisma.customerPool.findFirst({ where: { id, deletedAt: null } });
  if (!pool) return failNotFound(ERROR_CODES.POOL_NOT_FOUND, "公海池不存在");
  const existing = await findRule(id, ruleId);
  if (!existing) return failNotFound(ERROR_CODES.POOL_RULE_NOT_FOUND, "规则不存在");

  try {
    await prisma.customerPoolRule.update({
      where: { id: ruleId },
      data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
    });
  } catch (e) {
    return handleServerError(request, user?.id, "customer-pool-rule.delete", e);
  }

  await writeAuditLog({
    actorId: user?.id,
    action: "customer-pool-rule.delete",
    entityType: "customerPoolRule",
    entityId: ruleId,
    beforeData: { poolId: id, ruleType: existing.ruleType },
    ...meta,
  });

  return ok({ id: ruleId, deleted: true });
}
