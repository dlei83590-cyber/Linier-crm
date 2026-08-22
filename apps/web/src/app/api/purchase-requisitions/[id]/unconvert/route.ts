import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failConflict, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { createPurchaseRequisitionRevision } from "@/lib/purchase-requisition/helpers";
import { z } from "zod";

export const dynamic = "force-dynamic";

const unconvertSchema = z.object({
  changeReason: z.string().max(500).optional(),
});

/**
 * POST /api/purchase-requisitions/:id/unconvert —— 采购申请回退（CONVERTED → APPROVED；用户指令 2026-08-21 层层回退）
 * 前置：关联 PO 必须已全部删除（无活跃 PO）——否则禁止回退（保持 PO 溯源）。
 * 回退后 PR 回到 APPROVED（可重新转单/编辑），不改 PR 数量/金额事实。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "purchase-requisition:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "purchase-requisition.unconvert");

  const { id } = await params;
  const parsed = unconvertSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const { changeReason } = parsed.data;
  const meta = requestMeta(request);

  const existing = await prisma.purchaseRequisition.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.PURCHASE_REQUISITION_NOT_FOUND, "采购申请不存在");
  if (existing.status !== "CONVERTED") {
    return failConflict(ERROR_CODES.PURCHASE_REQUISITION_INVALID_STATE, "仅 CONVERTED（已转订单）状态可回退");
  }
  const activePoCount = await prisma.purchaseOrder.count({ where: { requisitionId: id, deletedAt: null } });
  if (activePoCount > 0) {
    return failConflict(ERROR_CODES.PURCHASE_REQUISITION_INVALID_STATE, `关联 ${activePoCount} 张未删除采购订单，禁止回退（请先删除/取消 PO）`);
  }

  await prisma.$transaction(async (tx) => {
    await createPurchaseRequisitionRevision(tx, id, changeReason ?? "回退（取消转单）", { status: "APPROVED", previousStatus: "CONVERTED" }, user?.id);
    await tx.purchaseRequisition.update({
      where: { id },
      data: { status: "APPROVED", version: { increment: 1 }, updatedById: user!.id },
    });
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "purchase-requisition.unconvert",
    entityType: "purchase-requisition",
    entityId: id,
    afterData: { code: existing.code, status: "APPROVED" },
    ...meta,
  });

  return ok({ id, status: "APPROVED" });
}
