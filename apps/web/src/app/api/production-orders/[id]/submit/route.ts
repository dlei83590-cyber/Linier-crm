import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failConflict, failNotFound, failServer } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const submitSchema = z.object({ version: z.coerce.number().int().positive() });

/** POST /api/production-orders/:id/submit —— DRAFT → SUBMITTED（提交确认；SUBMITTED ≠ POSTED） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  // submit → :edit（对齐 5B submit→:edit 先例）
  const denied = requirePermission(user, "production-order:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "production-order.submit");
  const { id } = await params;
  const meta = requestMeta(request);

  const parsed = submitSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failConflict(ERROR_CODES.VERSION_CONFLICT, "缺少 version");

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const order = await tx.productionOrder.findFirst({ where: { id, deletedAt: null } });
      if (!order) throw new Error("NOT_FOUND");
      if (order.status === "SUBMITTED") throw new Error("ALREADY_SUBMITTED");
      if (order.status !== "DRAFT") throw new Error("INVALID_STATE");
      if (order.version !== parsed.data.version) throw new Error("VERSION_CONFLICT");
      // 行完整性：至少 1 物料 + 1 成品
      const lineCounts = await tx.productionOrderLine.groupBy({
        by: ["lineType"],
        where: { orderId: id, deletedAt: null },
        _count: { _all: true },
      });
      const material = lineCounts.find((l) => l.lineType === "MATERIAL")?._count._all ?? 0;
      const finished = lineCounts.find((l) => l.lineType === "FINISHED")?._count._all ?? 0;
      if (material < 1 || finished < 1) throw new Error("NO_LINES");

      const cas = await tx.productionOrder.updateMany({
        where: { id, version: parsed.data.version, status: "DRAFT", deletedAt: null },
        data: { status: "SUBMITTED", updatedById: user!.id, version: { increment: 1 } },
      });
      if (cas.count !== 1) throw new Error("VERSION_CONFLICT");
      return tx.productionOrder.findFirstOrThrow({ where: { id, deletedAt: null } });
    });

    await writeAuditLog({ actorId: user!.id, action: "production-order.submit", entityType: "productionOrder", entityId: id, afterData: { orderNo: updated.orderNo, status: updated.status, version: updated.version }, ...meta });
    return ok({ id, status: updated.status, version: updated.version });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_FOUND") return failNotFound(ERROR_CODES.PRODUCTION_ORDER_NOT_FOUND, "工单不存在");
    if (msg === "ALREADY_SUBMITTED") return failConflict(ERROR_CODES.PRODUCTION_ORDER_INVALID_STATE, "工单已提交（幂等拒绝）");
    if (msg === "INVALID_STATE") return failConflict(ERROR_CODES.PRODUCTION_ORDER_INVALID_STATE, "仅 DRAFT 状态可提交");
    if (msg === "VERSION_CONFLICT") return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
    if (msg === "NO_LINES") return failConflict(ERROR_CODES.PRODUCTION_ORDER_NO_LINES, "工单至少需要 1 行物料 + 1 行成品");
    console.error("[production-order.submit]", e);
    return failServer("提交工单失败");
  }
}
