import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound, fail } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { receiptAllocationReverseSchema } from "@/lib/api/schemas";
import { createReceiptRevision, createReceiptSnapshot, latestReceiptRevisionNo } from "@/lib/receipt/helpers";
import { createAccountsReceivableRevision, latestAccountsReceivableRevisionNo } from "@/lib/accounts-receivable/helpers";
import { computeBalance, computeArStatus } from "@/lib/accounts-receivable/projection";
import { publishReceiptEvent } from "@/lib/receipt/events";
import { writeDomainEvent } from "@/lib/domain-events/writer";

export const dynamic = "force-dynamic";

/**
 * POST /api/receipt-allocations/:id/reverse —— Allocation Reversal（CTO Design Review 新锁定边界）
 * 撤销原核销关系：**不删除原 ReceiptAllocation**，写入 reversedAt/reversedBy/reverseReason 留痕（独立逆向事实）；
 * 恢复 AR / Invoice / Receipt 三方投影；CN 不承担收款冲销（CN 属 4E-3 发票调整域）。
 *
 * 事务顺序（对齐 Allocation 锁序）：Lock Receipt → Lock AR（id ASC FOR UPDATE）→ 校验 Allocation 存在且未冲销
 * → AR.paidAmount 回退 / balanceAmount 重算 / status 投影 → Invoice 投影回退 → Receipt 投影恢复
 * → AR Revision + Receipt Revision/Snapshot(REVERSED) → Events（ReceiptAllocationReversed）
 * 任何一步失败整体回滚。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "receipt:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "receipt-allocation.reverse");

  const { id: allocationId } = await params;
  const parsed = receiptAllocationReverseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { reverseReason } = parsed.data;
  const meta = requestMeta(request);

  const result = await prisma.$transaction(async (tx) => {
    // 1. 定位 Allocation（含 Receipt/AR 引用）
    const allocation = await tx.receiptAllocation.findFirst({
      where: { id: allocationId, deletedAt: null },
      include: { receipt: true, accountsReceivable: true },
    });
    if (!allocation) return { error: "ALLOCATION_NOT_FOUND" as const };
    if (allocation.reversedAt) {
      return { error: "ALREADY_REVERSED" as const, reversedAt: allocation.reversedAt.toISOString() };
    }

    // 2. Lock Receipt（FOR UPDATE）
    const lockedReceipt = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "Receipt" WHERE "id" = ${allocation.receiptId} AND "deletedAt" IS NULL FOR UPDATE`,
    );
    if (lockedReceipt.length === 0) return { error: "RECEIPT_NOT_FOUND" as const };

    // 3. Lock AR（FOR UPDATE）
    const lockedAr = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "AccountsReceivable" WHERE "id" = ${allocation.accountsReceivableId} AND "deletedAt" IS NULL FOR UPDATE`,
    );
    if (lockedAr.length === 0) return { error: "AR_NOT_FOUND" as const };

    const ar = await tx.accountsReceivable.findFirst({
      where: { id: allocation.accountsReceivableId, deletedAt: null },
    });
    if (!ar) return { error: "AR_NOT_FOUND" as const };

    // 4. 回退 AR 投影：paidAmount -= allocatedAmount；balanceAmount 重算；status 投影（统一 computeArStatus）
    const reversedAmount = allocation.allocatedAmount;
    const newPaid = ar.paidAmount.minus(reversedAmount);
    const newBalance = new Prisma.Decimal(computeBalance(ar.originalAmount, ar.adjustedAmount, newPaid, ar.writeOffAmount));
    // CTO Final Review 阻断项②：AR 状态统一走 computeArStatus——
    // 全额冲销后 newPaid=0 应回到 OPEN（旧逻辑误判 PARTIALLY_PAID）；余额因 WriteOff 归零应判 CLOSED
    const newStatus = computeArStatus(newBalance, newPaid, ar.writeOffAmount);
    const now = new Date();

    // CTO Final Review 阻断项③：lastPaymentAt 不得无条件置 null——
    // 重新计算该 AR 所有未冲销（reversedAt=null，且排除当前这笔）的有效 ReceiptAllocation，取最新收款时间；无有效付款才 null
    const latestActiveAllocation = await tx.receiptAllocation.findFirst({
      where: { accountsReceivableId: ar.id, deletedAt: null, reversedAt: null, id: { not: allocation.id } },
      orderBy: { allocatedAt: "desc" },
      select: { allocatedAt: true },
    });

    await tx.accountsReceivable.update({
      where: { id: ar.id },
      data: {
        paidAmount: newPaid,
        balanceAmount: newBalance,
        status: newStatus as never,
        lastPaymentAt: latestActiveAllocation?.allocatedAt ?? null, // 重算：仍有有效付款则保留最新时间，否则 null
        updatedById: user?.id ?? null,
      },
    });

    // 5. Invoice 投影回退（balanceAmount 直接回写 AR 的 newBalance——CTO 阻断项①）
    const invoice = await tx.invoice.findFirst({ where: { id: ar.invoiceId, deletedAt: null } });
    if (invoice) {
      const newInvoicePaid = invoice.paidAmount.minus(reversedAmount);
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          paidAmount: newInvoicePaid,
          // Invoice.balanceAmount = Projection：直接使用 AR 计算出的 newBalance（computeBalance 单入口），
          // 不得用 invoiceTotal - paidAmount 自己重算——否则已发生的 WriteOff（及未来 4E-3 adjustedAmount）会被“复活”/丢失
          balanceAmount: newBalance,
          updatedById: user?.id ?? null,
        },
      });
    }

    // 6. AR Revision（留痕）
    const arSnapshotData = {
      accountsReceivableId: ar.id,
      invoiceId: ar.invoiceId,
      customerId: ar.customerId,
      currency: ar.currency,
      originalAmount: ar.originalAmount.toString(),
      adjustedAmount: ar.adjustedAmount.toString(),
      paidAmount: newPaid.toString(),
      writeOffAmount: ar.writeOffAmount.toString(),
      balanceAmount: newBalance.toString(),
      status: newStatus,
      reversedAllocationId: allocation.id,
      reversedAmount: reversedAmount.toString(),
      reverseReason,
      reversedAt: now.toISOString(),
    };
    await createAccountsReceivableRevision(tx, ar.id, `冲销核销：${reverseReason}`, arSnapshotData, user?.id);
    await latestAccountsReceivableRevisionNo(tx, ar.id);

    // 7. 恢复 Receipt 投影：allocatedAmount -= ；unallocatedAmount += ；status 投影
    const receipt = allocation.receipt;
    const newAllocated = receipt.allocatedAmount.minus(reversedAmount);
    const newUnallocated = receipt.unallocatedAmount.plus(reversedAmount);
    const newReceiptStatus = newAllocated.equals(0) ? "UNALLOCATED" : "PARTIALLY_ALLOCATED";
    await tx.receipt.update({
      where: { id: receipt.id },
      data: {
        allocatedAmount: newAllocated,
        unallocatedAmount: newUnallocated,
        status: newReceiptStatus as never,
        updatedById: user?.id ?? null,
      },
    });

    // 8. Allocation 留痕（不删除——独立逆向事实）
    await tx.receiptAllocation.update({
      where: { id: allocation.id },
      data: {
        reversedAt: now,
        reversedBy: user?.id ?? null,
        reverseReason,
        updatedById: user?.id ?? null,
      },
    });

    // 9. Receipt Revision + Snapshot(REVERSED)
    const receiptSnapshotData = {
      receiptId: receipt.id,
      code: receipt.code,
      customerId: receipt.customerId,
      currency: receipt.currency,
      amount: receipt.amount.toString(),
      allocatedAmount: newAllocated.toString(),
      unallocatedAmount: newUnallocated.toString(),
      status: newReceiptStatus,
      reversedAllocationId: allocation.id,
      reversedAmount: reversedAmount.toString(),
      reverseReason,
    };
    await createReceiptRevision(tx, receipt.id, `冲销核销：${reverseReason}`, receiptSnapshotData, user?.id);
    const receiptRevisionNo = await latestReceiptRevisionNo(tx, receipt.id);
    await createReceiptSnapshot(tx, receipt.id, "REVERSED", receiptRevisionNo, receiptSnapshotData, user?.id);

    // ── 9b. ReceiptAllocationReversed Outbox（业务事务内原子写；GL consumer → 红字冲销，ADR-0042） ──
    await writeDomainEvent(tx, {
      eventType: "ReceiptAllocationReversed",
      aggregateType: "ReceiptAllocation",
      aggregateId: allocation.id,
      payload: {
        receiptAllocationId: allocation.id,
        receiptId: receipt.id,
        receiptCode: receipt.code,
        accountsReceivableId: ar.id,
        allocatedAmount: allocation.allocatedAmount.toString(),
        reversedAmount: reversedAmount.toString(),
        paymentMethod: receipt.paymentMethod,
        reversedAt: now.toISOString(),
        reversedById: user?.id ?? null,
      },
      idempotencyKey: "ReceiptAllocationReversed|" + allocation.id,
    });

    return {
      allocationId: allocation.id,
      reversedAmount,
      receiptId: receipt.id,
      customerId: receipt.customerId,
      currency: receipt.currency,
      amount: receipt.amount,
      arId: ar.id,
      newArStatus: newStatus,
      newReceiptStatus,
    };
  });

  if ("error" in result) {
    switch (result.error) {
      case "ALLOCATION_NOT_FOUND":
        return failNotFound(ERROR_CODES.RECEIPT_ALLOCATION_NOT_FOUND, "核销记录不存在");
      case "ALREADY_REVERSED":
        return failConflict(ERROR_CODES.RECEIPT_ALLOCATION_REVERSED, `该核销已冲销（${result.reversedAt}），不可重复冲销`);
      case "RECEIPT_NOT_FOUND":
        return failNotFound(ERROR_CODES.RECEIPT_NOT_FOUND, "收款单不存在");
      case "AR_NOT_FOUND":
        return failNotFound(ERROR_CODES.ACCOUNTS_RECEIVABLE_NOT_FOUND, "应收记录不存在");
      default:
        return fail(ERROR_CODES.INTERNAL_ERROR, "冲销失败：未知错误", 500);
    }
  }

  // 10. 事件 + 审计（事务外，事件失败不阻断）
  try {
    await publishReceiptEvent({
      eventType: "ReceiptAllocationReversed",
      actorId: user?.id,
      entityId: result.receiptId,
      payload: {
        receiptId: result.receiptId,
        customerId: result.customerId,
        currency: result.currency,
        amount: result.amount,
        receiptAllocationId: result.allocationId,
        accountsReceivableId: result.arId,
        reversedAmount: result.reversedAmount.toString(),
        arStatus: result.newArStatus,
        receiptStatus: result.newReceiptStatus,
      },
      meta,
    });
    await writeAuditLog({
      actorId: user?.id,
      action: "receipt-allocation.reverse",
      entityType: "receipt",
      entityId: result.receiptId,
      afterData: {
        receiptAllocationId: result.allocationId,
        accountsReceivableId: result.arId,
        reversedAmount: result.reversedAmount.toString(),
        arStatus: result.newArStatus,
        receiptStatus: result.newReceiptStatus,
      },
      ...meta,
    });
  } catch {
    // 事件/审计失败不阻断主流程
  }

  return ok(
    {
      allocationId: result.allocationId,
      reversedAmount: result.reversedAmount,
      receiptId: result.receiptId,
      accountsReceivableId: result.arId,
      arStatus: result.newArStatus,
      receiptStatus: result.newReceiptStatus,
    },
    undefined,
    201,
  );
}
