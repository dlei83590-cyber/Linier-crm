import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const unreceiveSchema = z.object({
  changeReason: z.string().max(500).optional(),
});

/**
 * POST /api/purchase-receipts/:id/unreceive —— 收货回退（RECEIVED → DRAFT；用户指令 2026-08-21 层层回退）
 * 回滚：各 GR 行 accepted 数量从 PO Line receivedQty 扣减 + remainingReceiveQty 重算（max(quantity - receivedQty, 0)）。
 * 前置：无已入库（warehouseReceipts）无检验（inspections）——已入库/已检验禁止回退。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "purchase-receipt:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "purchase-receipt.unreceive");

  const { id } = await params;
  const parsed = unreceiveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { changeReason } = parsed.data;
  const meta = requestMeta(request);

  const existing = await prisma.purchaseReceipt.findFirst({
    where: { id, deletedAt: null },
    include: { lines: { where: { deletedAt: null } } },
  });
  if (!existing) return failNotFound(ERROR_CODES.PURCHASE_RECEIPT_NOT_FOUND, "收货单不存在");
  if (existing.status !== "RECEIVED") {
    return failConflict(ERROR_CODES.PURCHASE_RECEIPT_INVALID_STATE, "仅 RECEIVED（已收货）状态可反收货");
  }
  const whrCount = await prisma.warehouseReceipt.count({ where: { purchaseReceiptId: id, deletedAt: null } });
  if (whrCount > 0) {
    // 集成在仓库收货中退货（用户指令 2026-08-21）：入库行已全部 RETURNED 退货 → 允许反收货（退货+反收货一键完成）
    const whrLines = await prisma.warehouseReceiptLine.findMany({
      where: { warehouseReceipt: { purchaseReceiptId: id, deletedAt: null }, deletedAt: null },
      select: { id: true, quantity: true },
    });
    if (whrLines.length > 0) {
      const totalWhr = whrLines.reduce((s, l) => s.plus(l.quantity), new Prisma.Decimal(0));
      const returnedAgg = await prisma.purchaseReturnLine.aggregate({
        where: {
          sourceRefType: "WAREHOUSE_RECEIPT_LINE",
          sourceWarehouseReceiptLineId: { in: whrLines.map((l) => l.id) },
          purchaseReturn: { status: "RETURNED", deletedAt: null },
          deletedAt: null,
        },
        _sum: { quantity: true },
      });
      const totalReturned = returnedAgg._sum.quantity ?? new Prisma.Decimal(0);
      if (totalReturned.lt(totalWhr)) {
        return failConflict(
          ERROR_CODES.PURCHASE_RECEIPT_INVALID_STATE,
          `关联 ${whrCount} 张入库单且未全部退货，禁止反收货（请在仓库收货中完成退货）`,
        );
      }
      // 全部已退货 → 允许反收货（回滚履约投影）
    } else {
      return failConflict(ERROR_CODES.PURCHASE_RECEIPT_INVALID_STATE, `关联 ${whrCount} 张入库单，禁止反收货（请先处理入库）`);
    }
  }
  const inspCount = await prisma.inspection.count({
    where: { purchaseReceiptLine: { purchaseReceiptId: id }, deletedAt: null },
  });
  if (inspCount > 0) {
    return failConflict(ERROR_CODES.PURCHASE_RECEIPT_INVALID_STATE, `关联 ${inspCount} 张检验单，禁止反收货（请先处理检验）`);
  }

  await prisma.$transaction(async (tx) => {
    // 回滚 PO Line 投影（receivedQty -= accepted；remainingReceiveQty 重算 max(quantity - newReceivedQty, 0)）
    for (const rl of existing.lines) {
      if (!rl.purchaseOrderLineId) continue;
      const pol = await tx.purchaseOrderLine.findFirst({ where: { id: rl.purchaseOrderLineId, deletedAt: null } });
      if (!pol) continue;
      const accepted = rl.quantity.minus(rl.rejectedOnReceiptQty ?? new Prisma.Decimal(0));
      const newReceived = pol.receivedQty.minus(accepted);
      const remaining = pol.quantity.minus(newReceived).gt(0) ? pol.quantity.minus(newReceived) : new Prisma.Decimal(0);
      await tx.purchaseOrderLine.update({
        where: { id: pol.id },
        data: { receivedQty: newReceived, remainingReceiveQty: remaining, version: { increment: 1 }, updatedById: user!.id },
      });
    }
    // 收货单回 DRAFT（清 receivedAt/receivedById）
    await tx.purchaseReceipt.update({
      where: { id },
      data: { status: "DRAFT", receivedAt: null, receivedById: null, version: { increment: 1 }, updatedById: user!.id },
    });
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "purchase-receipt.unreceive",
    entityType: "purchase-receipt",
    entityId: id,
    afterData: { code: existing.code, status: "DRAFT", changeReason: changeReason ?? "反收货" },
    ...meta,
  });

  return ok({ id, status: "DRAFT" });
}
