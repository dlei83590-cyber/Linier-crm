import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { handleServerError } from "@/lib/api/server-error";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createCommentSchema = z.object({
  content: z.string().trim().min(1, "评论内容必填").max(1000, "评论内容最多 1000 字"),
});

/**
 * GET/POST /api/business-partners/:id/activities/:activityId/comments —— 跟进活动评论（followup-collab MVP，Migration 0051）
 *
 * ActivityComment 最小评论（activityId/content/createdById/createdAt）；不可变——MVP 无编辑/删除。
 * - GET：按 createdAt 升序返回评论列表（project-visit:view）
 * - POST：创建评论（project-visit:create）；活动不存在 → 404 CUSTOMER_ACTIVITY_NOT_FOUND
 * - 时间线评论数：GET /api/business-partners/:id/activities 响应携带 commentCount（_count 聚合）
 * - HOLD：@提及/群消息/通知/富文本/附件/回复
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; activityId: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-visit:view");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-activity-comment.list");

  const { id, activityId } = await params;
  const activity = await prisma.customerActivity.findFirst({
    where: { id: activityId, businessPartnerId: id, deletedAt: null },
    select: { id: true },
  });
  if (!activity) return failNotFound(ERROR_CODES.CUSTOMER_ACTIVITY_NOT_FOUND, "跟进活动不存在");

  const comments = await prisma.activityComment.findMany({
    where: { activityId },
    orderBy: { createdAt: "asc" },
    select: { id: true, activityId: true, content: true, createdById: true, createdAt: true },
  });

  return ok(comments);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; activityId: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-visit:create");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-activity-comment.create");

  const { id, activityId } = await params;
  const meta = requestMeta(request);
  const parsed = createCommentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  try {
    const created = await prisma.$transaction(async (tx) => {
      const activity = await tx.customerActivity.findFirst({
        where: { id: activityId, businessPartnerId: id, deletedAt: null },
        select: { id: true },
      });
      if (!activity) throw new Error("ACTIVITY_INVALID");

      return tx.activityComment.create({
        data: {
          activityId,
          content: parsed.data.content,
          createdById: user!.id,
        },
        select: { id: true, activityId: true, content: true, createdById: true, createdAt: true },
      });
    });

    await writeAuditLog({
      actorId: user?.id,
      action: "customer-activity-comment.create",
      entityType: "activityComment",
      entityId: created.id,
      afterData: { activityId, content: created.content },
      ...meta,
    }).catch(() => undefined);

    return ok(created, undefined, 201);
  } catch (err) {
    if (err instanceof Error && err.message === "ACTIVITY_INVALID") {
      return failNotFound(ERROR_CODES.CUSTOMER_ACTIVITY_NOT_FOUND, "跟进活动不存在");
    }
    return handleServerError(request, user?.id, "customer-activity-comment.create", err);
  }
}
