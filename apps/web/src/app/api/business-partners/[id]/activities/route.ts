import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failNotFound, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { handleServerError } from "@/lib/api/server-error";
import { z } from "zod";

export const dynamic = "force-dynamic";

/**
 * GET/POST /api/business-partners/:id/activities — Customer 360「跟进活动」（Phase 3 MVP，Migration 0050）
 *
 * 领域事实：CustomerActivity（BP 维度，businessPartnerId）。三类活动共用一张表：
 *   FOLLOW_UP（客户跟进）：summary + nextAction? + reminderAt? + contactId?
 *   VISIT_PLAN（拜访计划）：planDate + summary?(拜访目的) + contactId?
 *   CHECK_IN（定位签到）：latitude/longitude + locationNote?（checkinAt 服务端 now 落库）
 * 时间线事实：FOLLOW_UP → createdAt；VISIT_PLAN → planDate；CHECK_IN → checkinAt（响应附加 occurredAt）。
 * 跟进审批（Migration 0051，followup-collab MVP）：仅 FOLLOW_UP 参与 DRAFT→SUBMITTED→APPROVED/REJECTED；
 *   status/审批时间戳 + commentCount（_count 聚合）随时间线返回；VISIT_PLAN/CHECK_IN status=NULL。
 * 权限：复用 project-visit（view/create；审批 submit→:edit、approve/reject→:approve、评论→:create）——尽量复用既有 RBAC 模块，不新增权限模块（ADR-0028）。
 * HOLD：Workflow Designer/多级审批/会签/抄送/Notification Engine/围栏/签退/通用 Activity Engine。
 */

const createSchema = z
  .object({
    activityType: z.enum(["FOLLOW_UP", "VISIT_PLAN", "CHECK_IN"]),
    contactId: z.string().min(1).max(50).nullable().optional(),
    summary: z.string().max(2000).nullable().optional(),
    nextAction: z.string().max(500).nullable().optional(),
    reminderAt: z.string().datetime().nullable().optional(),
    planDate: z.string().datetime().nullable().optional(),
    latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
    longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
    locationNote: z.string().max(500).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.activityType === "FOLLOW_UP" && (!v.summary || !v.summary.trim())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["summary"], message: "跟进内容必填" });
    }
    if (v.activityType === "VISIT_PLAN" && !v.planDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["planDate"], message: "拜访计划必须提供计划日期" });
    }
    if (v.activityType === "CHECK_IN" && (v.latitude === null || v.latitude === undefined || v.longitude === null || v.longitude === undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["latitude"], message: "签到必须提供经纬度" });
    }
  });

/** 时间线排序键：FOLLOW_UP → createdAt；VISIT_PLAN → planDate；CHECK_IN → checkinAt */
function occurredAt(a: {
  activityType: string;
  createdAt: Date;
  planDate: Date | null;
  checkinAt: Date | null;
}): Date {
  if (a.activityType === "VISIT_PLAN") return a.planDate ?? a.createdAt;
  if (a.activityType === "CHECK_IN") return a.checkinAt ?? a.createdAt;
  return a.createdAt;
}

