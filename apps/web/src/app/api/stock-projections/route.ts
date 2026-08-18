import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { requestLog } from "@/lib/api/logger";
import { ok, parsePagination } from "@/lib/api/response";

export const dynamic = "force-dynamic";

/**
 * GET /api/stock-projections（只读余额投影列表，Inventory Read Model Gate FINAL）
 *
 * 过滤：item（Item.code/name 模糊）/ itemId / warehouseId / locationId / batchNo / serialNo；分页 page/pageSize（≤100）。
 * 红线（CTO Directive 2026-08-12 §15/§16）：余额唯一权威 = StockProjection SSOT；
 * 不引入 reservedQty / availableQty / unitCost / FIFO layer / movingAverageCost；前端禁止 SUM InventoryMovement 充当余额（§14）。
 * 权限：stock-projection:view。
 */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "stock-projection:view");
  if (denied) return denied;
  requestLog(request, user?.id, "stock-projection.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const item = searchParams.get("item")?.trim();
  const itemId = searchParams.get("itemId")?.trim();
  const warehouseId = searchParams.get("warehouseId")?.trim();
  const locationId = searchParams.get("locationId")?.trim();
  const batchNo = searchParams.get("batchNo")?.trim();
  const serialNo = searchParams.get("serialNo")?.trim();

  const where = {
    ...(item
      ? {
          item: {
            OR: [
              { code: { contains: item, mode: "insensitive" as const } },
              { name: { contains: item, mode: "insensitive" as const } },
            ],
          },
        }
      : {}),
    ...(itemId ? { itemId } : {}),
    ...(warehouseId ? { warehouseId } : {}),
    ...(locationId ? { locationId } : {}),
    ...(batchNo ? { batchNo } : {}),
    ...(serialNo ? { serialNo } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.stockProjection.count({ where }),
    prisma.stockProjection.findMany({
      where,
      include: {
        warehouse: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
        item: { select: { id: true, code: true, name: true } },
      },
      orderBy: { updatedAt: "desc" },
      skip,
      take,
    }),
  ]);

  return ok(items, { page, pageSize, total });
}
