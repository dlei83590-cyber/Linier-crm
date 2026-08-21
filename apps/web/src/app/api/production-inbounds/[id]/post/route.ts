import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failConflict, failNotFound, failServer } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { applyPostInventoryEffect } from "@/lib/production-inbound/helpers";

export const dynamic = "force-dynamic";

/** POST /api/production-inbounds/:id/post —— DRAFT/SUBMITTED → POSTED（同事务库存效应：半成品 OUT + 产成品 IN + 成本层；CAS + 幂等） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  // post → :edit（对齐 5B post→:edit 先例；P-1 seed 注册）
  const denied = requirePermission(user, "production-inbound:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "production-inbound.post");

  const { id } = await params;
  const meta = requestMeta(request);
  const body = (await request.json().catch(() => null)) as { version?: number } | null;
  const version = typeof body?.version === "number" ? body.version : null;
  if (!version) return failConflict(ERROR_CODES.VERSION_CONFLICT, "缺少 version");
  const actorId = user!.id;

  try {
    const posted = await prisma.$transaction(async (tx) => {
      // ① 读 header + lines（CAS：id + version + status∈{DRAFT,SUBMITTED} 同时命中）
      const inbound = await tx.productionInbound.findFirst({
        where: { id, deletedAt: null },
        include: { lines: { where: { deletedAt: null } } },
      });
      if (!inbound) throw new Error("NOT_FOUND");
      if (inbound.status === "POSTED") throw new Error("ALREADY_POSTED");
      if (inbound.status !== "DRAFT" && inbound.status !== "SUBMITTED") throw new Error("INVALID_STATE");
      if (inbound.version !== version) throw new Error("VERSION_CONFLICT");
      if (inbound.lines.length === 0) throw new Error("NO_LINES");

      // ② 行事实重算（服务端 canonical）：totalQty = ΣtoQty；totalAmount = Σ(unitCost×toQty)
      let totalQty = new Prisma.Decimal(0);
      let totalAmount = new Prisma.Decimal(0);
      const lineFacts = inbound.lines.map((l) => {
        const amount = l.unitCost.mul(l.toQty).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
        totalQty = totalQty.plus(l.toQty);
        totalAmount = totalAmount.plus(amount);
        return { id: l.id, fromItemId: l.fromItemId, fromQty: l.fromQty, toItemId: l.toItemId, toQty: l.toQty, amount };
      });

      // ③ POSTED 库存效应（同事务）：半成品 OUT + 产成品 IN（Movement/Projection/出库成本）+ 产成品入库成本层
      await applyPostInventoryEffect(tx, {
        inboundId: id,
        inboundNo: inbound.inboundNo,
        warehouseId: inbound.warehouseId,
        batchNo: inbound.batchNo,
        actorId,
        occurredAt: new Date().toISOString(),
        lines: lineFacts,
      });

      // ④ CAS 回写终态投影
      const cas = await tx.productionInbound.updateMany({
        where: { id, version, status: { in: ["DRAFT", "SUBMITTED"] }, deletedAt: null },
        data: {
          status: "POSTED",
          totalQty,
          totalAmount,
          postedById: actorId,
          postedAt: new Date(),
          version: { increment: 1 },
          updatedById: actorId,
        },
      });
      if (cas.count !== 1) throw new Error("VERSION_CONFLICT");
      return tx.productionInbound.findFirstOrThrow({ where: { id, deletedAt: null } });
    });

    await writeAuditLog({
      actorId,
      action: "production-inbound.post",
      entityType: "productionInbound",
      entityId: id,
      afterData: { inboundNo: posted.inboundNo, status: posted.status, totalQty: posted.totalQty.toString(), totalAmount: posted.totalAmount.toString() },
      ...meta,
    });
    return ok({ id, status: posted.status, postedAt: posted.postedAt, version: posted.version });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_FOUND") return failNotFound(ERROR_CODES.PRODUCTION_INBOUND_NOT_FOUND, "生产入库单不存在");
    if (msg === "ALREADY_POSTED") return failConflict(ERROR_CODES.PRODUCTION_INBOUND_ALREADY_POSTED, "已过账，禁止重复过账");
    if (msg === "INVALID_STATE") return failConflict(ERROR_CODES.PRODUCTION_INBOUND_INVALID_STATE, "仅 DRAFT/SUBMITTED 状态可过账");
    if (msg === "VERSION_CONFLICT") return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
    if (msg === "NO_LINES") return failConflict(ERROR_CODES.PRODUCTION_INBOUND_NO_LINES, "生产入库单至少需要一行明细");
    if (msg === "InventoryInsufficientStockError") return failConflict(ERROR_CODES.INVENTORY_INSUFFICIENT_STOCK, "半成品库存不足，无法过账");
    if (msg && msg.indexOf("COST_OUT_FAILED") === 0) return failServer("出库成本结转失败：" + msg);
    if (msg && msg.indexOf("COST_IN_FAILED") === 0) return failServer("入库成本层更新失败：" + msg);
    console.error("[production-inbound.post]", e);
    return failServer("过账生产入库单失败");
  }
}
