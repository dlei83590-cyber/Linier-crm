import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound, fail } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { writeOffSubmitSchema } from "@/lib/api/schemas";
import { publishWriteOffEvent } from "@/lib/write-off/events";

export const dynamic = "force-dynamic";

/**
 * POST /api/write-offs/:id/submit —— DRAFT → SUBMITTED + approvalStatus=APPROVED（auto-approve：移除审核，提交即生效）
 * - 只允许 DRAFT → SUBMITTED（否则 409 WRITE_OFF_INVALID_STATE）
 * - **auto-approve（移除审核）**：同事务 approvalStatus=APPROVED + approvedAt/approvedById=提交人（跳过 ApprovalPolicy/Workflow），
 *   Apply 门禁（status=SUBMITTED + workflowInstanceId==null → 无需 APPROVED 校验）直接放行
 * - **不修改 AR**（审批通过 ≠ 自动修改余额；只有显式 Apply 才回写——CTO 锁死）
 * - 事件：WriteOffSubmitted（失败降级不阻断）
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
  const actorId = user!.id;

  const result = await prisma.$transaction(async (tx) => {
    const writeOff = await tx.writeOff.findFirst({ where: { id: writeOffId, deletedAt: null } });
    if (!writeOff) return { error: "WRITE_OFF_NOT_FOUND" as const };

    // auto-approve（移除审核：提交即生效——CAS：status=DRAFT 同时命中，防并发双提交）
    const updated = await tx.writeOff.updateMany({
      where: { id: writeOff.id, status: "DRAFT", deletedAt: null },
      data: {
        status: "SUBMITTED",
        approvalStatus: "APPROVED",
        approvedAt: new Date(),
        approvedById: actorId,
        updatedById: actorId,
      },
    });
    if (updated.count !== 1) {
      const cur = await tx.writeOff.findFirst({ where: { id: writeOffId, deletedAt: null } });
      return { error: "INVALID_STATE" as const, status: cur?.status ?? writeOff.status };
    }

    const saved = await tx.writeOff.findFirstOrThrow({ where: { id: writeOff.id } });

    return {
      writeOff: saved,
      workflow: { triggered: false as const, skipped: "no-policy" as const, instanceId: null, resubmitted: false },
    };
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

  // 事件 + 审计（事务外，事件失败降级不阻断）
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
        approvalStatus: writeOff?.approvalStatus ?? "APPROVED",
        workflowTriggered: false,
        workflowSkipped: "no-policy",
      },
      meta,
    });
    await writeAuditLog({
      actorId: user?.id,
      action: "write-off.submit",
      entityType: "write-off",
      entityId: writeOffId,
      beforeData: { status: "DRAFT" },
      afterData: {
        status: "SUBMITTED",
        approvalStatus: "APPROVED",
        workflowSkipped: "no-policy",
        ...(changeReason ? { changeReason } : {}),
      },
      ...meta,
    });
  } catch {
    // 事件/审计失败不阻断主流程
  }

  return ok({
    writeOffId,
    status: "SUBMITTED",
    approvalStatus: "APPROVED",
    workflowTriggered: false,
    workflowInstanceId: null,
    workflowSkipped: "no-policy",
  });
}