/** GET /api/business-partners/:id/activities（活动时间线；project-visit:view） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-visit:view");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-activity.list");

  const { id } = await params;
  const bp = await prisma.businessPartner.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!bp) return failNotFound(ERROR_CODES.NOT_FOUND, "往来单位不存在");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const type = searchParams.get("activityType")?.trim();
  const where = {
    businessPartnerId: id,
    deletedAt: null,
    ...(type ? { activityType: type as "FOLLOW_UP" | "VISIT_PLAN" | "CHECK_IN" } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.customerActivity.count({ where }),
    prisma.customerActivity.findMany({
      where,
      orderBy: { createdAt: "desc" }, // 分页边界确定性；页内按 occurredAt 稳定排序（时间线语义）
      skip,
      take,
      include: {
        contact: { select: { id: true, name: true, title: true } },
        _count: { select: { comments: true } },
      },
    }),
  ]);

  const sorted = [...items].sort(
    (a, b) => occurredAt(b).getTime() - occurredAt(a).getTime(),
  );

  return ok(
    sorted.map((a) => ({
      id: a.id,
      activityType: a.activityType,
      businessPartnerId: a.businessPartnerId,
      contactId: a.contactId,
      contact: a.contact,
      summary: a.summary,
      nextAction: a.nextAction,
      reminderAt: a.reminderAt,
      planDate: a.planDate,
      checkinAt: a.checkinAt,
      latitude: a.latitude,
      longitude: a.longitude,
      locationNote: a.locationNote,
      // 跟进审批（Migration 0051；仅 FOLLOW_UP 有值）
      status: a.status,
      submittedAt: a.submittedAt,
      submittedById: a.submittedById,
      approvedAt: a.approvedAt,
      approvedById: a.approvedById,
      rejectedAt: a.rejectedAt,
      rejectedById: a.rejectedById,
      rejectReason: a.rejectReason,
      commentCount: a._count.comments,
      createdById: a.createdById,
      createdAt: a.createdAt,
      occurredAt: occurredAt(a),
    })),
    { page, pageSize, total },
  );
}

/** POST /api/business-partners/:id/activities（新增跟进/拜访计划/签到；project-visit:create） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-visit:create");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-activity.create");

  const { id } = await params;
  const meta = requestMeta(request);
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  try {
    const created = await prisma.$transaction(async (tx) => {
      const bp = await tx.businessPartner.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
      if (!bp) throw new Error("PARTNER_INVALID");

      // 联系人必须属于该客户（防跨客户引用）
      if (parsed.data.contactId) {
        const contact = await tx.partnerContact.findFirst({
          where: { id: parsed.data.contactId, partnerId: id, deletedAt: null },
          select: { id: true },
        });
        if (!contact) throw new Error("CONTACT_MISMATCH");
      }

      const d = parsed.data;
      return tx.customerActivity.create({
        data: {
          businessPartnerId: id,
          activityType: d.activityType,
          contactId: d.contactId ?? null,
          summary: d.summary?.trim() || null,
          nextAction: d.nextAction?.trim() || null,
          reminderAt: d.reminderAt ? new Date(d.reminderAt) : null,
          planDate: d.planDate ? new Date(d.planDate) : null,
          // 签到时间以服务端 now 为准（不信任客户端时间）
          checkinAt: d.activityType === "CHECK_IN" ? new Date() : null,
          latitude: d.activityType === "CHECK_IN" ? d.latitude ?? null : null,
          longitude: d.activityType === "CHECK_IN" ? d.longitude ?? null : null,
          locationNote: d.locationNote?.trim() || null,
          // 跟进审批（Migration 0051）：仅 FOLLOW_UP 进入审批流，初始 DRAFT；VISIT_PLAN/CHECK_IN 不参与 → NULL
          status: d.activityType === "FOLLOW_UP" ? "DRAFT" : null,
          createdById: user!.id,
          updatedById: user!.id,
        },
      });
    });

    await writeAuditLog({
      actorId: user?.id,
      action: "customer-activity.create",
      entityType: "customerActivity",
      entityId: created.id,
      afterData: { businessPartnerId: id, activityType: created.activityType, summary: created.summary, planDate: created.planDate, checkinAt: created.checkinAt },
      ...meta,
    });

    return ok(created, undefined, 201);
  } catch (err) {
    if (err instanceof Error && err.message === "PARTNER_INVALID") {
      return failNotFound(ERROR_CODES.NOT_FOUND, "往来单位不存在");
    }
    if (err instanceof Error && err.message === "CONTACT_MISMATCH") {
      return failValidation({ contactId: ["联系人不存在或不属于该客户"] });
    }
    return handleServerError(request, user?.id, "customer-activity.create", err);
  }
}
