import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failConflict, failNotFound, fail } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/quotations/:id/convert（报价 → Sales Order 转换，Sprint 4A 预留接口）
 * 必须 status=ACCEPTED 且未转换（convertedAt/salesOrderId 为空）。
 * Sprint 4A 仅保留接口：转换逻辑在 Sprint 4B Sales Order Foundation 落地，当前返回 501。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  // convert 映射现有动作（CTO：新动作不破坏 RBAC 规范）
  const denied = requirePermission(user, "quotation:approve");
  if (denied) return denied;
  requestLog(request, user?.id, "quotation.convert");

  const { id } = await params;
  const meta = requestMeta(request);

  const quotation = await prisma.quotation.findFirst({ where: { id, deletedAt: null } });
  if (!quotation) return failNotFound(ERROR_CODES.QUOTATION_NOT_FOUND, "报价单不存在");
  if (quotation.status !== "ACCEPTED") {
    return failConflict(ERROR_CODES.QUOTATION_INVALID_STATE, "仅 ACCEPTED 状态可转换 Sales Order");
  }
  if (quotation.convertedAt || quotation.salesOrderId) {
    return failConflict(ERROR_CODES.QUOTATION_ALREADY_CONVERTED, "报价已转换，禁止重复转换");
  }

  // 预留：Sprint 4B 实现 Quotation → SalesOrder（convertedAt/convertedById/salesOrderId 回写）
  await writeAuditLog({
    actorId: user?.id,
    action: "quotation.convert",
    entityType: "quotation",
    entityId: id,
    afterData: { status: "CONVERTED_PENDING", note: "Sprint 4B 实现" },
    ...meta,
  });

  return fail(ERROR_CODES.QUOTATION_INVALID_STATE, "Quotation → Sales Order 转换将在 Sprint 4B 实现（预留接口）", 501);
}
