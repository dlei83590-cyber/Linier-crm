import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";
import { createPurchaseOrderRevision } from "@/lib/purchase-order/helpers";

export const dynamic = "force-dynamic";

const unconvertSchema = z.object({
  changeReason: z.string().max(500).optional(),
});

/**
 * POST /api/purchase-orders/:id/unconvert —— 采购订单回退（CONFIRMED → APPROVED；用户指令 2026-08-21 层层回退）
 * 前置：无收货（status 非 PARTIALLY_RECEIVED/RECEIVED）、无退货——已收货/已退货禁止回退。
 * 回退后 PO 回到 APPROVED（可重新确认/编辑），清 confirmedAt/confirmedById；不改金额事实。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "purchase-order:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "purchase-order.unconvert");

  const { id } = await params;
  const parsed = unconvertSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { changeReason } = parsed.data;
  const meta = requestMeta(request);

  const existing = await prisma.purchaseOrder.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.PURCHASE_ORDER_NOT_FOUND, "采购订单不存在");
  if (existing.status !== "CONFIRMED") {
    return failConflict(ERROR_CODES.PURCHASE_ORDER_INVALID_STATE, "仅 CONFIRMED（已下单）状态可回退");
  }
  const grCount = await prisma.purchaseReceipt.count({ where: { purchaseOrderId: id, deletedAt: null } });
  if (grCount > 0) {
    return failConflict(ERROR_CODES.PURCHASE_ORDER_INVALID_STATE, `关联 ${grCount} 张收货单，禁止回退（请先处理收货）`);
  }
  const rtCount = await prisma.purchaseReturn.count({ where: { purchaseOrderId: id, deletedAt: null } });
  if (rtCount > 0) {
    return failConflict(ERROR_CODES.PURCHASE_ORDER_INVALID_STATE, `关联 ${rtCount} 张退货单，禁止回退（请先处理退货）`);
  }

  await prisma.$transaction(async (tx) => {
    await createPurchaseOrderRevision(tx, id, changeReason ?? "回退（取消下单）", { status: "APPROVED", previousStatus: "CONFIRMED" }, user?.id);
    await tx.purchaseOrder.update({
      where: { id },
      data: { status: "APPROVED", confirmedAt: null, confirmedById: null, version: { increment: 1 }, updatedById: user!.id },
    });
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "purchase-order.unconvert",
    entityType: "purchase-order",
    entityId: id,
    afterData: { code: existing.code, status: "APPROVED" },
    ...meta,
  });

  return ok({ id, status: "APPROVED" });
}
