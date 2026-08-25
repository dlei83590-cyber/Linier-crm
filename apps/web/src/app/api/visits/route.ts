import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { ok, parsePagination } from "@/lib/api/response";
import { requestLog } from "@/lib/api/logger";
import { chinaTimeRange } from "@/lib/visit/geo";

export const dynamic = "force-dynamic";

/**
 * GET /api/visits — 拜访计划周/月视图（feat(crm) 拜访周/月视图 + 签到规则 MVP，Migration 0051）
 *
 * 领域事实：复用 CustomerActivity VISIT_PLAN（不建新表、不建平行真相）。
 * 视图语义：
 *   - range=week（默认）→ 本周（北京时间周一 00:00 ~ 下周一 00:00）；range=month → 本月（1 号 00:00 ~ 下月 1 号 00:00）；
 *   - 行字段：客户（BusinessPartner 摘要 + 签到范围配置）、计划日期 planDate、负责人 owner（createdById → User）、
 *     状态 status（PENDING 待拜访 / COMPLETED 已完成——有 CHECK_IN.visitPlanId 指向该计划即已完成）；
 *   - checkins：关联签到明细（checkinAt/checkoutAt/经纬度/位置备注），供「已完成 + 签退」展示与操作。
 * 权限：复用 project-visit:view（不新增权限模块，ADR-0028）。
 * HOLD：GIS/地图服务/GeoFence Engine/推送/日历平台/拖拽排程/路线规划。
 */

/** GET /api/visits?range=week|month&ownerId=&businessPartnerId= */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "project-visit:view");
  if (denied) return denied;
  requestLog(request, user?.id, "visit-plan.list");

  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") === "month" ? "month" : "week";
  const { start, end } = chinaTimeRange(range);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const ownerId = searchParams.get("ownerId")?.trim();
  const businessPartnerId = searchParams.get("businessPartnerId")?.trim();

  const where: Prisma.CustomerActivityWhereInput = {
    activityType: "VISIT_PLAN",
    deletedAt: null,
    planDate: { gte: start, lt: end },
    ...(ownerId ? { createdById: ownerId } : {}),
    ...(businessPartnerId ? { businessPartnerId } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.customerActivity.count({ where }),
    prisma.customerActivity.findMany({
      where,
      orderBy: [{ planDate: "asc" }, { createdAt: "asc" }],
      skip,
      take,
      include: {
        businessPartner: {
          select: {
            id: true,
            code: true,
            name: true,
            type: true,
            address: true,
            region: true,
            latitude: true,
            longitude: true,
            allowedRadiusMeters: true,
          },
        },
        contact: { select: { id: true, name: true, title: true } },
      },
    }),
  ]);

  const planIds = items.map((a) => a.id);

  // 关联签到明细：CHECK_IN.visitPlanId → VISIT_PLAN（完成反馈事实源）
  const checkins = planIds.length
    ? await prisma.customerActivity.findMany({
        where: { activityType: "CHECK_IN", deletedAt: null, visitPlanId: { in: planIds } },
        orderBy: { checkinAt: "asc" },
        select: {
          id: true,
          visitPlanId: true,
          checkinAt: true,
          checkoutAt: true,
          latitude: true,
          longitude: true,
          locationNote: true,
          createdById: true,
        },
      })
    : [];
  const checkinsByPlan = new Map<string, typeof checkins>();
  for (const c of checkins) {
    const key = c.visitPlanId as string;
    const list = checkinsByPlan.get(key) ?? [];
    list.push(c);
    checkinsByPlan.set(key, list);
  }

  // 负责人（VISIT_PLAN 创建人 = 拜访负责人；User 维度）
  const creatorIds = [...new Set(items.map((a) => a.createdById).filter((v): v is string => Boolean(v)))];
  const users = creatorIds.length
    ? await prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true, email: true } })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  const rows = items.map((a) => {
    const list = checkinsByPlan.get(a.id) ?? [];
    const owner = a.createdById ? userMap.get(a.createdById) ?? null : null;
    return {
      id: a.id,
      activityType: a.activityType,
      businessPartnerId: a.businessPartnerId,
      businessPartner: a.businessPartner,
      contactId: a.contactId,
      contact: a.contact,
      planDate: a.planDate,
      summary: a.summary,
      owner: owner ? { id: owner.id, name: owner.name, email: owner.email } : null,
      status: list.length > 0 ? ("COMPLETED" as const) : ("PENDING" as const),
      checkins: list,
      createdAt: a.createdAt,
    };
  });

  return ok(rows, { page, pageSize, total });
}
