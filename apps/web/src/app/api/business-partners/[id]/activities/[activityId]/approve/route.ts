import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { handleServerError } from "@/lib/api/server-error";

export const dynamic = "force-dynamic";

/**
 * POST /api/business-partners/:id/activities/:activityId/approve —— 管理者批准跟进（followup-collab MVP，Migration 0051）
 *
 * 状态机：FOLLOW_UP SUBMITTED → APPROVED（仅跟进记录参与审批；VISIT_PLAN/CHECK_IN 不参与 → 409）
 * - 并发安全：updateMany CAS（status=SUBMITTED 同时命中才更新，防并发双审批）
 * - 权限：project-visit:approve（复用既有 RBAC 模块；PERMISSION_ACTIONS 已有 approve → 无需新增权限模块）
 * - 红线：APPROVED ≠ 业务完成，仅为跟进记录审批事实（无后续事实动作，MVP）
 * - HOLD：Workflow Designer/多级审批/会签/抄送/Notification Engine
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; activityId: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-visit:approve");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-activity.approve");

  const { id, activityId } = await params;
  const meta = requestMeta(request);
  const actorId = user!.id;

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
          status: "APPROVED",
          approvedAt: new Date(),
          approvedById: actorId,
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
      return { error: null as null, status: "APPROVED" as const };
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
            "仅 SUBMITTED 状态可批准（当前 status=" + (result.status ?? "NULL") + "）",
          );
      }
    }

    // 审计（失败不阻断主流程）
    await writeAuditLog({
      actorId: user?.id,
      action: "customer-activity.approve",
      entityType: "customerActivity",
      entityId: activityId,
      afterData: { status: "APPROVED", approvedById: actorId },
      ...meta,
    }).catch(() => undefined);

    return ok({ activityId, status: "APPROVED" });
  } catch (err) {
    return handleServerError(request, user?.id, "customer-activity.approve", err);
  }
}
