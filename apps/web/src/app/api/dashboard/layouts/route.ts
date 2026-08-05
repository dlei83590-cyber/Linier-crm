import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(100),
  isDefault: z.boolean().optional(),
  grid: z.record(z.unknown()).optional(),
  enabled: z.boolean().default(true),
});

/** GET /api/dashboard/layouts（分页 + code/name/enabled 过滤） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "dashboard-layout:view");
  if (denied) return denied;
  requestLog(request, user?.id, "layouts.list");

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
    prisma.dashboardLayout.count({ where }),
    prisma.dashboardLayout.findMany({ where, orderBy: { updatedAt: "desc" }, skip, take }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/dashboard/layouts */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "dashboard-layout:create");
  if (denied) return denied;
  requestLog(request, user?.id, "layouts.create");

  const meta = requestMeta(request);
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const existing = await prisma.dashboardLayout.findUnique({ where: { code: parsed.data.code } });
  if (existing && !existing.deletedAt) {
    return failConflict(ERROR_CODES.CONFLICT, "编码已存在");
  }

  const created = await prisma.dashboardLayout.create({
    data: {
      ...parsed.data,
      grid: parsed.data.grid === undefined ? undefined : (parsed.data.grid as Prisma.InputJsonValue),
      createdById: user!.id,
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "layouts.create",
    entityType: "layouts",
    entityId: created.id,
    afterData: { code: created.code, name: created.name },
    ...meta,
  });

  return ok(created, undefined, 201);
}
