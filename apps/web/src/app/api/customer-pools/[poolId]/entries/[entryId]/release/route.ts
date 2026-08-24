import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, failValidation, failNotFound, failConflict } from "@/lib/api/response";
import { handleServerError } from "@/lib/api/server-error";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { writeDomainEvent } from "@/lib/domain-events/writer";
import { z } from "zod";

export const dynamic = "force-dynamic";

const releaseSchema = z.object({});

/**
 * POST /api/customer-pools/:poolId/entries/:entryId/release — 释放归属回公海（单一语义，CTO MVP）
 *
 * active ownership.releasedAt=now + entry.status=IN_POOL（回同一池）；单事务 + Outbox CustomerOwnershipReleased。
 * 无 active ownership → 409（无归属可释放）。
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ poolId: string; entryId: string }> },
) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "customer-pool:assign");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-ownership.release");

  const { poolId, entryId } = await params;
  const meta = requestMeta(request);
  const parsed = releaseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const pool = await prisma.customerPool.findFirst({ where: { id: poolId, deletedAt: null } });
  if (!pool) return failNotFound(ERROR_CODES.POOL_NOT_FOUND, "公海池不存在");

  let result: { entryId: string; entryStatus: string; ownershipReleased: boolean };
  try {
    result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string; status: string; businessPartnerId: string }>>(
        Prisma.sql`SELECT "id", "status", "businessPartnerId" FROM "CustomerPoolEntry" WHERE "id" = ${entryId} AND "poolId" = ${poolId} AND "deletedAt" IS NULL FOR UPDATE`,
      );
      const entry = locked[0];
      if (!entry) throw new Error("ENTRY_NOT_FOUND");

      const activeOwnership = await tx.customerOwnership.findFirst({
        where: { entryId, releasedAt: null, deletedAt: null },
        select: { id: true },
      });
      if (!activeOwnership) throw new Error("NOT_RELEASABLE");

      await tx.customerOwnership.update({
        where: { id: activeOwnership.id },
        data: {
          releasedAt: new Date(),
          releasedById: user?.id ?? null,
          releaseReason: "MANUAL_RELEASE",
          updatedById: user?.id ?? null,
          version: { increment: 1 },
        },
      });
      await tx.customerPoolEntry.update({
        where: { id: entryId },
        data: { status: "IN_POOL", releasedAt: null, releasedById: null, releaseReason: null, updatedById: user?.id ?? null, version: { increment: 1 } },
      });
      await writeDomainEvent(tx, {
        eventType: "CustomerOwnershipReleased",
        aggregateType: "CustomerOwnership",
        aggregateId: activeOwnership.id,
        payload: { ownershipId: activeOwnership.id, entryId, poolId, businessPartnerId: entry.businessPartnerId, releasedAt: new Date().toISOString(), releaseReason: "MANUAL_RELEASE" },
        idempotencyKey: "CustomerOwnershipReleased|" + activeOwnership.id,
      });

      return { entryId, entryStatus: "IN_POOL", ownershipReleased: true };
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "ENTRY_NOT_FOUND") return failNotFound(ERROR_CODES.POOL_ENTRY_NOT_FOUND, "池条目不存在");
    if (msg === "NOT_RELEASABLE") return failConflict(ERROR_CODES.POOL_ENTRY_NOT_CLAIMABLE, "无有效归属可释放（条目未 CLAIMED）");
    return handleServerError(request, user?.id, "customer-ownership.release", e);
  }

  await writeAuditLog({
    actorId: user?.id,
    action: "customer-ownership.release",
    entityType: "customerOwnership",
    entityId: result.entryId,
    afterData: { entryId: result.entryId, entryStatus: result.entryStatus, poolId },
    ...meta,
  });

  return ok(result);
}
