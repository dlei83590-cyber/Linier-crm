import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failConflict, failNotFound, failServer } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

const activateSchema = z.object({
  version: z.coerce.number().int().positive(),
});

/**
 * POST /api/boms/:id/activate —— DRAFT/ARCHIVED → ACTIVE + isDefault
 * - 同成品仅一个 ACTIVE：激活时将同成品其他 ACTIVE 配方置为 ARCHIVED（业务排他，多版本语义）
 * - 权限：bom:approve（激活 = 配方生效审批）
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "bom:approve");
  if (denied) return denied;
  requestLog(request, user?.id, "bom.activate");
  const { id } = await params;
  const meta = requestMeta(request);

  const parsed = activateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failConflict(ERROR_CODES.VERSION_CONFLICT, "缺少 version");
  const actorId = user!.id;

  try {
    const activated = await prisma.$transaction(async (tx) => {
      const bom = await tx.itemBom.findFirst({ where: { id, deletedAt: null } });
      if (!bom) throw new Error("NOT_FOUND");
      if (bom.status === "ACTIVE") throw new Error("ALREADY_ACTIVE");
      if (bom.status !== "DRAFT" && bom.status !== "ARCHIVED") throw new Error("INVALID_STATE");
      if (bom.version !== parsed.data.version) throw new Error("VERSION_CONFLICT");

      // 同成品其他 ACTIVE 配方 → ARCHIVED（ACTIVE 唯一）
      await tx.itemBom.updateMany({
        where: { finishedItemId: bom.finishedItemId, status: "ACTIVE", deletedAt: null, id: { not: id } },
        data: { status: "ARCHIVED", isDefault: false, updatedById: actorId },
      });
      const cas = await tx.itemBom.updateMany({
        where: { id, version: parsed.data.version, deletedAt: null },
        data: { status: "ACTIVE", isDefault: true, approvedById: actorId, approvalStatus: "APPROVED", updatedById: actorId, version: { increment: 1 } },
      });
      if (cas.count !== 1) throw new Error("VERSION_CONFLICT");
      return tx.itemBom.findFirstOrThrow({ where: { id, deletedAt: null } });
    });

    await writeAuditLog({
      actorId,
      action: "bom.activate",
      entityType: "itemBom",
      entityId: id,
      afterData: { bomNo: activated.bomNo, status: activated.status, isDefault: activated.isDefault },
      ...meta,
    });
    return ok({ id, status: activated.status, isDefault: activated.isDefault, version: activated.version });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_FOUND") return failNotFound(ERROR_CODES.BOM_NOT_FOUND, "配方不存在");
    if (msg === "ALREADY_ACTIVE") return failConflict(ERROR_CODES.BOM_ALREADY_ACTIVE, "配方已是生效状态（幂等拒绝）");
    if (msg === "INVALID_STATE") return failConflict(ERROR_CODES.BOM_INVALID_STATE, "仅 DRAFT/ARCHIVED 状态可激活");
    if (msg === "VERSION_CONFLICT") return failConflict(ERROR_CODES.VERSION_CONFLICT, "版本冲突，请刷新后重试");
    console.error("[bom.activate]", e);
    return failServer("激活配方失败");
  }
}
