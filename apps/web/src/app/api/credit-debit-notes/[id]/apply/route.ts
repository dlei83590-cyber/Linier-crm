import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound, fail } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { creditDebitNoteApplySchema } from "@/lib/api/schemas";
import { createAccountsReceivableRevision, createAccountsReceivableSnapshot, latestAccountsReceivableRevisionNo } from "@/lib/accounts-receivable/helpers";
import { computeBalance, computeArStatus } from "@/lib/accounts-receivable/projection";
import { publishCreditDebitNoteEvent } from "@/lib/credit-debit-note/events";
import { writeDomainEvent } from "@/lib/domain-events/writer";

export const dynamic = "force-dynamic";

type ApplyResult =
  | { error: "CN_DN_NOT_FOUND" }
  | { error: "ALREADY_APPLIED"; appliedAt: string | null }
  | { error: "INVALID_STATE"; status: string }
  | { error: "APPROVAL_REQUIRED"; approvalStatus: string }
  | { error: "SOURCE_NOT_COMPATIBLE"; reason: string }
  | { error: "QUANTITY_EXCEEDED"; lineId: string; requested: string; remaining: string }
  | { error: "AMOUNT_EXCEEDED"; lineId: string; requested: string; ceiling: string }
  | {
      applied: {
        note: {
          id: string;
          code: string;
          status: string;
          appliedAt: Date;
          noteType: "CREDIT" | "DEBIT";
          sourceInvoiceId: string;
          customerId: string;
          currency: string;
          reason: string;
        };
        arIds: string[];
        signedAdjustmentTotal: Prisma.Decimal;
        newBalance: Prisma.Decimal;
        newStatus: string;
        factCount: number;
        appliedAt: Date;
      };
    };

