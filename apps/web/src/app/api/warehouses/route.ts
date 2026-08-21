import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { requestLog } from "@/lib/api/logger";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { z } from "zod";

export const dynamic = "force-dynamic";

/** GET /api/warehouses（分页 + code/name/type/isActive 过滤，Master-Data Read API — Warehouse；SSOT = Prisma Warehouse） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "warehouse:view");
  if (denied) return denied;
  requestLog(request, user?.id, "warehouse.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const code = searchParams.get("code")?.trim();
  const name = searchParams.get("name")?.trim();
  const type = searchParams.get("type")?.trim();
  const isActive = searchParams.get("isActive")?.trim();

  const where = {
    deletedAt: null,
    ...(code ? { code: { contains: code, mode: "insensitive" as const } } : {}),
    ...(name ? { name: { contains: name, mode: "insensitive" as const } } : {}),
    ...(type ? { type } : {}),
    ...(isActive === "true" ? { isActive: true } : isActive === "false" ? { isActive: false } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.warehouse.count({ where }),
    prisma.warehouse.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
  ]);

  return ok(items, { page, pageSize, total });
}
const warehouseCreateSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  type: z.string().max(64).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  remark: z.string().max(1000).nullable().optional(),
});

/** POST /api/warehouses（创建仓库；warehouse:create） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "warehouse:create");
  if (denied) return denied;
  requestLog(request, user?.id, "warehouse.create");

  const parsed = warehouseCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { code, name, type, address, remark } = parsed.data;
  const meta = requestMeta(request);

  const existing = await prisma.warehouse.findUnique({ where: { code } });
  if (existing && !existing.deletedAt) {
    return failConflict(ERROR_CODES.CONFLICT, "仓库编码已存在");
  }

  const warehouse = await prisma.warehouse.create({
    data: {
      code: code.trim(),
      name: name.trim(),
      type: type?.trim() || null,
      address: address?.trim() || null,
      remark: remark?.trim() || null,
      createdById: user!.id,
      updatedById: user!.id,
    },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "warehouse.create",
    entityType: "warehouse",
    entityId: warehouse.id,
    afterData: { code: warehouse.code, name: warehouse.name },
    ...meta,
  });

  return ok(warehouse);
}

