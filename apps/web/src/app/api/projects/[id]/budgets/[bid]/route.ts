import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog, assertProjectWritable } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const budgetUpdateSchema = z
  .object({
    category: z.string().min(1).max(100).optional(),
    amount: z.coerce.number().nonnegative().optional(),
    currency: z.string().max(10).optional(),
    note: z.string().max(500).nullable().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** GET /api/projects/:id/budgets/:bid（预算详情） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; bid: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-budget:view");
  if (denied) return denied;
  requestLog(request, user?.id, "project-budget.get");

  const { id, bid } = await params;
  const item = await prisma.projectBudget.findFirst({ where: { id: bid, projectId: id, deletedAt: null } });
  if (!item) return failNotFound(ERROR_CODES.NOT_FOUND, "预算不存在");
  return ok(item);
}

/** PATCH /api/projects/:id/budgets/:bid（乐观锁 version） */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; bid: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-budget:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "project-budget.update");

  const { id, bid } = await params;
  const meta = requestMeta(request);
  const parsed = budgetUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;
  const txResult = await prisma.$transaction(async (tx) => {
    const gate = await assertProjectWritable(tx, id);
    if (!gate.ok) return { error: gate.response };

    const existing = await tx.projectBudget.findFirst({ where: { id: bid, projectId: id, deletedAt: null } });
    if (!existing) return { error: failNotFound(ERROR_CODES.NOT_FOUND, "预算不存在") };
    if (existing.version !== version) {
      return { error: failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试") };
    }

    const updated = await tx.projectBudget.update({
      where: { id: bid },
      data: { ...updates, version: { increment: 1 }, updatedById: user!.id },
    });
    return { existing, updated };
  });
  if ("error" in txResult) return txResult.error;

  await writeAuditLog({
    actorId: user?.id,
    action: "project-budget.update",
    entityType: "projectBudget",
    entityId: bid,
    beforeData: { category: txResult.existing.category, amount: txResult.existing.amount },
    afterData: { category: txResult.updated.category, amount: txResult.updated.amount },
    ...meta,
  });

  return ok(txResult.updated);
}

/** DELETE /api/projects/:id/budgets/:bid（软删除） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; bid: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-budget:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "project-budget.delete");

  const { id, bid } = await params;
  const meta = requestMeta(request);

  const txResult = await prisma.$transaction(async (tx) => {
    const gate = await assertProjectWritable(tx, id);
    if (!gate.ok) return { error: gate.response };

    const existing = await tx.projectBudget.findFirst({ where: { id: bid, projectId: id, deletedAt: null } });
    if (!existing) return { error: failNotFound(ERROR_CODES.NOT_FOUND, "预算不存在") };

    await tx.projectBudget.update({
      where: { id: bid },
      data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
    });
    return { ok: true };
  });
  if ("error" in txResult) return txResult.error;

  await writeAuditLog({
    actorId: user?.id,
    action: "project-budget.delete",
    entityType: "projectBudget",
    entityId: bid,
    ...meta,
  });

  return ok({ id: bid, deleted: true });
}
