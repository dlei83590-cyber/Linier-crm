import type { NextRequest } from 'next/server';
import { authenticate, requirePermission, requestMeta } from '@/lib/api-helpers';
import { ok, failValidation } from '@/lib/api/response';
import { requestLog } from '@/lib/api/logger';
import { runInventoryConsumer } from '@/lib/inventory-ledger/consumer';

export const dynamic = 'force-dynamic';

/**
 * POST /api/inventory-ledger/consume —— **Inventory Consumer 触发端点（Sprint 6A，CTO #7588）**
 * 消费 PENDING/retryable Outbox（WAREHOUSE_RECEIPT_POSTED → IN / PURCHASE_RETURN_RETURNED → OUT）：
 * claim（FOR UPDATE SKIP LOCKED）→ PROCESSING + lease → validate payload / resolve source →
 * 五元幂等 → 锁五维 StockProjection → OUT 禁负库存 → INSERT Movement + UPSERT Projection +
 * MARK Outbox PROCESSED 同事务 → 发布 InventoryMovementCommitted（best-effort）。
 * 幂等安全：重复触发不会重复入账（五元 UNIQUE + 预检）。供 cron/手动触发；返回批次统计。
 */
export async function POST(request: NextRequest) {
  const user = await authenticate(request);
  const denied = requirePermission(user, 'inventory-ledger:consume');
  if (denied) return denied;
  requestLog(request, user?.id, 'inventory-ledger.consume');
  const meta = requestMeta(request);

  const body = await request.json().catch(() => null);
  const limitRaw = typeof body === 'object' && body !== null ? (body as { limit?: unknown }).limit : undefined;
  let limit: number | undefined;
  if (typeof limitRaw === 'number' && Number.isInteger(limitRaw) && limitRaw > 0) {
    limit = Math.min(limitRaw, 200); // 单轮 claim 上限保护
  } else if (limitRaw !== undefined) {
    return failValidation({ limit: 'limit 必须为正整数（可选，默认 20，上限 200）' });
  }

  const result = await runInventoryConsumer(limit);
  return ok(result, undefined, 200);
}
