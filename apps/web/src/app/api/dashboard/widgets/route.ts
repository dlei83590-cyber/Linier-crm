import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createSchema = z
  .object({
    code: z.string().min(1).max(64),
    name: z.string().min(1).max(100),
    widgetType: z.enum(["KPI", "CHART", "TABLE"]).optional(),
    chartType: z.enum(["LINE", "BAR", "PIE", "AREA", "SCATTER"]).optional(),
    aggregate: z.enum(["SUM", "AVG", "COUNT", "MIN", "MAX"]).optional(),
    unit: z.string().max(20).optional(),
    dataSource: z.string().max(50).optional(),
    query: z.record(z.unknown()).optional(),
    refreshInterval: z.number().int().positive().optional(),
    isDefault: z.boolean().optional(),
    grid: z.record(z.unknown()).optional(),
    xAxis: z.string().max(50).optional(),
    yAxis: z.string().max(50).optional(),
    target: z.coerce.number().optional(),
    sort: z.number().int().default(0),
    enabled: z.boolean().default(true),
  })
  .refine((v) => Object.keys(v).length >= 2, { message: "code 与 name 必填" });

/** GET /api/dashboard/widgets（分页 + code/name/enabled 过滤） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "dashboard-widget:view");
  if (denied) return denied;
  requestLog(request, user?.id, "dashboard-widget.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const code = searchParams.get("code")?.trim();
  const name = searchParams.get("name")?.trim();
  const enabled = searchParams.get("enabled")?.trim();

  const where = {
    deletedAt: null,
    ...(code ? { code: { contains: code } } : {}),
    ...(name ? { name: { contains: name } } : {}),
    ...(enabled === "true" || enabled === "false" ? { enabled: enabled === "true" } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.dashboardWidget.count({ where }),
    prisma.dashboardWidget.findMany({ where, orderBy: [{ sort: "asc" }, { updatedAt: "desc" }], skip, take }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/dashboard/widgets */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "dashboard-widget:create");
  if (denied) return denied;
  requestLog(request, user?.id, "dashboard-widget.create");

  const meta = requestMeta(request);
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const existing = await prisma.dashboardWidget.findUnique({ where: { code: parsed.data.code } });
  if (existing && !existing.deletedAt) {
    return failConflict(ERROR_CODES.CONFLICT, "编码已存在");
  }

  const created = await prisma.dashboardWidget.create({
    data: { ...parsed.data, createdById: user!.id, updatedById: user!.id },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "dashboard-widget.create",
    entityType: "dashboard-widget",
    entityId: created.id,
    afterData: { code: created.code, name: created.name },
    ...meta,
  });

  return ok(created, undefined, 201);
}
