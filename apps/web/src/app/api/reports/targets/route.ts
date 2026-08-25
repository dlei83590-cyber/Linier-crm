import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation } from "@/lib/api/response";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";
import { TARGET_DIMENSION_TYPES } from "@/lib/reports/constants";

export const dynamic = "force-dynamic";

/**
 * GET /api/reports/targets?period=&dimensionType= —— 经营目标列表（ReportTarget 只读查询，reports:view）
 * POST /api/reports/targets —— 新增/更新经营目标（reports:edit；按 period+dimensionType+dimensionValue 幂等 upsert）
 *
 * 最小目标表（Migration 0051）：period / dimensionType / dimensionValue / targetAmount。
 * period 键约定：YYYY / YYYY-MM / YYYY-MM-DD（与经营看板 periodKey 一致，Asia/Shanghai 业务期）。
 * dimensionType 白名单 = TARGET_DIMENSION_TYPES（SALES_AMOUNT / NEW_CUSTOMERS / NEW_OPPORTUNITIES / QUOTATIONS / VISITS / FOLLOW_UPS）。
 * HOLD：Metric Engine / OLAP / DW / BI Platform / Rule DSL（目标仅静态配置，达成率由看板只读聚合）。
 */
const TARGET_PERIOD_RE = /^\d{4}(-\d{2})?(-\d{2})?$/;

const targetUpsertSchema = z.object({
  period: z.string().regex(TARGET_PERIOD_RE, "period 必须为 YYYY / YYYY-MM / YYYY-MM-DD"),
  dimensionType: z.enum(TARGET_DIMENSION_TYPES),
  dimensionValue: z.string().max(50).optional(),
  targetAmount: z.coerce.number().positive(),
});

export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "reports:view");
  if (denied) return denied;
  requestLog(request, user?.id, "reports.targets.list");

  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period")?.trim();
  const dimensionType = searchParams.get("dimensionType")?.trim();

  const items = await prisma.reportTarget.findMany({
    where: {
      deletedAt: null,
      ...(period ? { period } : {}),
      ...(dimensionType ? { dimensionType } : {}),
    },
    orderBy: [{ period: "desc" }, { dimensionType: "asc" }],
  });

  return ok(items);
}

export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "reports:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "reports.targets.upsert");

  const meta = requestMeta(request);
  const parsed = targetUpsertSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { period, dimensionType, targetAmount } = parsed.data;
  const dimensionValue = parsed.data.dimensionValue?.trim() || "ALL";
  const actorId = user!.id;

  const existing = await prisma.reportTarget.findFirst({
    where: { period, dimensionType, dimensionValue, deletedAt: null },
  });

  let saved;
  if (existing) {
    saved = await prisma.reportTarget.update({
      where: { id: existing.id },
      data: { targetAmount, updatedById: actorId, version: { increment: 1 } },
    });
  } else {
    saved = await prisma.reportTarget.create({
      data: {
        period,
        dimensionType,
        dimensionValue,
        targetAmount,
        createdById: actorId,
        updatedById: actorId,
      },
    });
  }

  await writeAuditLog({
    actorId,
    action: existing ? "reports.targets.update" : "reports.targets.create",
    entityType: "reportTarget",
    entityId: saved.id,
    beforeData: existing ? { targetAmount: existing.targetAmount.toString(), version: existing.version } : null,
    afterData: { period, dimensionType, dimensionValue, targetAmount: saved.targetAmount.toString() },
    ...meta,
  });

  return ok(saved, undefined, existing ? 200 : 201);
}

