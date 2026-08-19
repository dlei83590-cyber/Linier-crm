# ADR-0031：Domain Event Outbox（事件总线落地，GL 解锁前置）

- 状态：**Accepted**（CTO 建议执行；2026-08-19）
- 关联：ADR-0030（5C-2）、EVENTS v1.34/1.35、Sprint 6A Outbox（CTO #7469/#7495/#7508 先例）

---

## 背景

5C-1/5C-2 会计事件（SupplierInvoicePosted / GrirConsumed / SupplierCreditDebitNoteApplied / SupplierPaymentApplied）此前经 AuditLog 留痕（Known Risk：事件总线未落地、非事务原子）。GL（Sprint 7）消费这些事件前，需要可靠持久化的事件通道。

## 决策

1. **复用 6A OutboxMessage 表 + 通用 Domain Event 通道**：不新建事件表；`lib/domain-events/writer.ts` 的 `writeDomainEvent(tx, envelope)` 在**业务事务内**原子写 OutboxMessage（业务事实 + 事件同事务成功/失败）。
2. **幂等**：`idempotencyKey = eventType|aggregateId`（5C-2 幂等键：`SupplierCreditDebitNoteApplied|cnDnId`、`SupplierPaymentApplied|paymentId|apOpenItemId`）——@unique 防重复入队，重复写 → P2002 → 事务回滚。
3. **通用 Consumer**（`lib/domain-events/consumer.ts`）：claim（FOR UPDATE SKIP LOCKED 防双 worker）→ PROCESSING + lease → 分发注册 handler（当前阶段无真实业务消费者，事件经 Outbox 可靠持久化即视为交付）→ PROCESSED（同事务）；失败指数退避重试，超限 DEAD_LETTER。库存链事件白名单排除（仍走 inventory-ledger/consumer）。
4. **触发端点**：`POST /api/domain-events/consume`（权限 `domain-event:consume` ∈ SYSTEM_PERMISSIONS，仅 SUPER_ADMIN/ADMIN）——对齐 6A `/api/inventory-ledger/consume` 模式（手动/调度触发）。
5. **AuditLog 兼容**：事件留痕保留（human 可读）；GL/Notification 阶段在 consumer 注册 eventType handler 消费。

## 影响

- 5C-2 事件升级为事务原子可靠持久化（apply 同事务写 Outbox）；GL 解锁前置条件之一达成
- 6A 库存链事件不变（专属通道）；OutboxMessage 表语义扩展为「通用领域事件 + 库存原子」
- 后续：5C-1 事件（SupplierInvoicePosted/GrirConsumed）接入同机制（同一 writer，后续批）

## 后续

- 5C-1 事件 outbox 化（batch 后续）
- GL 阶段注册事件 handler（消费 5C 会计事件过账）
- Notification 消费（事件驱动通知）