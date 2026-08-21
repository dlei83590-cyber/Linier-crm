import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failConflict, failNotFound, failServer } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/** POST /api/production-inbounds/:id/submit —— DRAFT → SUBMITTED（提交确认，无审批状态机；CAS version） */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  // submit → :edit（对齐 6B execute→:edit 先例；P-1 seed 注册）
  const denied = requirePermission(user, "production-inbound:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "production-inbound.submit");

  const { id } = await params;
  const meta = requestMeta(request);
  const body = (await request.json().catch(() => null)) as { version?: number } | null;
  const version = typeof body?.version === "number" ? body.version : null;
  if (!version) return failConflict(ERROR_CODES.VERSION_CONFLICT, "缺少 version");

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.productionInbound.updateMany({
        where: { id, version, status: "DRAFT", deletedAt: null },
        data: { status: "SUBMITTED", updatedById: user?.id ?? null, version: { increment: 1 } },
      });
      if (result.count !== 1) {
        const still = await tx.productionInbound.findFirst({ where: { id, deletedAt: null } });
        throw still ? new Error("INVALID_STATE") : new Error("NOT_FOUND");
      }
      return tx.productionInbound.findFirstOrThrow({ where: { id, deletedAt: null } });
    });
    await writeAuditLog({
      actorId: user?.id,
      action: "production-inbound.submit",
      entityType: "productionInbound",
      entityId: id,
      afterData: { inboundNo: updated.inboundNo, status: updated.status },
      ...meta,
    });
    return ok({ id, status: updated.status, version: updated.version });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_FOUND") return failNotFound(ERROR_CODES.PRODUCTION_INBOUND_NOT_FOUND, "生产入库单不存在");
    if (msg === "INVALID_STATE") return failConflict(ERROR_CODES.PRODUCTION_INBOUND_INVALID_STATE, "仅 DRAFT 状态可提交");
    console.error("[production-inbound.submit]", e);
    return failServer("提交生产入库单失败");
  }
}
