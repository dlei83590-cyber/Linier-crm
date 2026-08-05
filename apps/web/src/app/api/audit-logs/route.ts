import { NextRequest } from "next/server";
import type { AuditResult } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { ok, failValidation, parsePagination } from "@/lib/api/response";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/** GET /api/audit-logs（分页 + actorId/entityType/entityId/action/result/requestId 过滤，Sprint 3B Audit 升级） */
export async function GET(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "audit:view");
  if (denied) return denied;
  requestLog(request, user?.id, "audit-log.list");

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip, take } = parsePagination(searchParams);
  const actorId = searchParams.get("actorId")?.trim();
  const entityType = searchParams.get("entityType")?.trim();
  const entityId = searchParams.get("entityId")?.trim();
  const action = searchParams.get("action")?.trim();
  const result = searchParams.get("result")?.trim();
  const requestId = searchParams.get("requestId")?.trim();
  const traceId = searchParams.get("traceId")?.trim();
  const from = searchParams.get("from")?.trim();
  const to = searchParams.get("to")?.trim();

  if (result && !["SUCCESS", "FAILURE", "PARTIAL"].includes(result)) {
    return failValidation({ result: "result 必须为 SUCCESS/FAILURE/PARTIAL" });
  }

  const where = {
    ...(actorId ? { actorId } : {}),
    ...(entityType ? { entityType } : {}),
    ...(entityId ? { entityId } : {}),
    ...(action ? { action: { contains: action } } : {}),
    ...(result ? { result: result as AuditResult } : {}),
    ...(requestId ? { requestId } : {}),
    ...(traceId ? { traceId } : {}),
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to ? { lte: new Date(to) } : {}),
          },
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: { actor: { select: { id: true, email: true, name: true } } },
    }),
  ]);

  return ok(items, { page, pageSize, total });
}
