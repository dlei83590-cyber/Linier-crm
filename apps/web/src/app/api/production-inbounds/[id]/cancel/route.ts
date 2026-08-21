import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failConflict, failNotFound, failServer } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/** POST /api/production-inbounds/:id/cancel —— DRAFT/SUBMITTED → CANCELLED（CAS version；POSTED 禁止取消） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  // cancel → :close（P-1 seed 注册）
  const denied = requirePermission(user, "production-inbound:close");
  if (denied) return denied;
  requestLog(request, user?.id, "production-inbound.cancel");

  const { id } = await params;
  const meta = requestMeta(request);
  const body = (await request.json().catch(() => null)) as { version?: number } | null;
  const version = typeof body?.version === "number" ? body.version : null;
  if (!version) return failConflict(ERROR_CODES.VERSION_CONFLICT, "缺少 version");

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.productionInbound.updateMany({
        where: { id, version, status: { in: ["DRAFT", "SUBMITTED"] }, deletedAt: null },
        data: { status: "CANCELLED", updatedById: user?.id ?? null, version: { increment: 1 } },
      });
      if (result.count !== 1) {
        const still = await tx.productionInbound.findFirst({ where: { id, deletedAt: null } });
        if (!still) throw new Error("NOT_FOUND");
        throw still.status === "POSTED" ? new Error("ALREADY_POSTED") : new Error("INVALID_STATE");
      }
      return tx.productionInbound.findFirstOrThrow({ where: { id, deletedAt: null } });
    });
    await writeAuditLog({
      actorId: user?.id,
      action: "production-inbound.cancel",
      entityType: "productionInbound",
      entityId: id,
      afterData: { inboundNo: updated.inboundNo, status: updated.status },
      ...meta,
    });
    return ok({ id, status: updated.status, version: updated.version });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_FOUND") return failNotFound(ERROR_CODES.PRODUCTION_INBOUND_NOT_FOUND, "生产入库单不存在");
    if (msg === "ALREADY_POSTED") return failConflict(ERROR_CODES.PRODUCTION_INBOUND_ALREADY_POSTED, "已过账的生产入库单不可取消");
    if (msg === "INVALID_STATE") return failConflict(ERROR_CODES.PRODUCTION_INBOUND_INVALID_STATE, "仅 DRAFT/SUBMITTED 状态可取消");
    console.error("[production-inbound.cancel]", e);
    return failServer("取消生产入库单失败");
  }
}
