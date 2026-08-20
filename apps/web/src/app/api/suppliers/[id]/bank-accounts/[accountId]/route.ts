import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { casUpdate } from "@/lib/api/cas";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const bankAccountUpdateSchema = z
  .object({
    bankName: z.string().min(1).max(200).optional(),
    accountName: z.string().min(1).max(200).optional(),
    accountNo: z.string().min(1).max(100).optional(),
    currency: z.string().max(10).optional(),
    isDefault: z.boolean().optional(),
    swiftCode: z.string().max(20).nullable().optional(),
    version: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: "至少提供一个更新字段" });

/** PATCH /api/suppliers/:id/bank-accounts/:accountId（PartnerBankAccount 乐观锁；isDefault 时清除其他默认账户） */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> },
) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "partner-bank-account:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "partner-bank-account.update");

  const { id, accountId } = await params;
  const meta = requestMeta(request);
  const parsed = bankAccountUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const { version, ...updates } = parsed.data;

  const supplier = await prisma.supplier.findFirst({ where: { id, deletedAt: null }, select: { partnerId: true } });
  if (!supplier) return failNotFound(ERROR_CODES.NOT_FOUND, "供应商不存在");

  const existing = await prisma.partnerBankAccount.findFirst({
    where: { id: accountId, partnerId: supplier.partnerId, deletedAt: null },
  });
  if (!existing) return failNotFound(ERROR_CODES.NOT_FOUND, "银行账户不存在");

  // A4-CAS：原子乐观锁置于事务首部（消除 read-check-update TOCTOU）
  const updated = await prisma.$transaction(async (tx) => {
    const cas = await casUpdate(tx, "partnerBankAccount", accountId, version, {
      ...updates,
      updatedById: user!.id,
    });
    if (cas.outcome !== "OK") return null;
    if (updates.isDefault === true) {
      await tx.partnerBankAccount.updateMany({
        where: { partnerId: supplier.partnerId, deletedAt: null, id: { not: accountId } },
        data: { isDefault: false, updatedById: user?.id ?? null },
      });
    }
    return tx.partnerBankAccount.findFirst({ where: { id: accountId, deletedAt: null } });
  });
  if (!updated) {
    const stillExists = await prisma.partnerBankAccount.findFirst({
      where: { id: accountId, deletedAt: null },
      select: { id: true },
    });
    return stillExists
      ? failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试")
      : failNotFound(ERROR_CODES.NOT_FOUND, "银行账户不存在");
  }

  await writeAuditLog({
    actorId: user?.id,
    action: "partner-bank-account.update",
    entityType: "partner-bank-account",
    entityId: accountId,
    beforeData: { bankName: existing.bankName, isDefault: existing.isDefault },
    afterData: { bankName: updated.bankName, isDefault: updated.isDefault },
    ...meta,
  });

  return ok(updated);
}

/** DELETE /api/suppliers/:id/bank-accounts/:accountId（软删除） */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> },
) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "partner-bank-account:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "partner-bank-account.delete");

  const { id, accountId } = await params;
  const meta = requestMeta(request);

  const supplier = await prisma.supplier.findFirst({ where: { id, deletedAt: null }, select: { partnerId: true } });
  if (!supplier) return failNotFound(ERROR_CODES.NOT_FOUND, "供应商不存在");

  const result = await prisma.partnerBankAccount.updateMany({
    where: { id: accountId, partnerId: supplier.partnerId, deletedAt: null },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null },
  });
  if (result.count === 0) return failNotFound(ERROR_CODES.NOT_FOUND, "银行账户不存在");

  await writeAuditLog({
    actorId: user?.id,
    action: "partner-bank-account.delete",
    entityType: "partner-bank-account",
    entityId: accountId,
    ...meta,
  });

  return ok({ id: accountId, deleted: true });
}
