import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound, fail } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { receiptVoidSchema } from "@/lib/api/schemas";
import { createReceiptRevision, createReceiptSnapshot, latestReceiptRevisionNo } from "@/lib/receipt/helpers";
import { publishReceiptEvent } from "@/lib/receipt/events";

export const dynamic = "force-dynamic";

/**
 * POST /api/receipts/:id/void —— 作废收款单（拍板②：VOID 规则）
 * - 仅 **UNALLOCATED**（未核销）可 VOID；**已有核销不得直接 VOID**（必须先 Allocation Reversal 解除全部核销）
 * - 边界：Void 只作废收款事实本身，**不实现 Credit Note 语义**（CN 属 4E-3 发票调整域，不承担收款冲销）
 * - 事务：Lock Receipt（FOR UPDATE）→ 校验状态 → status=VOIDED + voidedAt/voidedById → Revision + Snapshot(VOIDED) → 事件（事务外）
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "receipt:close");
  if (denied) return denied;
  requestLog(request, user?.id, "receipt.void");

  const { id: receiptId } = await params;
  const parsed = receiptVoidSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { changeReason } = parsed.data;
  const meta = requestMeta(request);

  const result = await prisma.$transaction(async (tx) => {
    // 1. Lock Receipt（FOR UPDATE）
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "Receipt" WHERE "id" = ${receiptId} AND "deletedAt" IS NULL FOR UPDATE`,
    );
    if (locked.length === 0) return { error: "RECEIPT_NOT_FOUND" as const };
    const receipt = await tx.receipt.findFirst({ where: { id: receiptId, deletedAt: null } });
    if (!receipt) return { error: "RECEIPT_NOT_FOUND" as const };

    // 2. 校验状态（拍板②）：仅 UNALLOCATED 可 VOID
    if (receipt.status === "VOIDED") {
      return { error: "ALREADY_VOIDED" as const, status: receipt.status };
    }
    if (receipt.status !== "UNALLOCATED") {
      return { error: "VOID_FORBIDDEN" as const, status: receipt.status, allocatedAmount: receipt.allocatedAmount.toString() };
    }

    // 3. 置为 VOIDED（voidedAt/voidedById）
    const now = new Date();
    const updated = await tx.receipt.update({
      where: { id: receipt.id },
      data: {
        status: "VOIDED",
        voidedAt: now,
        voidedById: user?.id ?? null,
        updatedById: user?.id ?? null,
      },
    });

    // 4. Revision + Snapshot(VOIDED)（Decimal toString）
    const snapshotData = {
      receiptId: receipt.id,
      code: receipt.code,
      customerId: receipt.customerId,
      currency: receipt.currency,
      amount: receipt.amount.toString(),
      allocatedAmount: receipt.allocatedAmount.toString(),
      unallocatedAmount: receipt.unallocatedAmount.toString(),
      receiptDate: receipt.receiptDate.toISOString(),
      paymentMethod: receipt.paymentMethod,
      status: "VOIDED",
      voidedAt: now.toISOString(),
    };
    await createReceiptRevision(tx, receipt.id, changeReason ?? "作废收款单", snapshotData, user?.id);
    const revisionNo = await latestReceiptRevisionNo(tx, receipt.id);
    await createReceiptSnapshot(tx, receipt.id, "VOIDED", revisionNo, snapshotData, user?.id);

    return { receipt: updated };
  });

  if ("error" in result) {
    switch (result.error) {
      case "RECEIPT_NOT_FOUND":
        return failNotFound(ERROR_CODES.RECEIPT_NOT_FOUND, "收款单不存在");
      case "ALREADY_VOIDED":
        return failConflict(ERROR_CODES.RECEIPT_VOID_FORBIDDEN, `收款单已作废（status=${result.status}）`);
      case "VOID_FORBIDDEN":
        return failConflict(
          ERROR_CODES.RECEIPT_VOID_FORBIDDEN,
          `仅未核销收款单可作废（当前 status=${result.status}，allocatedAmount=${result.allocatedAmount}）——已有核销须先 Allocation Reversal`,
        );
      default:
        return fail(ERROR_CODES.INTERNAL_ERROR, "作废失败：未知错误", 500);
    }
  }

  // 5. 事件 + 审计（事务外，事件失败不阻断）
  try {
    await publishReceiptEvent({
      eventType: "ReceiptVoided",
      actorId: user?.id,
      entityId: result.receipt.id,
      payload: {
        receiptId: result.receipt.id,
        receiptCode: result.receipt.code,
        customerId: result.receipt.customerId,
        currency: result.receipt.currency,
        amount: result.receipt.amount,
        voidedAt: result.receipt.voidedAt?.toISOString() ?? null,
        voidedBy: result.receipt.voidedById ?? null,
      },
      meta,
    });
    await writeAuditLog({
      actorId: user?.id,
      action: "receipt.void",
      entityType: "receipt",
      entityId: result.receipt.id,
      afterData: {
        code: result.receipt.code,
        status: "VOIDED",
        voidedAt: result.receipt.voidedAt?.toISOString() ?? null,
      },
      ...meta,
    });
  } catch {
    // 事件/审计失败不阻断主流程
  }

  return ok({ receipt: result.receipt }, undefined, 201);
}
