import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { handleServerError } from "@/lib/api/server-error";
import { z } from "zod";

export const dynamic = "force-dynamic";

const rejectSchema = z.object({
  rejectReason: z.string().trim().min(1, "驳回原因必填").max(500, "驳回原因最多 500 字"),
});

/**
 * POST /api/business-partners/:id/activities/:activityId/reject —— 管理者驳回跟进（followup-collab MVP，Migration 0051）
 *
 * 状态机：FOLLOW_UP SUBMITTED → REJECTED + rejectReason（必填；可重新提交 → 重新进入审批）
 * - 并发安全：updateMany CAS（status=SUBMITTED 同时命中才更新，防并发双审批）
 * - 权限：project-visit:approve（复用既有 RBAC 模块；驳回与批准同为审批动作）
 * - HOLD：Workflow Designer/多级审批/会签/抄送/Notification Engine
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; activityId: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-visit:approve");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-activity.reject");

  const { id, activityId } = await params;
  const meta = requestMeta(request);
  const actorId = user!.id;
  const parsed = rejectSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  try {
    const result = await prisma.$transaction(async (tx) => {
      const activity = await tx.customerActivity.findFirst({
        where: { id: activityId, businessPartnerId: id, deletedAt: null },
        select: { id: true, activityType: true, status: true },
      });
      if (!activity) return { error: "NOT_FOUND" as const };

      if (activity.activityType !== "FOLLOW_UP") {
        return { error: "NOT_FOLLOW_UP" as const, status: activity.status };
      }
      if (activity.status !== "SUBMITTED") {
        return { error: "INVALID_STATE" as const, status: activity.status };
      }

      const updated = await tx.customerActivity.updateMany({
        where: {
          id: activityId,
          businessPartnerId: id,
          deletedAt: null,
          activityType: "FOLLOW_UP",
          status: "SUBMITTED",
        },
        data: {
          status: "REJECTED",
          rejectedAt: new Date(),
          rejectedById: actorId,
          rejectReason: parsed.data.rejectReason,
          updatedById: actorId,
        },
      });
      if (updated.count !== 1) {
        const cur = await tx.customerActivity.findFirst({
          where: { id: activityId, businessPartnerId: id, deletedAt: null },
          select: { status: true },
        });
        return { error: "INVALID_STATE" as const, status: cur?.status };
      }
      return { error: null as null, status: "REJECTED" as const };
    });

    if (result.error) {
      switch (result.error) {
        case "NOT_FOUND":
          return failNotFound(ERROR_CODES.CUSTOMER_ACTIVITY_NOT_FOUND, "跟进活动不存在");
        case "NOT_FOLLOW_UP":
          return failConflict(ERROR_CODES.CUSTOMER_ACTIVITY_INVALID_STATE, "仅跟进记录（FOLLOW_UP）参与审批流");
        case "INVALID_STATE":
          return failConflict(
            ERROR_CODES.CUSTOMER_ACTIVITY_INVALID_STATE,
            "仅 SUBMITTED 状态可驳回（当前 status=" + (result.status ?? "NULL") + "）",
          );
      }
    }

    // 审计（失败不阻断主流程）
    await writeAuditLog({
      actorId: user?.id,
      action: "customer-activity.reject",
      entityType: "customerActivity",
      entityId: activityId,
      afterData: { status: "REJECTED", rejectedById: actorId, rejectReason: parsed.data.rejectReason },
      ...meta,
    }).catch(() => undefined);

    return ok({ activityId, status: "REJECTED", rejectReason: parsed.data.rejectReason });
  } catch (err) {
    return handleServerError(request, user?.id, "customer-activity.reject", err);
  }
}
