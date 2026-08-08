import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound, fail } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { receiptAllocateSchema } from "@/lib/api/schemas";
import { createReceiptRevision, createReceiptSnapshot, latestReceiptRevisionNo } from "@/lib/receipt/helpers";
import { createAccountsReceivableRevision, createAccountsReceivableSnapshot, latestAccountsReceivableRevisionNo } from "@/lib/accounts-receivable/helpers";
import { computeBalance, computeArStatus } from "@/lib/accounts-receivable/projection";
import { publishReceiptEvent } from "@/lib/receipt/events";

export const dynamic = "force-dynamic";

/**
 * POST /api/receipts/:id/allocate —— 显式核销（拍板①：创建与核销分离；一次请求**原子化**）
 *
 * 事务红线（CTO Design Review 97/100 指定顺序，Final Review 按此检查）：
 *  1. Lock Receipt（FOR UPDATE）
 *  2. Lock all target AR rows（按 id ASC，FOR UPDATE——对齐 4C 防超交 / 4D 防超开票锁序）
 *  3. Validate customer/currency（Receipt.customerId == AR.customerId；Receipt.currency == AR.currency，否则 409）
 *  4. Validate Receipt unallocated balance（Σ allocations ≤ unallocatedAmount，否则 409 RECEIPT_UNALLOCATED_EXCEEDED）
 *  5. Validate each allocation ≤ AR.balanceAmount（锁内读，否则 409 RECEIPT_ALLOCATION_EXCEEDED——并发双核销不超余额）
 *  6. Create ReceiptAllocation
 *  7. Update AR paidAmount / balanceAmount（computeBalance 单入口）+ status 投影（OPEN→PARTIALLY_PAID→PAID）
 *  8. Update Invoice paidAmount / balanceAmount projection
 *  9. Update Receipt allocatedAmount / unallocatedAmount / status 投影（→PARTIALLY_ALLOCATED/FULLY_ALLOCATED）
 *  10. AR Revision + Snapshot（snapshotSource=PAYMENT）
 *  11. Events（ReceiptAllocated / AR PartiallyPaid|Paid / Invoice 投影事件，事务外）
 * 任何一步失败 → 整体回滚（同一事务）。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "receipt:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "receipt.allocate");

  const { id: receiptId } = await params;
  const parsed = receiptAllocateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { allocations, changeReason } = parsed.data;
  const meta = requestMeta(request);

  // 目标 AR 去重 + 按 id ASC 排序（稳定锁序，防死锁；同一 (receipt, AR) 只核销一次）
  const arIdAmount = new Map<string, Prisma.Decimal>();
  for (const a of allocations) {
    const prev = arIdAmount.get(a.accountsReceivableId) ?? new Prisma.Decimal(0);
    arIdAmount.set(a.accountsReceivableId, prev.plus(new Prisma.Decimal(a.amount)));
  }
  const targetArIds = [...arIdAmount.keys()].sort();

  const result = await prisma.$transaction(async (tx) => {
    // ── 1. Lock Receipt（FOR UPDATE） ────────────────────────────────────────
    const lockedReceipt = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "Receipt" WHERE "id" = ${receiptId} AND "deletedAt" IS NULL FOR UPDATE`,
    );
    if (lockedReceipt.length === 0) return { error: "RECEIPT_NOT_FOUND" as const };
    const receipt = await tx.receipt.findFirst({ where: { id: receiptId, deletedAt: null } });
    if (!receipt) return { error: "RECEIPT_NOT_FOUND" as const };
    if (receipt.status === "VOIDED") {
      return { error: "RECEIPT_VOIDED" as const, status: receipt.status };
    }

    // ── 2. Lock all target AR rows（id ASC，FOR UPDATE） ─────────────────────
    const arMap = new Map<
      string,
      {
        id: string;
        customerId: string;
        currency: string;
        paidAmount: Prisma.Decimal;
        writeOffAmount: Prisma.Decimal;
        adjustedAmount: Prisma.Decimal;
        originalAmount: Prisma.Decimal;
        balanceAmount: Prisma.Decimal;
        status: string;
        invoiceId: string;
      }
    >();
    for (const arId of targetArIds) {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "AccountsReceivable" WHERE "id" = ${arId} AND "deletedAt" IS NULL FOR UPDATE`,
      );
      if (locked.length === 0) return { error: "AR_NOT_FOUND" as const, arId };
      const ar = await tx.accountsReceivable.findFirst({ where: { id: arId, deletedAt: null } });
      if (!ar) return { error: "AR_NOT_FOUND" as const, arId };
      arMap.set(arId, ar as never);
    }

    // ── 3. Validate customer / currency（硬规则，CTO 追加） ──────────────────
    for (const arId of targetArIds) {
      const ar = arMap.get(arId)!;
      if (ar.customerId !== receipt.customerId) {
        return { error: "CUSTOMER_MISMATCH" as const, arId, receiptCustomerId: receipt.customerId, arCustomerId: ar.customerId };
      }
      if (ar.currency !== receipt.currency) {
        return { error: "CURRENCY_MISMATCH" as const, arId, receiptCurrency: receipt.currency, arCurrency: ar.currency };
      }
    }

    // ── 4. Validate Receipt unallocated balance ──────────────────────────────
    let totalAllocated = new Prisma.Decimal(0);
    for (const amount of arIdAmount.values()) totalAllocated = totalAllocated.plus(amount);
    if (totalAllocated.greaterThan(receipt.unallocatedAmount)) {
      return {
        error: "UNALLOCATED_EXCEEDED" as const,
        requested: totalAllocated.toString(),
        unallocatedAmount: receipt.unallocatedAmount.toString(),
      };
    }

    // ── 5. Validate each allocation ≤ AR.balanceAmount（锁内读，防超核销） ────
    for (const arId of targetArIds) {
      const amount = arIdAmount.get(arId)!;
      const ar = arMap.get(arId)!;
      if (amount.greaterThan(ar.balanceAmount)) {
        return {
          error: "ALLOCATION_EXCEEDED" as const,
          arId,
          requested: amount.toString(),
          balanceAmount: ar.balanceAmount.toString(),
        };
      }
    }

    // ── 6. Create ReceiptAllocation（每 AR 一行；reversedAt 留空） ────────────
    for (const arId of targetArIds) {
      await tx.receiptAllocation.create({
        data: {
          receiptId: receipt.id,
          accountsReceivableId: arId,
          allocatedAmount: arIdAmount.get(arId)!,
          allocatedBy: user?.id ?? null,
          createdById: user?.id ?? null,
          updatedById: user?.id ?? null,
        },
      });
    }

    // ── 7/8/9. 回写 AR + Invoice + Receipt 投影（同一事务） ──────────────────
    const now = new Date();
    for (const arId of targetArIds) {
      const amount = arIdAmount.get(arId)!;
      const ar = arMap.get(arId)!;
      const newPaid = ar.paidAmount.plus(amount);
      const newBalance = new Prisma.Decimal(
        computeBalance(ar.originalAmount, ar.adjustedAmount, newPaid, ar.writeOffAmount),
      );
      // CTO Final Review 阻断项②：AR 状态统一走 computeArStatus（Payment/Reversal/WriteOff 禁止各自计算）
      const newStatus = computeArStatus(newBalance, newPaid, ar.writeOffAmount);

      await tx.accountsReceivable.update({
        where: { id: arId },
        data: {
          paidAmount: newPaid,
          balanceAmount: newBalance,
          status: newStatus as never,
          lastPaymentAt: now,
          updatedById: user?.id ?? null,
        },
      });

      // Invoice 投影回写（paidAmount += amount；balanceAmount 直接回写 AR 的 newBalance——CTO 阻断项①）
      const invoice = await tx.invoice.findFirst({ where: { id: ar.invoiceId, deletedAt: null } });
      if (invoice) {
        const newInvoicePaid = invoice.paidAmount.plus(amount);
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

      // AR Revision + Snapshot（snapshotSource=PAYMENT）
      const arSnapshotData = {
        accountsReceivableId: arId,
        invoiceId: ar.invoiceId,
        customerId: ar.customerId,
        currency: ar.currency,
        originalAmount: ar.originalAmount.toString(),
        adjustedAmount: ar.adjustedAmount.toString(),
        paidAmount: newPaid.toString(),
        writeOffAmount: ar.writeOffAmount.toString(),
        balanceAmount: newBalance.toString(),
        status: newStatus,
        receiptId: receipt.id,
        allocatedAmount: amount.toString(),
        updatedAt: now.toISOString(),
      };
      await createAccountsReceivableRevision(tx, arId, changeReason ?? "核销收款", arSnapshotData, user?.id);
      const arRevisionNo = await latestAccountsReceivableRevisionNo(tx, arId);
      await createAccountsReceivableSnapshot(
        tx,
        arId,
        newStatus === "PAID" ? "PAID" : newStatus === "CLOSED" ? "CLOSED" : "PARTIALLY_PAID",
        "PAYMENT",
        arRevisionNo,
        arSnapshotData,
        user?.id,
      );
    }

    // Receipt 投影：allocatedAmount += Σ；unallocatedAmount -= Σ；status → PARTIALLY/FULLY_ALLOCATED
    const newAllocated = receipt.allocatedAmount.plus(totalAllocated);
    const newUnallocated = receipt.unallocatedAmount.minus(totalAllocated);
    const newReceiptStatus = newUnallocated.equals(0) ? "FULLY_ALLOCATED" : "PARTIALLY_ALLOCATED";
    await tx.receipt.update({
      where: { id: receipt.id },
      data: {
        allocatedAmount: newAllocated,
        unallocatedAmount: newUnallocated,
        status: newReceiptStatus as never,
        updatedById: user?.id ?? null,
      },
    });

    // Receipt Revision + Snapshot（ALLOCATED）
    const receiptSnapshotData = {
      receiptId: receipt.id,
      code: receipt.code,
      customerId: receipt.customerId,
      currency: receipt.currency,
      amount: receipt.amount.toString(),
      allocatedAmount: newAllocated.toString(),
      unallocatedAmount: newUnallocated.toString(),
      receiptDate: receipt.receiptDate.toISOString(),
      paymentMethod: receipt.paymentMethod,
      status: newReceiptStatus,
      allocations: [...arIdAmount.entries()].map(([arId, amt]) => ({
        accountsReceivableId: arId,
        allocatedAmount: amt.toString(),
      })),
    };
    await createReceiptRevision(tx, receipt.id, changeReason ?? "核销收款", receiptSnapshotData, user?.id);
    const receiptRevisionNo = await latestReceiptRevisionNo(tx, receipt.id);
    await createReceiptSnapshot(tx, receipt.id, "ALLOCATED", receiptRevisionNo, receiptSnapshotData, user?.id);

    return {
      receiptId: receipt.id,
      customerId: receipt.customerId,
      currency: receipt.currency,
      amount: receipt.amount,
      totalAllocated,
      newUnallocated,
      receiptStatus: newReceiptStatus,
      arIds: targetArIds,
    };
  });

  if ("error" in result) {
    switch (result.error) {
      case "RECEIPT_NOT_FOUND":
        return failNotFound(ERROR_CODES.RECEIPT_NOT_FOUND, "收款单不存在");
      case "RECEIPT_VOIDED":
        return failConflict(ERROR_CODES.RECEIPT_VOID_FORBIDDEN, `已作废收款单不可核销（status=${result.status}）`);
      case "AR_NOT_FOUND":
        return failNotFound(ERROR_CODES.ACCOUNTS_RECEIVABLE_NOT_FOUND, `应收记录不存在（${result.arId}）`);
      case "CUSTOMER_MISMATCH":
        return failConflict(
          ERROR_CODES.RECEIPT_CUSTOMER_MISMATCH,
          `收款单与应收客户不一致（receipt=${result.receiptCustomerId}，AR=${result.arCustomerId}）——不允许跨客户核销`,
        );
      case "CURRENCY_MISMATCH":
        return failConflict(
          ERROR_CODES.RECEIPT_CURRENCY_MISMATCH,
          `收款单与应收币种不一致（receipt=${result.receiptCurrency}，AR=${result.arCurrency}）——第一版禁止跨币种核销`,
        );
      case "UNALLOCATED_EXCEEDED":
        return failConflict(
          ERROR_CODES.RECEIPT_UNALLOCATED_EXCEEDED,
          `核销金额超过收款单未分配余额（请求 ${result.requested}，unallocatedAmount ${result.unallocatedAmount}）`,
        );
      case "ALLOCATION_EXCEEDED":
        return failConflict(
          ERROR_CODES.RECEIPT_ALLOCATION_EXCEEDED,
          `核销金额超过应收余额（AR ${result.arId} 请求 ${result.requested}，balanceAmount ${result.balanceAmount}）——禁止超核销`,
        );
      default:
        return fail(ERROR_CODES.INTERNAL_ERROR, "核销失败：未知错误", 500);
    }
  }

  // ── 11. 事件 + 审计（事务外，事件失败不阻断——与现有模式一致） ────────────
  try {
    await publishReceiptEvent({
      eventType: result.receiptStatus === "FULLY_ALLOCATED" ? "ReceiptFullyAllocated" : "ReceiptAllocated",
      actorId: user?.id,
      entityId: result.receiptId,
      payload: {
        receiptId: result.receiptId,
        customerId: result.customerId,
        currency: result.currency,
        amount: result.amount,
        allocatedAmount: result.totalAllocated.toString(),
        unallocatedAmount: result.newUnallocated.toString(),
        receiptStatus: result.receiptStatus,
        arIds: result.arIds,
      },
      meta,
    });
    await writeAuditLog({
      actorId: user?.id,
      action: "receipt.allocate",
      entityType: "receipt",
      entityId: result.receiptId,
      afterData: {
        allocatedAmount: result.totalAllocated.toString(),
        unallocatedAmount: result.newUnallocated.toString(),
        receiptStatus: result.receiptStatus,
        arIds: result.arIds,
      },
      ...meta,
    });
  } catch {
    // 事件/审计失败不阻断主流程
  }

  return ok(
    {
      receiptId: result.receiptId,
      allocatedAmount: result.totalAllocated,
      unallocatedAmount: result.newUnallocated,
      receiptStatus: result.receiptStatus,
      arIds: result.arIds,
    },
    undefined,
    201,
  );
}