/**
 * POST /api/credit-debit-notes/:id/apply —— **唯一修改 AR.adjustedAmount / balanceAmount 的入口**（CTO 98/100 锁死）
 * **APPROVED ≠ APPLIED**：审批通过只是投影；Apply 才产生财务事实。
 *
 * 事务（CTO 98/100 锁定顺序，任何一步失败整体回滚）：
 *  1. Lock CreditDebitNote（FOR UPDATE）
 *  2. 状态门禁：APPLIED → 409 CN_DN_ALREADY_APPLIED（幂等稳定 409）；
 *     非 SUBMITTED → 409 CN_DN_INVALID_STATE；命中审批但未 APPROVED → 409 CN_DN_APPROVAL_REQUIRED
 *  3. Lock source Invoice（FOR UPDATE）
 *  4. Lock source InvoiceLines（按 id ASC，FOR UPDATE——防死锁锁序）
 *  5. Lock AccountsReceivable（按 id ASC，FOR UPDATE）
 *  6. 校验 customerId / currency 与 AR 一致（409 CN_DN_SOURCE_NOT_COMPATIBLE）
 *  7. **累计 CN/DN 防超调（锁内重算，CTO 98/100 最重要补充）**：
 *     - CREDIT：remainingAdjustableQty = invoiceLine.quantity - Σ(已 APPLIED 且未 reversed 的 CREDIT quantity)，
 *       newCreditQty ≤ remainingAdjustableQty（否则 409 CN_DN_QUANTITY_EXCEEDED）
 *     - 金额：累计已 APPLIED 未 reversed 调整金额（绝对值）+ 本次 ≤ 原行金额（ceiling，否则 409 CN_DN_AMOUNT_EXCEEDED）；
 *       DN 第一版禁止超原行金额（行级 ceiling = 原行金额）
 *  8. Create InvoiceAdjustment facts（**signed adjustmentAmount：CN<0 / DN>0**；部分行按数量比例折算快照金额，不重算、不调 Pricing Engine）
 *  9. AR.adjustedAmount += Σ signed adjustmentAmount（服务端聚合）
 *  10. AR.balanceAmount = computeBalance(...)（单入口）
 *  11. AR status = computeArStatus(...)（统一口径）；**负 AR 不新增数据库状态**（只做读取投影，不加 CREDIT）
 *  12. Invoice.balanceAmount = AR newBalance（**Invoice 金额事实不动**：invoiceTotal/行快照/InvoiceSnapshot 一律不改）
 *  13. AR Revision + Snapshot（snapshotSource=ADJUSTMENT / snapshotType=ADJUSTED）
 *  14. CreditDebitNote = APPLIED + appliedAt/appliedById
 *  15. Audit / Events（事务外：InvoiceAdjustmentApplied + AccountsReceivableAdjusted 同时发布，
 *      失败降级不阻断；**DB 事实更新不因事件失败回滚**）
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "credit-debit-note:approve");
  if (denied) return denied;
  requestLog(request, user?.id, "credit-debit-note.apply");

  const { id: noteId } = await params;
  const parsed = creditDebitNoteApplySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { changeReason } = parsed.data;
  const meta = requestMeta(request);

  let result: ApplyResult;
  try {
    result = await prisma.$transaction(async (tx) => {
      // ── 1. Lock CreditDebitNote（FOR UPDATE） ────────────────────────────────
      const lockedNote = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "CreditDebitNote" WHERE "id" = ${noteId} AND "deletedAt" IS NULL FOR UPDATE`,
      );
      if (lockedNote.length === 0) return { error: "CN_DN_NOT_FOUND" as const };
      const note = await tx.creditDebitNote.findFirst({
        where: { id: noteId, deletedAt: null },
        include: { lines: { where: { deletedAt: null }, orderBy: { lineNo: "asc" } } },
      });
      if (!note) return { error: "CN_DN_NOT_FOUND" as const };

      // ── 2. 状态门禁（幂等 409 / 状态 / 审批） ────────────────────────────────
      if (note.status === "APPLIED") {
        return { error: "ALREADY_APPLIED" as const, appliedAt: note.appliedAt?.toISOString() ?? null };
      }
      if (note.status !== "SUBMITTED") {
        return { error: "INVALID_STATE" as const, status: note.status };
      }
      if (note.workflowInstanceId !== null && note.approvalStatus !== "APPROVED") {
        return { error: "APPROVAL_REQUIRED" as const, approvalStatus: note.approvalStatus };
      }

      // ── 3. Lock source Invoice（FOR UPDATE） ─────────────────────────────────
      const lockedInvoice = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "Invoice" WHERE "id" = ${note.sourceInvoiceId} AND "deletedAt" IS NULL FOR UPDATE`,
      );
      if (lockedInvoice.length === 0) return { error: "SOURCE_NOT_COMPATIBLE" as const, reason: "invoice-not-found" };
      const invoice = await tx.invoice.findFirst({ where: { id: note.sourceInvoiceId, deletedAt: null } });
      if (!invoice) return { error: "SOURCE_NOT_COMPATIBLE" as const, reason: "invoice-not-found" };

      // ── 4. Lock source InvoiceLines（id ASC，FOR UPDATE——防死锁锁序） ───────
      const sourceLineIds = [...new Set(note.lines.map((l) => l.sourceInvoiceLineId))].sort();
      const invoiceLineMap = new Map<string, { id: string; quantity: Prisma.Decimal; totalAmount: Prisma.Decimal }>();
      for (const lineId of sourceLineIds) {
        const lockedLine = await tx.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`SELECT "id" FROM "InvoiceLine" WHERE "id" = ${lineId} AND "deletedAt" IS NULL FOR UPDATE`,
        );
        if (lockedLine.length === 0) return { error: "SOURCE_NOT_COMPATIBLE" as const, reason: `line-not-found:${lineId}` };
        const il = await tx.invoiceLine.findFirst({
          where: { id: lineId, deletedAt: null },
          select: { id: true, quantity: true, totalAmount: true },
        });
        if (!il) return { error: "SOURCE_NOT_COMPATIBLE" as const, reason: `line-not-found:${lineId}` };
        invoiceLineMap.set(lineId, il);
      }

      // ── 5. Lock AccountsReceivable（id ASC，FOR UPDATE） ────────────────────
      const ar = await tx.accountsReceivable.findFirst({ where: { invoiceId: note.sourceInvoiceId, deletedAt: null } });
      if (!ar) return { error: "SOURCE_NOT_COMPATIBLE" as const, reason: "ar-not-found" };
      const lockedAr = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "AccountsReceivable" WHERE "id" = ${ar.id} AND "deletedAt" IS NULL FOR UPDATE`,
      );
      if (lockedAr.length === 0) return { error: "SOURCE_NOT_COMPATIBLE" as const, reason: "ar-not-found" };

      // ── 6. 校验 customerId / currency 与 AR 一致（硬规则，CTO 追加） ─────────
      if (note.customerId !== ar.customerId) {
        return { error: "SOURCE_NOT_COMPATIBLE" as const, reason: `customer-mismatch` };
      }
      if (note.currency !== ar.currency) {
        return { error: "SOURCE_NOT_COMPATIBLE" as const, reason: `currency-mismatch` };
      }

      // ── 7. 累计 CN/DN 防超调（锁内重算；CTO 98/100 最重要补充） ──────────────
      // 按 sourceInvoiceLineId 聚合所有已 APPLIED、未 reversed 的 InvoiceAdjustment
      const lineIds = note.lines.map((l) => l.sourceInvoiceLineId);
      const existingAdjustments = await tx.invoiceAdjustment.findMany({
        where: {
          invoiceId: note.sourceInvoiceId,
          invoiceLineId: { in: lineIds },
          appliedAt: { not: null },
          reversedAt: null,
          deletedAt: null,
        },
        select: { invoiceLineId: true, adjustmentType: true, quantity: true, adjustmentAmount: true },
      });

      const signedFacts: Array<{
        sourceNoteLineId: string;
        invoiceLineId: string;
        quantity: Prisma.Decimal;
        adjustmentAmount: Prisma.Decimal; // signed：CN<0 / DN>0
      }> = [];

      for (const line of note.lines) {
        const srcLine = invoiceLineMap.get(line.sourceInvoiceLineId)!;
        // 累计已 APPLIED 且未 reversed 的 CREDIT 数量（同一 invoiceLineId）
        const cumulativeCreditQty = existingAdjustments
          .filter((a) => a.invoiceLineId === line.sourceInvoiceLineId && a.adjustmentType === "CREDIT")
          .reduce((acc, a) => acc.plus(new Prisma.Decimal(a.quantity)), new Prisma.Decimal(0));
        const remainingAdjustableQty = new Prisma.Decimal(srcLine.quantity).minus(cumulativeCreditQty);

        // 部分行按数量比例折算金额快照（不重算、不调 Pricing Engine）
        const ratio = new Prisma.Decimal(line.quantity).div(new Prisma.Decimal(srcLine.quantity));
        const lineTotal = new Prisma.Decimal(srcLine.totalAmount).mul(ratio);
        // signed：CN<0 / DN>0（CTO 98/100 全系统唯一符号口径）
        const signedAmount = note.noteType === "CREDIT" ? lineTotal.negated() : lineTotal;

        if (note.noteType === "CREDIT") {
          // 数量防超调
          if (line.quantity.greaterThan(remainingAdjustableQty)) {
            return {
              error: "QUANTITY_EXCEEDED" as const,
              lineId: line.sourceInvoiceLineId,
              requested: line.quantity.toString(),
              remaining: remainingAdjustableQty.toString(),
            };
          }
        }

        // 金额 ceiling：**按同类型聚合**（CTO 98/100：累计 CREDIT 只对 CREDIT、累计 DEBIT 只对 DEBIT）
        // CREDIT：累计已 APPLIED 未 reversed CREDIT 金额（abs）+ 本次 ≤ 原行金额；
        // DEBIT：累计已 APPLIED 未 reversed DEBIT 金额 + 本次 ≤ 原行金额（行级 ceiling=原行金额，第一版禁止 DN 超原票）
        const cumulativeSameTypeAmount = existingAdjustments
          .filter(
            (a) =>
              a.invoiceLineId === line.sourceInvoiceLineId && a.adjustmentType === note.noteType,
          )
          .reduce((acc, a) => acc.plus(new Prisma.Decimal(a.adjustmentAmount).abs()), new Prisma.Decimal(0));
        const ceiling = new Prisma.Decimal(srcLine.totalAmount);
        if (cumulativeSameTypeAmount.plus(lineTotal).greaterThan(ceiling)) {
          return {
            error: "AMOUNT_EXCEEDED" as const,
            lineId: line.sourceInvoiceLineId,
            requested: cumulativeSameTypeAmount.plus(lineTotal).toString(),
            ceiling: ceiling.toString(),
          };
        }

        signedFacts.push({
          sourceNoteLineId: line.id,
          invoiceLineId: line.sourceInvoiceLineId,
          quantity: line.quantity,
          adjustmentAmount: signedAmount,
        });
      }

      // ── 8. Create InvoiceAdjustment facts（signed；Append-only，不覆盖） ──────
      const now = new Date();
      for (const fact of signedFacts) {
        await tx.invoiceAdjustment.create({
          data: {
            sourceNoteId: note.id,
            sourceNoteLineId: fact.sourceNoteLineId,
            invoiceId: note.sourceInvoiceId,
            invoiceLineId: fact.invoiceLineId,
            accountsReceivableId: ar.id,
            customerId: note.customerId,
            currency: note.currency,
            adjustmentType: note.noteType,
            quantity: fact.quantity,
            adjustmentAmount: fact.adjustmentAmount, // signed：CN<0 / DN>0
            appliedAt: now,
            appliedById: user?.id ?? null,
            createdById: user?.id ?? null,
            updatedById: user?.id ?? null,
          },
        });
      }

      // ── 9. AR.adjustedAmount += Σ signed adjustmentAmount（服务端聚合） ───────
      const signedTotal = signedFacts.reduce(
        (acc, f) => acc.plus(f.adjustmentAmount),
        new Prisma.Decimal(0),
      );
      const newAdjusted = new Prisma.Decimal(ar.adjustedAmount).plus(signedTotal);

      // ── 10. AR.balanceAmount = computeBalance(...)（单入口） ─────────────────
      const newBalance = new Prisma.Decimal(
        computeBalance(ar.originalAmount, newAdjusted, ar.paidAmount, ar.writeOffAmount),
      );

      // ── 11. AR status = computeArStatus(...)（统一口径）；负 AR 不加 CREDIT 状态 ──
      const newStatus = computeArStatus(newBalance, ar.paidAmount, ar.writeOffAmount);

      await tx.accountsReceivable.update({
        where: { id: ar.id },
        data: {
          adjustedAmount: newAdjusted,
          balanceAmount: newBalance,
          ...(newStatus !== ar.status ? { status: newStatus as never } : {}),
          updatedById: user?.id ?? null,
        },
      });

      // ── 12. Invoice.balanceAmount = AR newBalance（金额事实不动） ──────────────
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          // Invoice.balanceAmount = Projection：直接使用 AR 计算出的 newBalance（computeBalance 单入口）
          // **不修改 invoiceTotal / 行快照 / InvoiceSnapshot**（CTO 锁死：Invoice 金额事实不可变）
          balanceAmount: newBalance,
          updatedById: user?.id ?? null,
        },
      });

      // ── 13. AR Revision + Snapshot（ADJUSTMENT / ADJUSTED） ──────────────────
      const arSnapshotData = {
        accountsReceivableId: ar.id,
        invoiceId: ar.invoiceId,
        originalAmount: ar.originalAmount.toString(),
        adjustedAmount: newAdjusted.toString(),
        paidAmount: ar.paidAmount.toString(),
        writeOffAmount: ar.writeOffAmount.toString(),
        balanceAmount: newBalance.toString(),
        status: newStatus,
        noteId: note.id,
        noteCode: note.code,
        noteType: note.noteType,
        adjustmentAmount: signedTotal.toString(),
        factCount: signedFacts.length,
        changeReason: changeReason ?? null,
        appliedAt: now.toISOString(),
      };
      await createAccountsReceivableRevision(tx, ar.id, `CN/DN 调整：${changeReason ?? note.reason}`, arSnapshotData, user?.id);
      const arRevisionNo = await latestAccountsReceivableRevisionNo(tx, ar.id);
      await createAccountsReceivableSnapshot(tx, ar.id, "ADJUSTED", "ADJUSTMENT", arRevisionNo, arSnapshotData, user?.id);

      // ── 14. CreditDebitNote = APPLIED + appliedAt/appliedById ────────────────
      const applied = await tx.creditDebitNote.update({
        where: { id: note.id },
        data: {
          status: "APPLIED",
          appliedAt: now,
          appliedById: user?.id ?? null,
          updatedById: user?.id ?? null,
        },
      });

      // ── 14b. 事务内原子写 Outbox（GL consumer → 销售贷/借项应收调整凭证，关联总财务） ──
      //     与收款核销（ReceiptAllocated）同一总账域：核销按 AR 调整后余额进行，CN/DN 调整先落总账
      await writeDomainEvent(tx, {
        eventType: "InvoiceAdjustmentApplied",
        aggregateType: "CreditDebitNote",
        aggregateId: note.id,
        payload: {
          noteId: note.id,
          noteCode: applied.code,
          noteType: applied.noteType,
          sourceInvoiceId: applied.sourceInvoiceId,
          customerId: applied.customerId,
          currency: applied.currency,
          adjustmentTotal: signedTotal.toString(),
          appliedAt: now.toISOString(),
          appliedById: user?.id ?? null,
        },
        idempotencyKey: "InvoiceAdjustmentApplied|" + note.id,
      });

      return {
        applied: {
          note: {
            id: applied.id,
            code: applied.code,
            status: applied.status,
            appliedAt: now,
            noteType: applied.noteType,
            sourceInvoiceId: applied.sourceInvoiceId,
            customerId: applied.customerId,
            currency: applied.currency,
            reason: applied.reason,
          },
          arIds: [ar.id],
          signedAdjustmentTotal: signedTotal,
          newBalance,
          newStatus,
          factCount: signedFacts.length,
          appliedAt: now,
        },
      };
    });
  } catch (e) {
    throw e;
  }

  if ("error" in result) {
    switch (result.error) {
      case "CN_DN_NOT_FOUND":
        return failNotFound(ERROR_CODES.CN_DN_NOT_FOUND, "CreditDebitNote 不存在");
      case "ALREADY_APPLIED":
        return failConflict(
          ERROR_CODES.CN_DN_ALREADY_APPLIED,
          `CreditDebitNote 已 APPLIED（${result.appliedAt ?? "已生效"}），不可重复 Apply`,
        );
      case "INVALID_STATE":
        return failConflict(
          ERROR_CODES.CN_DN_INVALID_STATE,
          `仅 SUBMITTED 状态可 Apply（当前 status=${result.status}）`,
        );
      case "APPROVAL_REQUIRED":
        return failConflict(
          ERROR_CODES.CN_DN_APPROVAL_REQUIRED,
          `CreditDebitNote 命中审批策略，需 APPROVED 后才能 Apply（当前 approvalStatus=${result.approvalStatus}）——APPROVED ≠ APPLIED`,
        );
      case "SOURCE_NOT_COMPATIBLE":
        return failConflict(
          ERROR_CODES.CN_DN_SOURCE_NOT_COMPATIBLE,
          `源 Invoice/AR 校验失败（${result.reason}）`,
        );
      case "QUANTITY_EXCEEDED":
        return failConflict(
          ERROR_CODES.CN_DN_QUANTITY_EXCEEDED,
          `调整数量超出剩余可调整数量（行 ${result.lineId}：requested=${result.requested}，remaining=${result.remaining}）`,
        );
      case "AMOUNT_EXCEEDED":
        return failConflict(
          ERROR_CODES.CN_DN_AMOUNT_EXCEEDED,
          `调整金额超出原行金额上限（行 ${result.lineId}：requested=${result.requested}，ceiling=${result.ceiling}）`,
        );
      default:
        return fail(ERROR_CODES.INTERNAL_ERROR, "Apply 失败：未知错误", 500);
    }
  }

  // ── 15. 事件 + 审计（事务外；DB 事实更新已在事务内提交，事件失败降级不阻断） ──
  try {
    await publishCreditDebitNoteEvent({
      eventType: "InvoiceAdjustmentApplied",
      actorId: user?.id,
      entityId: noteId,
      payload: {
        noteId,
        noteCode: result.applied.note.code,
        noteType: result.applied.note.noteType ?? null,
        sourceInvoiceId: result.applied.note.sourceInvoiceId ?? "",
        customerId: result.applied.note.customerId ?? "",
        currency: result.applied.note.currency ?? "",
        adjustmentTotal: result.applied.signedAdjustmentTotal,
        reason: result.applied.note.reason ?? null,
        appliedAt: result.applied.appliedAt.toISOString(),
        arIds: result.applied.arIds,
        newBalance: result.applied.newBalance.toString(),
        newStatus: result.applied.newStatus,
        factCount: result.applied.factCount,
      },
      meta,
    });
    // AR 领域事件（AccountsReceivableAdjusted）
    await writeAuditLog({
      actorId: user?.id,
      action: "AccountsReceivableAdjusted",
      entityType: "accounts-receivable",
      entityId: result.applied.arIds[0] ?? noteId,
      afterData: {
        noteId,
        noteCode: result.applied.note.code,
        signedAdjustmentTotal: result.applied.signedAdjustmentTotal.toString(),
        newBalance: result.applied.newBalance.toString(),
        newStatus: result.applied.newStatus,
        arIds: result.applied.arIds,
      },
      ...meta,
    });
    await writeAuditLog({
      actorId: user?.id,
      action: "credit-debit-note.apply",
      entityType: "credit-debit-note",
      entityId: noteId,
      afterData: {
        status: "APPLIED",
        appliedAt: result.applied.appliedAt.toISOString(),
        arIds: result.applied.arIds,
        signedAdjustmentTotal: result.applied.signedAdjustmentTotal.toString(),
        newBalance: result.applied.newBalance.toString(),
        newStatus: result.applied.newStatus,
        factCount: result.applied.factCount,
      },
      ...meta,
    });
  } catch {
    // 事件/审计失败不阻断主流程（DB 事实已提交）
  }

  return ok(
    {
      creditDebitNoteId: noteId,
      status: "APPLIED",
      appliedAt: result.applied.appliedAt,
      arIds: result.applied.arIds,
      signedAdjustmentTotal: result.applied.signedAdjustmentTotal,
      newBalance: result.applied.newBalance,
      newStatus: result.applied.newStatus,
      factCount: result.applied.factCount,
    },
    undefined,
    201,
  );
}
