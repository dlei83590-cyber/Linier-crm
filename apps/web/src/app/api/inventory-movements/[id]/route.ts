import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { requestLog } from "@/lib/api/logger";
import { ok, failNotFound } from "@/lib/api/response";

export const dynamic = "force-dynamic";

/**
 * GET /api/inventory-movements/:id（单条库存流水详情，只读；Inventory Read Model Gate FINAL）
 * Trace / Audit 用途：完整展示不可变账本事实（来源链 sourceType/sourceId/sourceLineId + movementGroupId + reversal/correction 引用）。
 * 权限：inventory-movement:view。
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await authenticate(request);
  const denied = requirePermission(user, "inventory-movement:view");
  if (denied) return denied;
  requestLog(request, user?.id, "inventory-movement.get");

  const movement = await prisma.inventoryMovement.findUnique({
    where: { id },
    include: {
      warehouse: { select: { id: true, name: true } },
      location: { select: { id: true, name: true } },
      item: { select: { id: true, code: true, name: true } },
      uom: { select: { id: true, code: true, name: true } },
    },
  });
  if (!movement) return failNotFound();
  return ok(movement);
}
