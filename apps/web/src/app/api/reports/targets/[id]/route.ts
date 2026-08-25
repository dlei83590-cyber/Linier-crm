import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/reports/targets/:id —— 删除经营目标（软删，reports:edit）
 * 目标仅静态配置数据：软删（deletedAt + isActive=false），同键可重新创建。
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "reports:edit");
  if (denied) return denied;
  requestLog(request, user?.id, "reports.targets.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  const existing = await prisma.reportTarget.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return failNotFound(ERROR_CODES.REPORT_TARGET_NOT_FOUND, "经营目标不存在");

  await prisma.reportTarget.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false, updatedById: user?.id ?? null, version: { increment: 1 } },
  });

  await writeAuditLog({
    actorId: user?.id,
    action: "reports.targets.delete",
    entityType: "reportTarget",
    entityId: id,
    beforeData: {
      period: existing.period,
      dimensionType: existing.dimensionType,
      dimensionValue: existing.dimensionValue,
      targetAmount: existing.targetAmount.toString(),
    },
    ...meta,
  });

  return ok({ id, deleted: true });
}
