import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, fail, failValidation, failNotFound, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { handleServerError } from "@/lib/api/server-error";
import { haversineMeters } from "@/lib/visit/geo";
import { z } from "zod";

export const dynamic = "force-dynamic";

/**
 * GET/POST /api/business-partners/:id/activities — Customer 360「跟进活动」（Phase 3 MVP，Migration 0050 + 0051）
 *
 * 领域事实：CustomerActivity（BP 维度，businessPartnerId）。三类活动共用一张表：
 *   FOLLOW_UP（客户跟进）：summary + nextAction? + reminderAt? + contactId?
 *   VISIT_PLAN（拜访计划）：planDate + summary?(拜访目的) + contactId?
 *   CHECK_IN（定位签到）：latitude/longitude + locationNote? + visitPlanId? + checkoutAt?
 *     （checkinAt/checkoutAt 服务端 now 落库；visitPlanId 关联拜访计划 → VISIT_PLAN 反馈已完成）
 * 时间线事实：FOLLOW_UP → createdAt；VISIT_PLAN → planDate；CHECK_IN → checkinAt（响应附加 occurredAt）。
 * 签到规则（Migration 0051，feat(crm) 拜访周/月视图 + 签到规则 MVP）：
 *   ① BusinessPartner 配置 latitude/longitude/allowedRadiusMeters（三者齐备时启用）→ 服务端 Haversine
 *      计算签到距离，范围内成功、超范围 400 CHECK_IN_OUT_OF_RANGE（明确提示距离/半径）；
 *   ② 签到成功后同事务自动生成一条最小 FOLLOW_UP 草稿「签到：时间/位置」（复用 CustomerActivity，
 *      无独立草稿状态——FOLLOW_UP 即草稿载体）；
 *   ③ 签退 = POST /api/business-partners/:id/activities/:activityId/checkout（checkoutAt 服务端 now）。
 * 权限：复用 project-visit（view/create）——尽量复用既有 RBAC 模块，不新增权限模块（ADR-0028）。
 * HOLD：审批流/评论/群消息/酷卡片/GIS 平台/地图服务/GeoFence Engine/推送平台/通用 Activity Engine。
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
    // 拜访计划反馈（Migration 0051）：CHECK_IN 可选关联 VISIT_PLAN id
    visitPlanId: z.string().min(1).max(50).nullable().optional(),
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

/** 自动 FOLLOW_UP 草稿摘要：签到：{ISO 时间}（{位置备注或经纬度}） */
function autoFollowUpSummary(now: Date, lat: number, lng: number, locationNote: string | null | undefined): string {
  const loc = locationNote?.trim() || `${lat}, ${lng}`;
  return `签到：${now.toISOString()}（${loc}）`;
}

