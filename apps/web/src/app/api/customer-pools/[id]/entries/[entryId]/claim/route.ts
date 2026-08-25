import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission, requestMeta, writeAuditLog } from "@/lib/api-helpers";
import { ok, fail, failValidation, failNotFound, failConflict } from "@/lib/api/response";
import { handleServerError } from "@/lib/api/server-error";
import { ERROR_CODES } from "@/lib/api/errors";
import { requestLog } from "@/lib/api/logger";
import { writeDomainEvent } from "@/lib/domain-events/writer";
import { matchCustomerPools } from "@/lib/customer-pool/match";
import { z } from "zod";

export const dynamic = "force-dynamic";

const claimSchema = z.object({});

/**
 * POST /api/customer-pools/:poolId/entries/:entryId/claim — 挑入公海客户
 *
 * 事务：SELECT ... FOR UPDATE 锁 entry → validate IN_POOL → validate BP active → validate owner user active
 *   → create CustomerOwnership → entry=CLAIMED → Outbox CustomerPoolEntryClaimed 同事务
 * DB 兜底：并发双 claim → CustomerOwnership_one_active_per_partner P2002 → 409 POOL_CLAIM_CONFLICT
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "customer-pool:assign");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-ownership.claim");

  const { id: poolId, entryId } = await params;
  const meta = requestMeta(request);
  const parsed = claimSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());

  const pool = await prisma.customerPool.findFirst({ where: { id: poolId, deletedAt: null } });
  if (!pool) return failNotFound(ERROR_CODES.POOL_NOT_FOUND, "公海池不存在");

  const ownerId = user?.id ?? null;
  if (!ownerId) return fail(ERROR_CODES.AUTHENTICATION_ERROR, "无法确定归属人", 401);

  let result: { entryId: string; ownershipId: string; ownerId: string; businessPartnerId: string };
  try {
    result = await prisma.$transaction(async (tx) => {
      // 行锁：同客户并发 claim 串行化（先例 domain-events/consumer.ts FOR UPDATE）
      const locked = await tx.$queryRaw<Array<{ id: string; status: string; businessPartnerId: string }>>(
        Prisma.sql`SELECT "id", "status", "businessPartnerId" FROM "CustomerPoolEntry" WHERE "id" = ${entryId} AND "poolId" = ${poolId} AND "deletedAt" IS NULL FOR UPDATE`,
      );
      const entry = locked[0];
      if (!entry) throw new Error("ENTRY_NOT_FOUND");
      if (entry.status !== "IN_POOL") throw new Error("NOT_CLAIMABLE");

      const bp = await tx.businessPartner.findFirst({
        where: { id: entry.businessPartnerId, deletedAt: null },
        select: { id: true },
      });
      if (!bp) throw new Error("PARTNER_INACTIVE");

      const ownership = await tx.customerOwnership.create({
        data: {
          businessPartnerId: entry.businessPartnerId,
          entryId,
          ownerId,
          claimedById: user?.id ?? null,
          createdById: user?.id ?? null,
          updatedById: user?.id ?? null,
        },
      });

      await tx.customerPoolEntry.update({
        where: { id: entryId },
        data: { status: "CLAIMED", updatedById: user?.id ?? null, version: { increment: 1 } },
      });

      await writeDomainEvent(tx, {
        eventType: "CustomerPoolEntryClaimed",
        aggregateType: "CustomerPoolEntry",
        aggregateId: entryId,
        payload: {
          entryId,
          ownershipId: ownership.id,
          poolId,
          businessPartnerId: entry.businessPartnerId,
          ownerId,
          claimedBy: user?.id ?? null,
        },
        idempotencyKey: "CustomerPoolEntryClaimed|" + ownership.id,
      });

      return { entryId, ownershipId: ownership.id, ownerId, businessPartnerId: entry.businessPartnerId };
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "ENTRY_NOT_FOUND") return failNotFound(ERROR_CODES.POOL_ENTRY_NOT_FOUND, "池条目不存在");
    if (msg === "NOT_CLAIMABLE") return failConflict(ERROR_CODES.POOL_ENTRY_NOT_CLAIMABLE, "条目不在可挑入状态（非 IN_POOL）");
    if (msg === "PARTNER_INACTIVE") return fail(ERROR_CODES.POOL_ENTRY_NOT_CLAIMABLE, "客户已删除/停用，不能挑入", 409);
    if (e !== null && typeof e === "object" && (e as { code?: unknown }).code === "P2002") {
      return failConflict(ERROR_CODES.POOL_CLAIM_CONFLICT, "该客户已有有效归属（并发冲突）");
    }
    return handleServerError(request, user?.id, "customer-ownership.claim", e);
  }

  await writeAuditLog({
    actorId: user?.id,
    action: "customer-ownership.claim",
    entityType: "customerOwnership",
    entityId: result.ownershipId,
    afterData: { entryId: result.entryId, ownerId: result.ownerId, poolId },
    ...meta,
  });

  // 客户负责人变更后触发自动匹配（DEPARTMENT 触碰规则：owner.departmentId → 部门公海；best-effort 不回滚 claim）
  await matchCustomerPools(result.businessPartnerId).catch((err) => {
    console.error("[customer-pool] claim 后 matchCustomerPools best-effort 失败（不影响 claim）:", err);
  });

  return ok(result, undefined, 201);
}
