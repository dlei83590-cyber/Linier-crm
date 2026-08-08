import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound, fail } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { writeOffApplySchema } from "@/lib/api/schemas";
import { createAccountsReceivableRevision, createAccountsReceivableSnapshot, latestAccountsReceivableRevisionNo } from "@/lib/accounts-receivable/helpers";
import { computeBalance } from "@/lib/accounts-receivable/projection";
import { publishWriteOffEvent } from "@/lib/write-off/events";

export const dynamic = "force-dynamic";

/**
 * POST /api/write-offs/:id/apply —— **唯一修改 AR.writeOffAmount / balanceAmount 的入口**（CTO 锁死）
 * **APPROVED ≠ APPLIED**：审批通过只是投影；Apply 才产生财务事实。
 *
 * 事务（CTO 指令，任何一步失败整体回滚）：
 *  1. Lock WriteOff（FOR UPDATE）
 *  2. 状态门禁：APPLIED → 409 WRITE_OFF_ALREADY_APPLIED（重复 Apply 稳定 409）；
 *     非 SUBMITTED → 409 WRITE_OFF_INVALID_STATE；命中审批但未 APPROVED → 409 WRITE_OFF_APPROVAL_REQUIRED
 *  3. Lock 全部目标 AR（按 id ASC，FOR UPDATE——对齐 Allocation 锁序）
 *  4. 校验每笔 allocationAmount ≤ AR.balanceAmount（锁内读）→ 409 WRITE_OFF_AMOUNT_EXCEEDED
 *  5. 同事务回写（**财务边界：WriteOff 不是 Payment**）：
 *     - AR.writeOffAmount += allocation（增加）
 *     - AR.balanceAmount = computeBalance(...)（减少）
 *     - Invoice 投影：balanceAmount 同步减少；**paidAmount 绝不因 write-off 增加**（否则报表误判坏账为客户付款）
 *     - AR Revision + AR Snapshot(WRITE_OFF)
 *  6. WriteOff.status = APPLIED + appliedAt/appliedById
 *  7. 事件（WriteOffApplied + AccountsReceivableWrittenOff，AuditLog 留痕）——DB 事实更新不 catch，仅事件降级
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "write-off:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "write-off.apply");

  const { id: writeOffId } = await params;
  const parsed = writeOffApplySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { changeReason } = parsed.data;
  const meta = requestMeta(request);

  const result = await prisma.$transaction(async (tx) => {
    // ── 1. Lock WriteOff（FOR UPDATE） ────────────────────────────────────────
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "WriteOff" WHERE "id" = ${writeOffId} AND "deletedAt" IS NULL FOR UPDATE`,
    );
    if (locked.length === 0) return { error: "WRITE_OFF_NOT_FOUND" as const };
    const writeOff = await tx.writeOff.findFirst({
      where: { id: writeOffId, deletedAt: null },
      include: { allocations: { where: { deletedAt: null } } },
    });
    if (!writeOff) return { error: "WRITE_OFF_NOT_FOUND" as const };

    // ── 2. 状态门禁（重复 Apply 幂等 409 / 状态 / 审批） ──────────────────────
    if (writeOff.status === "APPLIED") {
      return { error: "ALREADY_APPLIED" as const, appliedAt: writeOff.appliedAt?.toISOString() ?? null };
    }
    if (writeOff.status !== "SUBMITTED") {
      return { error: "INVALID_STATE" as const, status: writeOff.status };
    }
    if (writeOff.workflowInstanceId !== null && writeOff.approvalStatus !== "APPROVED") {
      return { error: "APPROVAL_REQUIRED" as const, approvalStatus: writeOff.approvalStatus };
    }

    // ── 3. Lock 全部目标 AR（按 id ASC，FOR UPDATE——对齐 Allocation 锁序） ────
    const allocationIds = [...new Set(writeOff.allocations.map((a) => a.accountsReceivableId))].sort();
    const arMap = new Map<
      string,
      {
        id: string;
        invoiceId: string;
        originalAmount: Prisma.Decimal;
        adjustedAmount: Prisma.Decimal;
        paidAmount: Prisma.Decimal;
        writeOffAmount: Prisma.Decimal;
        balanceAmount: Prisma.Decimal;
        status: string;
      }
    >();
    for (const arId of allocationIds) {
      const lockedAr = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "AccountsReceivable" WHERE "id" = ${arId} AND "deletedAt" IS NULL FOR UPDATE`,
      );
      if (lockedAr.length === 0) return { error: "AR_NOT_FOUND" as const, arId };
      const ar = await tx.accountsReceivable.findFirst({ where: { id: arId, deletedAt: null } });
      if (!ar) return { error: "AR_NOT_FOUND" as const, arId };
      arMap.set(arId, ar as never);
    }

    // ── 4. 校验每笔 allocationAmount ≤ AR.balanceAmount（锁内读，防超核销） ────
    for (const alloc of writeOff.allocations) {
      const ar = arMap.get(alloc.accountsReceivableId)!;
      if (alloc.amount.greaterThan(ar.balanceAmount)) {
        return {
          error: "AMOUNT_EXCEEDED" as const,
          arId: alloc.accountsReceivableId,
          requested: alloc.amount.toString(),
          balanceAmount: ar.balanceAmount.toString(),
        };
      }
    }

    // ── 5. 同事务回写（财务边界：WriteOff ≠ Payment） ────────────────────────
    const now = new Date();
    for (const alloc of writeOff.allocations) {
      const ar = arMap.get(alloc.accountsReceivableId)!;
      // AR.writeOffAmount 增加；AR.balanceAmount 减少（computeBalance 单入口）
      const newWriteOff = ar.writeOffAmount.plus(alloc.amount);
      const newBalance = new Prisma.Decimal(
        computeBalance(ar.originalAmount, ar.adjustedAmount, ar.paidAmount, newWriteOff),
      );
      // 状态投影：write-off 完结（余额=0）→ CLOSED；否则保持（write-off 不改变付款状态）
      const newStatus = newBalance.equals(0) ? "CLOSED" : ar.status;

      await tx.accountsReceivable.update({
        where: { id: ar.id },
        data: {
          writeOffAmount: newWriteOff,
          balanceAmount: newBalance,
          ...(newStatus !== ar.status ? { status: newStatus as never } : {}),
          updatedById: user?.id ?? null,
        },
      });

      // Invoice 投影：balanceAmount 同步减少；**paidAmount 绝不因 write-off 增加**
      const invoice = await tx.invoice.findFirst({ where: { id: ar.invoiceId, deletedAt: null } });
      if (invoice) {
        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            // 现有口径：Invoice.balanceAmount = invoiceTotal - paidAmount - writeOffAmount（投影同步减少）
            // paidAmount 保持不变——write-off 不是 Payment，不能把坏账核销算作客户实际付款
            balanceAmount: invoice.invoiceTotal.minus(invoice.paidAmount).minus(newWriteOff),
            updatedById: user?.id ?? null,
          },
        });
      }

      // AR Revision + Snapshot(WRITE_OFF)
      const arSnapshotData = {
        accountsReceivableId: ar.id,
        invoiceId: ar.invoiceId,
        originalAmount: ar.originalAmount.toString(),
        adjustedAmount: ar.adjustedAmount.toString(),
        paidAmount: ar.paidAmount.toString(),
        writeOffAmount: newWriteOff.toString(),
        balanceAmount: newBalance.toString(),
        status: newStatus,
        writeOffId: writeOff.id,
        writeOffCode: writeOff.code,
        allocatedAmount: alloc.amount.toString(),
        changeReason: changeReason ?? null,
        appliedAt: now.toISOString(),
      };
      await createAccountsReceivableRevision(tx, ar.id, `WriteOff 核销：${changeReason ?? writeOff.reason}`, arSnapshotData, user?.id);
      const arRevisionNo = await latestAccountsReceivableRevisionNo(tx, ar.id);
      await createAccountsReceivableSnapshot(
        tx,
        ar.id,
        "WRITTEN_OFF",
        "WRITE_OFF",
        arRevisionNo,
        arSnapshotData,
        user?.id,
      );
    }

    // ── 6. WriteOff.status = APPLIED + appliedAt/appliedById ─────────────────
    const applied = await tx.writeOff.update({
      where: { id: writeOff.id },
      data: {
        status: "APPLIED",
        appliedAt: now,
        appliedById: user?.id ?? null,
        updatedById: user?.id ?? null,
      },
    });

    return {
      writeOff: applied,
      arIds: allocationIds,
      totalApplied: writeOff.amount,
      appliedAt: now,
    };
  });

  if ("error" in result) {
    switch (result.error) {
      case "WRITE_OFF_NOT_FOUND":
        return failNotFound(ERROR_CODES.WRITE_OFF_NOT_FOUND, "WriteOff 不存在");
      case "ALREADY_APPLIED":
        return failConflict(
          ERROR_CODES.WRITE_OFF_ALREADY_APPLIED,
          `WriteOff 已 APPLIED（${result.appliedAt ?? "已应用"}），不可重复 Apply`,
        );
      case "INVALID_STATE":
        return failConflict(
          ERROR_CODES.WRITE_OFF_INVALID_STATE,
          `仅 SUBMITTED 状态可 Apply（当前 status=${result.status}）`,
        );
      case "APPROVAL_REQUIRED":
        return failConflict(
          ERROR_CODES.WRITE_OFF_APPROVAL_REQUIRED,
          `WriteOff 命中审批策略，需 APPROVED 后才能 Apply（当前 approvalStatus=${result.approvalStatus}）——APPROVED ≠ APPLIED`,
        );
      case "AR_NOT_FOUND":
        return failNotFound(ERROR_CODES.ACCOUNTS_RECEIVABLE_NOT_FOUND, `应收记录不存在（${result.arId}）`);
      case "AMOUNT_EXCEEDED":
        return failConflict(
          ERROR_CODES.WRITE_OFF_AMOUNT_EXCEEDED,
          `写销金额超过应收余额（AR ${result.arId} 请求 ${result.requested}，balanceAmount ${result.balanceAmount}）`,
        );
      default:
        return fail(ERROR_CODES.INTERNAL_ERROR, "Apply 失败：未知错误", 500);
    }
  }

  // ── 7. 事件 + 审计（事务外；DB 事实更新已在事务内提交，事件失败降级不阻断） ──
  try {
    const writeOff = await prisma.writeOff.findFirst({
      where: { id: writeOffId, deletedAt: null },
      include: {
        allocations: {
          where: { deletedAt: null },
          include: { accountsReceivable: { select: { id: true, customerId: true, currency: true } } },
        },
      },
    });
    const arSummary = writeOff?.allocations[0]?.accountsReceivable;
    const basePayload = {
      writeOffId,
      writeOffCode: writeOff?.code ?? null,
      customerId: arSummary?.customerId ?? "",
      currency: arSummary?.currency ?? "",
      amount: writeOff?.amount ?? 0,
      accountsReceivableIds: writeOff?.allocations.map((a) => a.accountsReceivableId) ?? [],
      workflowInstanceId: writeOff?.workflowInstanceId ?? null,
      reason: writeOff?.reason ?? null,
      appliedAt: result.appliedAt.toISOString(),
    };
    await publishWriteOffEvent({
      eventType: "WriteOffApplied",
      actorId: user?.id,
      entityId: writeOffId,
      payload: basePayload,
      meta,
    });
    // AR 领域事件（AccountsReceivableWrittenOff）
    await writeAuditLog({
      actorId: user?.id,
      action: "AccountsReceivableWrittenOff",
      entityType: "accounts-receivable",
      entityId: result.arIds[0] ?? writeOffId,
      afterData: { ...basePayload, arIds: result.arIds },
      ...meta,
    });
    await writeAuditLog({
      actorId: user?.id,
      action: "write-off.apply",
      entityType: "write-off",
      entityId: writeOffId,
      afterData: {
        status: "APPLIED",
        appliedAt: result.appliedAt.toISOString(),
        arIds: result.arIds,
        totalApplied: result.totalApplied.toString(),
      },
      ...meta,
    });
  } catch {
    // 事件/审计失败不阻断主流程（DB 事实已提交）
  }

  return ok(
    {
      writeOffId,
      status: "APPLIED",
      appliedAt: result.appliedAt,
      arIds: result.arIds,
      totalApplied: result.totalApplied,
    },
    undefined,
    201,
  );
}
