import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound, failServer } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { computeBalance } from "@/lib/accounts-receivable/projection";
import { createAccountsReceivableRevision, createAccountsReceivableSnapshot, latestAccountsReceivableRevisionNo } from "@/lib/accounts-receivable/helpers";
import { writeDomainEvent } from "@/lib/domain-events/writer";
import { z } from "zod";

export const dynamic = "force-dynamic";

const reverseSchema = z.object({
  changeReason: z.string().max(500).optional(),
});

/**
 * POST /api/credit-debit-notes/:id/reverse —— APPLIED → REVERSED（反冲减：撤销已生效的 CN/DN 调整）
 * - 仅 APPLIED 可反冲（幂等：已 REVERSED → 409）
 * - 同事务：标记 InvoiceAdjustment.reversedAt（预留字段启用）→ 回退 AR.adjustedAmount（-= signedTotal）→
 *   balanceAmount（computeBalance 单入口）→ Invoice.balanceAmount 同步 → AR Revision/Snapshot →
 *   事务内 Outbox（InvoiceAdjustmentReversed，GL 反向凭证）
 * - 不修改原 Invoice 金额事实（CTO 锁死）
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "credit-debit-note:approve"); // 反冲 = 撤销已生效财务事实（与 apply 同级权限）
  if (denied) return denied;
  requestLog(request, user?.id, "credit-debit-note.reverse");

  const { id } = await params;
  const parsed = reverseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const meta = requestMeta(request);
  const actorId = user!.id;

  try {
    const reversed = await prisma.$transaction(async (tx) => {
      const note = await tx.creditDebitNote.findFirst({
        where: { id, deletedAt: null },
        include: { adjustments: { where: { deletedAt: null, reversedAt: null } } },
      });
      if (!note) throw new Error("NOT_FOUND");
      if (note.status !== "APPLIED") {
        throw note.status === "REVERSED" ? new Error("ALREADY_REVERSED") : new Error("INVALID_STATE");
      }
      if (note.adjustments.length === 0) throw new Error("ALREADY_REVERSED");

      // 回退总额（signed：CN<0 / DN>0，与 Apply 一致）
      const signedTotal = note.adjustments.reduce(
        (acc, a) => acc.plus(new Prisma.Decimal(a.adjustmentAmount)),
        new Prisma.Decimal(0),
      );

      const ar = await tx.accountsReceivable.findFirst({
        where: { invoiceId: note.sourceInvoiceId, deletedAt: null },
      });
      if (!ar) throw new Error("AR_NOT_FOUND");

      const newAdjusted = new Prisma.Decimal(ar.adjustedAmount).minus(signedTotal);
      const newBalance = new Prisma.Decimal(
        computeBalance(ar.originalAmount, newAdjusted, ar.paidAmount, ar.writeOffAmount),
      );
      await tx.accountsReceivable.update({
        where: { id: ar.id },
        data: { adjustedAmount: newAdjusted, balanceAmount: newBalance, updatedById: actorId },
      });

      await tx.invoice.update({
        where: { id: note.sourceInvoiceId },
        data: { balanceAmount: newBalance, updatedById: actorId },
      });

      await tx.invoiceAdjustment.updateMany({
        where: { sourceNoteId: id, reversedAt: null, deletedAt: null },
        data: { reversedAt: new Date(), reversedById: actorId },
      });

      const updated = await tx.creditDebitNote.update({
        where: { id },
        data: { status: "REVERSED", updatedById: actorId },
      });

      const snapshotData = {
        accountsReceivableId: ar.id,
        invoiceId: ar.invoiceId,
        noteId: id,
        noteCode: note.code,
        noteType: note.noteType,
        reversedAdjustment: signedTotal.toString(),
        adjustedAmount: newAdjusted.toString(),
        balanceAmount: newBalance.toString(),
        changeReason: parsed.data.changeReason ?? null,
        reversedAt: new Date().toISOString(),
      };
      await createAccountsReceivableRevision(tx, ar.id, "CN/DN 反冲：" + (parsed.data.changeReason ?? note.reason), snapshotData, actorId);
      const arRevisionNo = await latestAccountsReceivableRevisionNo(tx, ar.id);
      await createAccountsReceivableSnapshot(tx, ar.id, "ADJUSTED", "ADJUSTMENT", arRevisionNo, snapshotData, actorId);

      await writeDomainEvent(tx, {
        eventType: "InvoiceAdjustmentReversed",
        aggregateType: "CreditDebitNote",
        aggregateId: id,
        payload: {
          noteId: id,
          noteCode: note.code,
          noteType: note.noteType,
          sourceInvoiceId: note.sourceInvoiceId,
          customerId: note.customerId,
          currency: note.currency,
          adjustmentTotal: signedTotal.toString(),
          reversedAt: new Date().toISOString(),
          reversedById: actorId,
        },
        idempotencyKey: "InvoiceAdjustmentReversed|" + id,
      });

      return updated;
    });

    await writeAuditLog({
      actorId,
      action: "credit-debit-note.reverse",
      entityType: "creditDebitNote",
      entityId: id,
      afterData: { code: reversed.code, status: reversed.status, noteType: reversed.noteType },
      ...meta,
    });
    return ok({ id, status: reversed.status, noteType: reversed.noteType });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_FOUND") return failNotFound(ERROR_CODES.NOT_FOUND, "贷/借项通知单不存在");
    if (msg === "ALREADY_REVERSED") return failConflict(ERROR_CODES.CONFLICT, "已反冲，禁止重复反冲");
    if (msg === "INVALID_STATE") return failConflict(ERROR_CODES.CN_DN_INVALID_STATE, "仅 APPLIED 状态可反冲（未生效不可反冲）");
    if (msg === "AR_NOT_FOUND") return failConflict(ERROR_CODES.CN_DN_SOURCE_NOT_COMPATIBLE, "关联应收不存在");
    console.error("[credit-debit-note.reverse]", e);
    return failServer("反冲减失败");
  }
}
