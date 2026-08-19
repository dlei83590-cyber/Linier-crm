import { Prisma } from '@prisma/client';

/**
 * Sprint 5C-2 / 通用 Domain Event Outbox Writer（CTO 建议：事件总线落地，GL 解锁前置）
 *
 * 职责：在业务事实事务内原子写 OutboxMessage（复用 6A 表），保证业务事实 + 事件 Outbox 同事务成功或同事务失败。
 * 与 6A Inventory Outbox 的差异：本 writer 是通用领域事件通道（5C-1/5C-2 会计事件 + 未来业务事件），
 * 载荷对齐 EVENTS.md；不承载库存原子身份（库存链仍走 inventory-ledger/outbox-writer）。
 *
 * 幂等：idempotencyKey 为业务事件自然键（如 SupplierCreditDebitNoteApplied|{cnDnId}），@unique 防重复入队
 * （重复写 → P2002 → 事务回滚，符合同事务失败）。
 */

export interface DomainEventEnvelope {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}

/** 在业务事务内写一条通用领域事件 Outbox 消息（幂等键唯一；重复 → P2002 → 事务回滚） */
export async function writeDomainEvent(tx: Prisma.TransactionClient, envelope: DomainEventEnvelope) {
  await tx.outboxMessage.create({
    data: {
      eventType: envelope.eventType,
      aggregateType: envelope.aggregateType,
      aggregateId: envelope.aggregateId,
      payload: envelope.payload as object,
      idempotencyKey: envelope.idempotencyKey,
    },
  });
}