/** 签到超范围（服务端 Haversine 距离 > 客户允许半径）：携带距离/半径事实供明确提示 */
class CheckInOutOfRangeError extends Error {
  readonly distanceMeters: number;
  readonly allowedRadiusMeters: number;
  constructor(distanceMeters: number, allowedRadiusMeters: number) {
    super("CHECK_IN_OUT_OF_RANGE");
    this.name = "CheckInOutOfRangeError";
    this.distanceMeters = distanceMeters;
    this.allowedRadiusMeters = allowedRadiusMeters;
  }
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
      include: { contact: { select: { id: true, name: true, title: true } }, _count: { select: { comments: true } } },
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
      checkoutAt: a.checkoutAt,
      visitPlanId: a.visitPlanId,
      latitude: a.latitude,
      longitude: a.longitude,
      locationNote: a.locationNote,
      // #238：审批状态（FOLLOW_UP）透传 + 评论数（VISIT_PLAN/CHECK_IN status=NULL）
      status: a.status,
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
      const bp = await tx.businessPartner.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, latitude: true, longitude: true, allowedRadiusMeters: true },
      });
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

      // 签到规则：①visitPlanId 必须指向本客户的 VISIT_PLAN（防跨客户引用）
      if (d.activityType === "CHECK_IN" && d.visitPlanId) {
        const plan = await tx.customerActivity.findFirst({
          where: { id: d.visitPlanId, businessPartnerId: id, activityType: "VISIT_PLAN", deletedAt: null },
          select: { id: true },
        });
        if (!plan) throw new Error("VISIT_PLAN_MISMATCH");
      }

      // 签到规则：②客户配置签到范围（lat/lng/radius 齐备）→ 服务端计算距离，超范围 fail closed
      let distanceMeters: number | null = null;
      if (d.activityType === "CHECK_IN") {
        const bpLat = bp.latitude === null ? null : Number(bp.latitude);
        const bpLng = bp.longitude === null ? null : Number(bp.longitude);
        if (bpLat !== null && bpLng !== null && bp.allowedRadiusMeters !== null) {
          distanceMeters = haversineMeters(d.latitude as number, d.longitude as number, bpLat, bpLng);
          if (distanceMeters > bp.allowedRadiusMeters) {
            throw new CheckInOutOfRangeError(distanceMeters, bp.allowedRadiusMeters);
          }
        }
      }

      const now = new Date();
      const checkin = await tx.customerActivity.create({
        data: {
          businessPartnerId: id,
          activityType: d.activityType,
          contactId: d.contactId ?? null,
          summary: d.summary?.trim() || null,
          nextAction: d.nextAction?.trim() || null,
          reminderAt: d.reminderAt ? new Date(d.reminderAt) : null,
          planDate: d.planDate ? new Date(d.planDate) : null,
          // 签到时间以服务端 now 为准（不信任客户端时间）
          checkinAt: d.activityType === "CHECK_IN" ? now : null,
          visitPlanId: d.activityType === "CHECK_IN" ? d.visitPlanId ?? null : null,
          latitude: d.activityType === "CHECK_IN" ? d.latitude ?? null : null,
          longitude: d.activityType === "CHECK_IN" ? d.longitude ?? null : null,
          locationNote: d.locationNote?.trim() || null,
          // 跟进审批（#238）：仅 FOLLOW_UP 进入审批流，初始 DRAFT；VISIT_PLAN/CHECK_IN 不参与 → NULL
          status: d.activityType === "FOLLOW_UP" ? "DRAFT" : null,
          createdById: user!.id,
          updatedById: user!.id,
        },
      });

      // 签到规则：③签到成功后自动生成一条最小 FOLLOW_UP 草稿「签到：时间/位置」（复用 CustomerActivity）
      let followUp: Awaited<ReturnType<typeof tx.customerActivity.create>> | null = null;
      if (d.activityType === "CHECK_IN") {
        followUp = await tx.customerActivity.create({
          data: {
            businessPartnerId: id,
            activityType: "FOLLOW_UP",
<<<<<<< HEAD
            status: "DRAFT", // #238 审批状态机：新跟进必须 DRAFT（可提交审批）
=======
            status: "DRAFT", // #238 审批状态机：新 FOLLOW_UP 必须 DRAFT（可提交审批）
>>>>>>> 834f0d9 (fix(crm): O+P——签到自动 FOLLOW_UP 加 status=DRAFT（对齐 #238 审批状态机）；Migration 0051→0052（CTO SMALL FIX）)
            summary: autoFollowUpSummary(now, d.latitude as number, d.longitude as number, d.locationNote),
            createdById: user!.id,
            updatedById: user!.id,
          },
        });
      }

      return { checkin, followUp, distanceMeters };
    });

    await writeAuditLog({
      actorId: user?.id,
      action: "customer-activity.create",
      entityType: "customerActivity",
      entityId: created.checkin.id,
      afterData: {
        businessPartnerId: id,
        activityType: created.checkin.activityType,
        summary: created.checkin.summary,
        planDate: created.checkin.planDate,
        checkinAt: created.checkin.checkinAt,
        visitPlanId: created.checkin.visitPlanId,
        distanceMeters: created.distanceMeters,
      },
      ...meta,
    });

    return ok({ ...created.checkin, autoFollowUp: created.followUp, distanceMeters: created.distanceMeters }, undefined, 201);
  } catch (err) {
    if (err instanceof Error && err.message === "PARTNER_INVALID") {
      return failNotFound(ERROR_CODES.NOT_FOUND, "往来单位不存在");
    }
    if (err instanceof Error && err.message === "CONTACT_MISMATCH") {
      return failValidation({ contactId: ["联系人不存在或不属于该客户"] });
    }
    if (err instanceof Error && err.message === "VISIT_PLAN_MISMATCH") {
      return failValidation({ visitPlanId: ["拜访计划不存在或不属于该客户"] });
    }
    if (err instanceof CheckInOutOfRangeError) {
      return fail(
        ERROR_CODES.CHECK_IN_OUT_OF_RANGE,
        `签到位置超出客户签到范围（距离 ${err.distanceMeters} 米 > 允许 ${err.allowedRadiusMeters} 米），请到达客户现场后再签到`,
        400,
        { distanceMeters: err.distanceMeters, allowedRadiusMeters: err.allowedRadiusMeters },
      );
    }
    return handleServerError(request, user?.id, "customer-activity.create", err);
  }
}
