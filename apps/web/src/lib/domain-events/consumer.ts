import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { glPostFromEvent } from '@/lib/gl/posting';

/**
 * 通用 Domain Event Consumer（CTO 建议：事件总线落地，GL 解锁前置）
 *
 * 消费 OutboxMessage 中 status=PENDING 的通用领域事件：
 *   claim（FOR UPDATE SKIP LOCKED，防双 worker）→ PROCESSING + lease
 *   → 分发到注册 handler（当前阶段无真实业务消费者——GL/Notification 未建，事件经 Outbox 可靠持久化即视为已交付）
 *   → MARK PROCESSED（同事务）
 *   失败 → 回 PENDING + 指数退避重试；超过 MAX_ATTEMPTS → DEAD_LETTER（永久失败，人工调查）。
 * 事务边界：handler 副作用 + Outbox PROCESSED 同事务（单条 Outbox 一个事务）。
 *
 * 注：6A 库存链事件（WarehouseReceiptPosted 等）仍走 inventory-ledger/consumer；本 consumer 只消费通用领域事件。
 */

export const DOMAIN_EVENT_BATCH_SIZE = 50;
export const DOMAIN_EVENT_MAX_ATTEMPTS = 10;
export const DOMAIN_EVENT_RETRY_BASE_SECONDS = 5;
export const DOMAIN_EVENT_RETRY_CAP_SECONDS = 300;

/** 库存链事件白名单：这些事件由 inventory-ledger/consumer 消费，本 consumer 跳过 */
const INVENTORY_CHAIN_EVENTS = new Set(['WarehouseReceiptPosted', 'PurchaseReturned', 'InventoryMovementCommitted']);

/** GL 过账消费事件（Sprint 7 Finance 首块，ADR-0033 + ADR-0042）：消费 5C/销售侧会计事件 → 自动过账（同事务） */
const GL_POSTED_EVENTS = new Set([
  'SupplierInvoicePosted',
  'SupplierPaymentApplied',
  'SupplierCreditDebitNoteApplied',
  'SupplierPaymentReversed',
  'GrirAccrued',
  'GrirReversed',
  'InvoiceIssued',
  'ReceiptAllocated',
  'ReceiptAllocationReversed',
]);

interface ClaimedOutboxRow {
  id: string;
  eventType: string;
  aggregateType: string | null;
  aggregateId: string;
  payload: unknown;
}

export interface ConsumeDomainEventResult {
  outboxId: string;
  eventType: string;
  outcome: 'PROCESSED' | 'RETRY' | 'DEAD_LETTER' | 'SKIPPED';
}

/**
 * 运行一轮 Domain Event Consumer。返回本批处理结果；无待处理消息返回空数组。
 */
export async function runDomainEventConsumer(): Promise<ConsumeDomainEventResult[]> {
  const claimed = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<ClaimedOutboxRow[]>(
      Prisma.sql`SELECT "id", "eventType", "aggregateType", "aggregateId", "payload" FROM "OutboxMessage" WHERE "status" = 'PENDING' AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= now()) AND "eventType" NOT IN ('WarehouseReceiptPosted', 'PurchaseReturned', 'InventoryMovementCommitted') ORDER BY "createdAt" ASC LIMIT ${DOMAIN_EVENT_BATCH_SIZE} FOR UPDATE SKIP LOCKED`,
    );
    if (rows.length === 0) return [];
    await tx.outboxMessage.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { status: 'PROCESSING', lockedAt: new Date(), lockedBy: 'domain-event-consumer' },
    });
    return rows;
  });

  const results: ConsumeDomainEventResult[] = [];
  for (const row of claimed) {
    if (INVENTORY_CHAIN_EVENTS.has(row.eventType)) {
      await prisma.outboxMessage.update({ where: { id: row.id }, data: { status: 'PENDING' } });
      results.push({ outboxId: row.id, eventType: row.eventType, outcome: 'SKIPPED' });
      continue;
    }
    try {
      await prisma.$transaction(async (tx) => {
        // GL 过账 handler（Sprint 7，ADR-0033）：与 Outbox PROCESSED 同事务（handler 副作用 + PROCESSED 原子）
        if (GL_POSTED_EVENTS.has(row.eventType)) {
          const payload = (row.payload ?? {}) as Record<string, unknown>;
          const r = await glPostFromEvent(tx, row.eventType, payload);
          if (!r.ok && r.code !== 'UNSUPPORTED_EVENT') {
            throw new Error('GL_POST_FAILED:' + r.code + ':' + r.message);
          }
        }
        await tx.outboxMessage.update({
          where: { id: row.id },
          data: { status: 'PROCESSED', processedAt: new Date(), lastError: null, lockedAt: null, lockedBy: null },
        });
      });
      results.push({ outboxId: row.id, eventType: row.eventType, outcome: 'PROCESSED' });
    } catch (err) {
      const rowNow = await prisma.outboxMessage.findUnique({ where: { id: row.id }, select: { attemptCount: true } });
      const attempts = (rowNow?.attemptCount ?? 0) + 1;
      if (attempts >= DOMAIN_EVENT_MAX_ATTEMPTS) {
        await prisma.outboxMessage.update({
          where: { id: row.id },
          data: { status: 'DEAD_LETTER', lastError: String(err), lockedAt: null, lockedBy: null },
        });
        results.push({ outboxId: row.id, eventType: row.eventType, outcome: 'DEAD_LETTER' });
      } else {
        const backoff = Math.min(DOMAIN_EVENT_RETRY_BASE_SECONDS * 2 ** (attempts - 1), DOMAIN_EVENT_RETRY_CAP_SECONDS);
        await prisma.outboxMessage.update({
          where: { id: row.id },
          data: {
            status: 'PENDING',
            attemptCount: attempts,
            lastError: String(err),
            nextAttemptAt: new Date(Date.now() + backoff * 1000),
            lockedAt: null,
            lockedBy: null,
          },
        });
        results.push({ outboxId: row.id, eventType: row.eventType, outcome: 'RETRY' });
      }
    }
  }
  return results;
}