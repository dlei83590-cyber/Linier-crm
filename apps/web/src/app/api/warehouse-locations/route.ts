import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, parsePagination } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const warehouseLocationCreateSchema = z.object({
  warehouseId: z.string().min(1),
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
});

/** GET /api/warehouse-locations（分页 + warehouseId/code/name/isActive 过滤，Master-Data Read API — Warehouse Location；SSOT = Prisma WarehouseLocation） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "warehouse-location:view");
  if (denied) return denied;
  requestLog(request, user?.id, "warehouse-location.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const warehouseId = searchParams.get("warehouseId")?.trim();
  const code = searchParams.get("code")?.trim();
  const name = searchParams.get("name")?.trim();
  const isActive = searchParams.get("isActive")?.trim();

  const where = {
    deletedAt: null,
    ...(warehouseId ? { warehouseId } : {}),
    ...(code ? { code: { contains: code, mode: "insensitive" as const } } : {}),
    ...(name ? { name: { contains: name, mode: "insensitive" as const } } : {}),
    ...(isActive === "true" ? { isActive: true } : isActive === "false" ? { isActive: false } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.warehouseLocation.count({ where }),
    prisma.warehouseLocation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        warehouse: { select: { id: true, code: true, name: true } },
      },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}

/** POST /api/warehouse-locations（创建库位：warehouse 有效 + 同仓库 code 唯一 @@unique([warehouseId, code])） */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "warehouse-location:create");
  if (denied) return denied;
  requestLog(request, user?.id, "warehouse-location.create");

  const meta = requestMeta(request);
  const parsed = warehouseLocationCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const warehouse = await prisma.warehouse.findFirst({
    where: { id: parsed.data.warehouseId, deletedAt: null },
  });
  if (!warehouse) return failConflict(ERROR_CODES.NOT_FOUND, "所属仓库不存在或已停用");

  const dup = await prisma.warehouseLocation.findFirst({
    where: { warehouseId: parsed.data.warehouseId, code: parsed.data.code, deletedAt: null },
  });
  if (dup) return failConflict(ERROR_CODES.CONFLICT, "该仓库下库位编码已存在");

  const created = await prisma.warehouseLocation.create({
    data: {
      warehouseId: parsed.data.warehouseId,
      code: parsed.data.code,
      name: parsed.data.name,
      createdById: user?.id ?? null,
      updatedById: user?.id ?? null,
    },
    include: { warehouse: { select: { id: true, code: true, name: true } } },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "warehouse-location.create",
    entityType: "warehouseLocation",
    entityId: created.id,
    afterData: { warehouseId: created.warehouseId, code: created.code, name: created.name },
    ...meta,
  });

  return ok(created, undefined, 201);
}
