import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { ok, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/** GET /api/audit-logs/:id（审计详情，含 before/after 数据快照） */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "audit:view");
  if (denied) return denied;
  requestLog(request, user?.id, "audit-log.get");

  const { id } = await params;
  const log = await prisma.auditLog.findUnique({
    where: { id },
    include: { actor: { select: { id: true, email: true, name: true } } },
  });
  if (!log) {
    return failNotFound(ERROR_CODES.NOT_FOUND, "审计日志不存在");
  }
  return ok(log);
}
