import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate, requirePermission } from "@/lib/api-helpers";
import { ok, failValidation } from "@/lib/api/response";
import { requestLog } from "@/lib/api/logger";
import { syncPartnerToPool, type SyncOutcome } from "@/lib/customer-pool/evaluate-and-sync";
import { z } from "zod";

export const dynamic = "force-dynamic";

const sweepSchema = z.object({
  limit: z.number().int().min(1).max(500).optional(), // 本批处理候选上限（防一次全表长事务；幂等可重复调用）
});

/**
 * POST /api/customer-pools/sweep — 公海规则全量重算（后台/外部 cron 触发）
 *
 * 权限：customer-pool:consume（SYSTEM_PERMISSIONS，仅 SUPER_ADMIN/ADMIN）
 * - 分批（每候选独立事务，syncPartnerToPool 内部事务）→ 不允许一次全表长事务
 * - idempotent：已有 active entry/ownership 跳过（UNCHANGED）
 * - 返回统计：scanned / entered / unchanged / ambiguous / blocked / failed
 */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, "customer-pool:consume");
  if (denied) return denied;
  requestLog(request, user?.id, "customer-pool.sweep");

  const parsed = sweepSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error.flatten());
  const limit = parsed.data.limit ?? 200;

  const candidates = await prisma.businessPartner.findMany({
    where: { deletedAt: null, type: { in: ["CUSTOMER", "BOTH"] } },
    select: { id: true },
    orderBy: { id: "asc" }, // sorted（锁序红线：collect → dedupe → sort）
    take: limit,
  });

  const stats = { scanned: 0, entered: 0, unchanged: 0, ambiguous: 0, blocked: 0, failed: 0 };
  for (const c of candidates) {
    stats.scanned += 1;
    const outcome: SyncOutcome = await syncPartnerToPool(c.id, user?.id);
    switch (outcome) {
      case "ENTERED":
        stats.entered += 1;
        break;
      case "AMBIGUOUS":
        stats.ambiguous += 1;
        break;
      case "INELIGIBLE":
        stats.blocked += 1;
        break;
      case "FAILED":
        stats.failed += 1;
        break;
      default:
        stats.unchanged += 1; // UNCHANGED / NO_MATCH
    }
  }

  return ok({ scanned: stats.scanned, entered: stats.entered, unchanged: stats.unchanged, ambiguous: stats.ambiguous, blocked: stats.blocked, failed: stats.failed, batchSize: candidates.length, hasMore: candidates.length === limit });
}
