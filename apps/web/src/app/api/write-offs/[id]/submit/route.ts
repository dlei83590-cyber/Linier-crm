import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound, fail } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { writeOffSubmitSchema } from "@/lib/api/schemas";
import { maybeTriggerWriteOffApproval } from "@/lib/write-off/workflow-sync";
import { publishWriteOffEvent } from "@/lib/write-off/events";

export const dynamic = "force-dynamic";

/**
 * POST /api/write-offs/:id/submit —— DRAFT → SUBMITTED（CTO 指令）
 * - 同事务调用 `maybeTriggerWriteOffApproval()`（module=WRITE_OFF 策略按 writeOff.amount 匹配金额区间）：
 *   - **命中策略** → 创建/复用 Workflow 实例，approvalStatus=PENDING → **必须等 APPROVED 后才能 Apply**（Apply 路由门禁）
 *   - **未命中策略** → 保持 SUBMITTED（approvalStatus 仍 DRAFT）→ **可直接进入可 Apply 状态**
 * - **不修改 AR**（审批通过 ≠ 自动修改余额；只有显式 Apply 才回写——CTO 锁死）
 * - 事件：WriteOffSubmitted + WriteOffApprovalStarted（命中策略时由 workflow-sync 发布；失败降级不阻断）
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "write-off:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "write-off.submit");

  const { id: writeOffId } = await params;
  const parsed = writeOffSubmitSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { changeReason } = parsed.data;
  const meta = requestMeta(request);

  const result = await prisma.$transaction(async (tx) => {
    // 1. Lock WriteOff（FOR UPDATE）
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "WriteOff" WHERE "id" = ${writeOffId} AND "deletedAt" IS NULL FOR UPDATE`,
    );
    if (locked.length === 0) return { error: "WRITE_OFF_NOT_FOUND" as const };
    const writeOff = await tx.writeOff.findFirst({ where: { id: writeOffId, deletedAt: null } });
    if (!writeOff) return { error: "WRITE_OFF_NOT_FOUND" as const };

    // 2. 状态校验：仅 DRAFT 可提交
    if (writeOff.status !== "DRAFT") {
      return { error: "INVALID_STATE" as const, status: writeOff.status };
    }

    // 3. DRAFT → SUBMITTED（同事务）
    const updated = await tx.writeOff.update({
      where: { id: writeOff.id },
      data: { status: "SUBMITTED", updatedById: user?.id ?? null },
    });

    // 4. 条件触发审批（同事务；命中策略 → approvalStatus=PENDING + workflowInstanceId；未命中 → skipped）
    const wf = await maybeTriggerWriteOffApproval({
      writeOffId: writeOff.id,
      actorId: user!.id,
      meta,
      tx,
    });

    return { writeOff: updated, workflow: wf };
  });

  if ("error" in result) {
    switch (result.error) {
      case "WRITE_OFF_NOT_FOUND":
        return failNotFound(ERROR_CODES.WRITE_OFF_NOT_FOUND, "WriteOff 不存在");
      case "INVALID_STATE":
        return failConflict(
          ERROR_CODES.WRITE_OFF_INVALID_STATE,
          `仅 DRAFT 状态可提交（当前 status=${result.status}）`,
        );
      default:
        return fail(ERROR_CODES.INTERNAL_ERROR, "提交失败：未知错误", 500);
    }
  }

  // 5. 事件 + 审计（事务外，事件失败降级不阻断）
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
    await publishWriteOffEvent({
      eventType: "WriteOffSubmitted",
      actorId: user?.id,
      entityId: writeOffId,
      payload: {
        writeOffId,
        writeOffCode: writeOff?.code ?? null,
        customerId: arSummary?.customerId ?? "",
        currency: arSummary?.currency ?? "",
        amount: writeOff?.amount ?? 0,
        accountsReceivableIds: writeOff?.allocations.map((a) => a.accountsReceivableId) ?? [],
        workflowInstanceId: writeOff?.workflowInstanceId ?? null,
        reason: writeOff?.reason ?? null,
        approvalStatus: writeOff?.approvalStatus ?? "DRAFT",
        workflowTriggered: result.workflow.triggered,
        workflowSkipped: result.workflow.skipped ?? null,
      },
      meta,
    });
    await writeAuditLog({
      actorId: user?.id,
      action: "write-off.submit",
      entityType: "write-off",
      entityId: writeOffId,
      afterData: {
        status: "SUBMITTED",
        workflowTriggered: result.workflow.triggered,
        workflowSkipped: result.workflow.skipped ?? null,
        workflowInstanceId: writeOff?.workflowInstanceId ?? null,
      },
      ...meta,
    });
  } catch {
    // 事件/审计失败不阻断主流程
  }

  return ok({
    writeOffId,
    status: "SUBMITTED",
    approvalStatus: result.writeOff.approvalStatus,
    workflowTriggered: result.workflow.triggered,
    workflowInstanceId: result.workflow.instanceId ?? null,
    workflowSkipped: result.workflow.skipped ?? null,
  });
}
