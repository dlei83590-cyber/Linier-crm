import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failNotFound, failConflict, failServer } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/credit-debit-notes/:id —— 删除贷/借项通知单（软删）
 * 状态门禁（用户指令：贷/项也应支持删除）：DRAFT / CANCELLED / REVERSED 可删；
 * SUBMITTED 未生效 → 409（先取消）；APPLIED 已生效 → 409（先反冲再删，金额事实不可直接抹除）。
 * 同事务软删：header + lines + adjustments（全部置 deletedAt/isActive=false）。
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "credit-debit-note:delete");
  if (denied) return denied;
  requestLog(request, user?.id, "credit-debit-note.delete");

  const { id } = await params;
  const meta = requestMeta(request);

  try {
    const note = await prisma.creditDebitNote.findFirst({ where: { id, deletedAt: null } });
    if (!note) return failNotFound(ERROR_CODES.CN_DN_NOT_FOUND, "贷/借项通知单不存在");
    if (note.status === "APPLIED") {
      return failConflict(ERROR_CODES.CN_DN_INVALID_STATE, "已 APPLIED 生效，禁止直接删除（先反冲减后再删除）");
    }
    if (note.status === "SUBMITTED") {
      return failConflict(ERROR_CODES.CN_DN_INVALID_STATE, "SUBMITTED 提交中，禁止删除（先取消再删除）");
    }
    // DRAFT / CANCELLED / REVERSED 可删

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.creditDebitNote.update({
        where: { id },
        data: { deletedAt: now, isActive: false, updatedById: user!.id },
      });
      await tx.creditDebitNoteLine.updateMany({
        where: { creditDebitNoteId: id, deletedAt: null },
        data: { deletedAt: now, isActive: false },
      });
      await tx.invoiceAdjustment.updateMany({
        where: { sourceNoteId: id, deletedAt: null },
        data: { deletedAt: now, isActive: false },
      });
    });

    await writeAuditLog({
      actorId: user?.id,
      action: "credit-debit-note.delete",
      entityType: "creditDebitNote",
      entityId: id,
      afterData: { code: note.code, status: note.status, noteType: note.noteType },
      ...meta,
    });

    return ok({ id, deleted: true });
  } catch (e) {
    console.error("[credit-debit-note.delete]", e);
    return failServer("删除贷/借项通知单失败");
  }
}
