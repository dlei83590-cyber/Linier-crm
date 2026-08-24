import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failConflict, failNotFound, failServer } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const cancelSchema = z.object({ version: z.coerce.number().int().positive() });

/** POST /api/production-orders/:id/cancel —— DRAFT/SUBMITTED → CANCELLED（POSTED 不可取消） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  // cancel → :close（对齐 6B cancel→:close 先例）
  const denied = requirePermission(user, "production-order:close");
  if (denied) return denied;
  requestLog(request, user?.id, "production-order.cancel");
  const { id } = await params;
  const meta = requestMeta(request);

  const parsed = cancelSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failConflict(ERROR_CODES.VERSION_CONFLICT, "缺少 version");

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const order = await tx.productionOrder.findFirst({ where: { id, deletedAt: null } });
      if (!order) throw new Error("NOT_FOUND");
      if (order.status === "POSTED") throw new Error("INVALID_STATE");
      if (order.status === "CANCELLED") throw new Error("INVALID_STATE");
      if (order.version !== parsed.data.version) throw new Error("VERSION_CONFLICT");

      const cas = await tx.productionOrder.updateMany({
        where: { id, version: parsed.data.version, status: { in: ["DRAFT", "SUBMITTED"] }, deletedAt: null },
        data: { status: "CANCELLED", updatedById: user!.id, version: { increment: 1 } },
      });
      if (cas.count !== 1) throw new Error("VERSION_CONFLICT");
      return tx.productionOrder.findFirstOrThrow({ where: { id, deletedAt: null } });
    });

    await writeAuditLog({ actorId: user!.id, action: "production-order.cancel", entityType: "productionOrder", entityId: id, afterData: { orderNo: updated.orderNo, status: updated.status, version: updated.version }, ...meta });
    return ok({ id, status: updated.status, version: updated.version });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_FOUND") return failNotFound(ERROR_CODES.PRODUCTION_ORDER_NOT_FOUND, "工单不存在");
    if (msg === "INVALID_STATE") return failConflict(ERROR_CODES.PRODUCTION_ORDER_INVALID_STATE, "仅 DRAFT/SUBMITTED 状态可取消（POSTED 已产生库存事实）");
    if (msg === "VERSION_CONFLICT") return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
    console.error("[production-order.cancel]", e);
    return failServer("取消工单失败");
  }
}
