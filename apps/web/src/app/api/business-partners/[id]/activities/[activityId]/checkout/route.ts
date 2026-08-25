import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failConflict, failNotFound, failValidation } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { handleServerError } from "@/lib/api/server-error";

export const dynamic = "force-dynamic";

/**
 * POST /api/business-partners/:id/activities/:activityId/checkout — 签退（Migration 0051）
 *
 * 领域事实：CHECK_IN 的 checkoutAt（服务端 now 落库，不信任客户端时间）。
 * 规则：
 *   - 仅 CHECK_IN 可签退（activityType = CHECK_IN 且 checkinAt 非空）；
 *   - 已签退（checkoutAt 非空）→ 409 CHECK_IN_ALREADY_CHECKED_OUT（幂等拒绝）；
 *   - 活动必须属于该客户（businessPartnerId = :id），跨客户访问 fail closed。
 * 权限：复用 project-visit:create（签到/签退同属客户活动写入）。
 * HOLD：签退统计/围栏签退/审批流。
 */

/** POST /api/business-partners/:id/activities/:activityId/checkout */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; activityId: string }> },
) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-visit:create");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-activity.checkout");

  const { id, activityId } = await params;
  const meta = requestMeta(request);

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const activity = await tx.customerActivity.findFirst({
        where: { id: activityId, businessPartnerId: id, deletedAt: null },
      });
      if (!activity) throw new Error("ACTIVITY_NOT_FOUND");
      if (activity.activityType !== "CHECK_IN" || !activity.checkinAt) {
        throw new Error("NOT_CHECK_IN");
      }
      if (activity.checkoutAt) {
        throw new Error("ALREADY_CHECKED_OUT");
      }
      const now = new Date();
      return tx.customerActivity.update({
        where: { id: activityId },
        data: { checkoutAt: now, updatedById: user?.id ?? null },
      });
    });

    await writeAuditLog({
      actorId: user?.id,
      action: "customer-activity.checkout",
      entityType: "customerActivity",
      entityId: activityId,
      afterData: { businessPartnerId: id, checkinAt: updated.checkinAt, checkoutAt: updated.checkoutAt },
      ...meta,
    });

    return ok(updated);
  } catch (err) {
    if (err instanceof Error && err.message === "ACTIVITY_NOT_FOUND") {
      return failNotFound(ERROR_CODES.NOT_FOUND, "签到记录不存在");
    }
    if (err instanceof Error && err.message === "NOT_CHECK_IN") {
      return failValidation({ activityId: ["仅签到（CHECK_IN）记录可签退"] });
    }
    if (err instanceof Error && err.message === "ALREADY_CHECKED_OUT") {
      return failConflict(ERROR_CODES.CHECK_IN_ALREADY_CHECKED_OUT, "该签到已签退，禁止重复签退");
    }
    return handleServerError(request, user?.id, "customer-activity.checkout", err);
  }
}
