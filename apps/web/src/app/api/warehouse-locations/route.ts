import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { requestLog } from "@/lib/api/logger";
import { ok, parsePagination } from "@/lib/api/response";

export const dynamic = "force-dynamic";

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
