import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { ok, failNotFound } from "@/lib/api/response";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/business-partners/:id/pool-status — Customer 360 公海状态聚合（Phase 2C-2）
 *
 * 返回：当前 active entry（所属池/状态/enteredAt/enterReason）+ 当前 active ownership（owner）
 *      + 归属历史（ownership timeline，最多 10 条）。
 * 权限：customer-pool:view。
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "customer-pool:view");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-pool.partner-status");

  const { id } = await params;
  const bp = await prisma.businessPartner.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!bp) return failNotFound(ERROR_CODES.NOT_FOUND, "往来单位不存在");

  const [entry, activeOwnership, ownershipHistory] = await Promise.all([
    prisma.customerPoolEntry.findFirst({
      where: { businessPartnerId: id, status: { not: "RELEASED" }, deletedAt: null },
      select: {
        id: true,
        status: true,
        enteredAt: true,
        enterReason: true,
        pool: { select: { id: true, code: true, name: true, scopeType: true, scopeValue: true } },
      },
      orderBy: { enteredAt: "desc" },
    }),
    prisma.customerOwnership.findFirst({
      where: { businessPartnerId: id, releasedAt: null, deletedAt: null },
      select: { id: true, claimedAt: true, claimedById: true, owner: { select: { id: true, name: true, email: true } } },
    }),
    prisma.customerOwnership.findMany({
      where: { businessPartnerId: id, deletedAt: null },
      select: {
        id: true,
        claimedAt: true,
        releasedAt: true,
        releaseReason: true,
        owner: { select: { id: true, name: true } },
        entry: { select: { poolId: true, pool: { select: { code: true, name: true } } } },
      },
      orderBy: { claimedAt: "desc" },
      take: 10,
    }),
  ]);

  return ok({ entry, activeOwnership, ownershipHistory });
}
