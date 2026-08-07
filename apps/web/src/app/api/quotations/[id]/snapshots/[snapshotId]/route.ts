import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { ok, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/** GET /api/quotations/:id/snapshots/:snapshotId（快照详情，只读；禁止 POST/PATCH/DELETE） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; snapshotId: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "quotation-snapshot:view");
  if (denied) return denied;
  requestLog(request, user?.id, "quotation-snapshot.get");

  const { id, snapshotId } = await params;
  const snapshot = await prisma.quotationSnapshot.findFirst({
    where: { id: snapshotId, quotationId: id, deletedAt: null },
  });
  if (!snapshot) return failNotFound(ERROR_CODES.QUOTATION_NOT_FOUND, "快照不存在");

  return ok(snapshot);
}
