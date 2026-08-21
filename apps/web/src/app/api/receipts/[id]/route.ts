import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/receipts/:id（详情：Receipt + Customer 摘要 + allocations（含 AR 摘要）+ 最近 Revision/Snapshot）
 * 注意：无 PATCH——金额/状态为受控投影（拍板②），只能由 allocate/reversal/void 事务更新。
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "receipt:view");
  if (denied) return denied;
  requestLog(request, user?.id, "receipt.get");

  const { id } = await params;
  const receipt = await prisma.receipt.findFirst({
    where: { id, deletedAt: null },
    include: {
      customer: { select: { id: true, code: true, name: true } },
      allocations: {
        where: { deletedAt: null },
        orderBy: { allocatedAt: "desc" },
        include: {
          accountsReceivable: {
            select: { id: true, invoiceId: true, balanceAmount: true, status: true },
          },
        },
      },
      revisions: { where: { deletedAt: null }, orderBy: { revisionNo: "desc" }, take: 1 },
      snapshots: { where: { deletedAt: null }, orderBy: { generatedAt: "desc" }, take: 1 },
    },
  });
  if (!receipt) return failNotFound(ERROR_CODES.RECEIPT_NOT_FOUND, "收款单不存在");
  return ok(receipt);
}

/** DELETE /api/receipts/:id（层层回退-层层可删除：仅 VOIDED 且无核销引用可软删除） */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "receipt:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "receipt.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const receipt = await prisma.receipt.findFirst({ where: { id, deletedAt: null } });
  if (!receipt) return failNotFound(ERROR_CODES.RECEIPT_NOT_FOUND, "收款单不存在");
  if (receipt.status !== "VOIDED") {
    return failConflict(ERROR_CODES.RECEIPT_VOID_FORBIDDEN, "仅 VOIDED 状态可删除（作废后清理列表）；未核销/已核销收款单禁止删除");
  }
  // 引用防御：仅**实际应用**（未冲销 reversedAt IS NULL）的核销记录阻止删除；
  // 已冲销（reversedAt 非空）的核销属历史痕迹，不再实际核销该收款单 → 允许删除清理
  const activeAllocCount = await prisma.receiptAllocation.count({
    where: { receiptId: id, deletedAt: null, reversedAt: null },
  });
  if (activeAllocCount > 0) {
    return failConflict(ERROR_CODES.RECEIPT_VOID_FORBIDDEN, "收款单仍有未冲销的核销记录，禁止删除（先冲销核销后再删除）");
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.receipt.update({ where: { id }, data: { deletedAt: now, isActive: false, updatedById: user!.id } });
    await tx.receiptRevision.updateMany({ where: { receiptId: id, deletedAt: null }, data: { deletedAt: now, isActive: false } });
    await tx.receiptSnapshot.updateMany({ where: { receiptId: id, deletedAt: null }, data: { deletedAt: now, isActive: false } });
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "receipt.delete",
    entityType: "receipt",
    entityId: id,
    afterData: { code: receipt.code },
    ...meta,
  });

  return ok({ id, deleted: true });
}
