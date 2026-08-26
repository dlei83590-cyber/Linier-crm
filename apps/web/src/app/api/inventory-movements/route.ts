import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import type {
  InventoryMovementType,
  InventoryMovementDirection,
  InventoryMovementSourceType,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { requestLog } from "@/lib/api/logger";
import { ok, parsePagination, failValidation } from "@/lib/api/response";

export const dynamic = "force-dynamic";

/** InventoryMovementType / Direction / SourceType 合法枚举（对齐 schema；非法值 → 400 VALIDATION_ERROR，避免 Prisma 枚举异常 500） */
const MOVEMENT_TYPES = [
  "INBOUND",
  "OUTBOUND",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "CONSUME",
  "PRODUCE",
  "ADJUSTMENT",
  "REVERSAL",
  "CORRECTION",
] as const;
const DIRECTIONS = ["IN", "OUT"] as const;
const SOURCE_TYPES = [
  "WAREHOUSE_RECEIPT_POSTED",
  "PURCHASE_RETURN_RETURNED",
  "TRANSFER",
  "ADJUSTMENT",
  "CONVERSION",
  "PRODUCTION",
  "SALES_DELIVERY",
  "REVERSAL",
  "CORRECTION",
] as const;

/**
 * GET /api/inventory-movements（只读库存流水列表，Inventory Read Model Gate FINAL）
 *
 * 过滤：item（Item.code/name 模糊）/ itemId / warehouseId / locationId / movementType / direction / sourceType /
 * sourceId / movementGroupId / dateFrom-dateTo（committedAt 范围）；分页 page/pageSize（≤100）。
 * 本端点 = Trace / Audit Query（CTO Directive §15），**不是余额 API**——前端禁止 SUM quantity 充当权威余额（§14）。
 * 权限：inventory-movement:view。
 */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "inventory-movement:view");
  if (denied) return denied;
  requestLog(request, user?.id, "inventory-movement.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const item = searchParams.get("item")?.trim();
  const itemId = searchParams.get("itemId")?.trim();
  const warehouseId = searchParams.get("warehouseId")?.trim();
  const locationId = searchParams.get("locationId")?.trim();
  const movementType = searchParams.get("movementType")?.trim();
  const direction = searchParams.get("direction")?.trim();
  const sourceType = searchParams.get("sourceType")?.trim();
  const sourceId = searchParams.get("sourceId")?.trim();
  const movementGroupId = searchParams.get("movementGroupId")?.trim();
  const dateFrom = searchParams.get("dateFrom")?.trim();
  const dateTo = searchParams.get("dateTo")?.trim();

  if (movementType && !(MOVEMENT_TYPES as readonly string[]).includes(movementType)) {
    return failValidation({ movementType: `movementType 必须为 ${MOVEMENT_TYPES.join("|")}` });
  }
  if (direction && !(DIRECTIONS as readonly string[]).includes(direction)) {
    return failValidation({ direction: "direction 必须为 IN|OUT" });
  }
  if (sourceType && !(SOURCE_TYPES as readonly string[]).includes(sourceType)) {
    return failValidation({ sourceType: `sourceType 必须为 ${SOURCE_TYPES.join("|")}` });
  }
  const committedAt: { gte?: Date; lte?: Date } = {};
  if (dateFrom) {
    const d = new Date(dateFrom);
    if (Number.isNaN(d.getTime())) return failValidation({ dateFrom: "dateFrom 必须为合法 ISO 时间" });
    committedAt.gte = d;
  }
  if (dateTo) {
    const d = new Date(dateTo);
    if (Number.isNaN(d.getTime())) return failValidation({ dateTo: "dateTo 必须为合法 ISO 时间" });
    committedAt.lte = d;
  }

  const where: Prisma.InventoryMovementWhereInput = {
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
    ...(movementType ? { movementType: movementType as InventoryMovementType } : {}),
    ...(direction ? { direction: direction as InventoryMovementDirection } : {}),
    ...(sourceType ? { sourceType: sourceType as InventoryMovementSourceType } : {}),
    ...(sourceId ? { sourceId } : {}),
    ...(movementGroupId ? { movementGroupId } : {}),
    ...(committedAt.gte || committedAt.lte ? { committedAt } : {}),
  };

  const [total, items] = await Promise.all([
    prisma.inventoryMovement.count({ where }),
    prisma.inventoryMovement.findMany({
      where,
      include: {
        warehouse: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
        item: { select: { id: true, code: true, name: true } },
        uom: { select: { id: true, code: true, name: true } },
      },
      orderBy: { committedAt: "desc" },
      skip,
      take,
    }),
  ]);

  return ok(items, { page, pageSize, total });
}
