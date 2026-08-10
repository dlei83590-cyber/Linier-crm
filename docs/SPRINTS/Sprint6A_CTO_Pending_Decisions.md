# Sprint 6A：CTO Pending Decisions（库存账本待拍板决策清单）

- 版本：v0.2（CTO 6A Design Review #7458 拍板结果——P1-P10 全部 Final）
- 日期：2026-08-10
- 维护者：CIO（JINZA）提案 ｜ 审核：CTO
- 关联：Sprint6A_Inventory_Ledger_Architecture_Process_Gate.md / ADR-0025（Approved with Changes）/ Sprint6A_Inventory_Field_Matrix.md / EVENTS.md / ADR-0024（5B 已 Implemented）

> **Gate 铁律（CTO #7405/#7458）**：6A 是 ERP 最易出数据一致性事故的领域。**Schema/Migration 0024 继续 HOLD**——Re-review 通过后才放行，且**只允许 InventoryMovement + StockProjection + Outbox**，不允许 Transfer/Conversion/Count/Costing/ReservedQty 越界。

---

## P1：Inventory Movement 写入方式 —— ✅ Final（CTO #7458）

**Transactional Outbox**。业务事实 + Outbox 同事务落库 → Inventory consumer 独立事务消费。
```
业务事实事务（如 WarehouseReceipt POST 事务）
  ├─ 写入业务事实（status = POSTED）
  ├─ 同事务写入 Outbox（eventType / aggregateId / payload / idempotencyKey）
  └─ 事务提交（业务事实 + Outbox 原子落库）
        ↓
Inventory consumer（独立事务）
  ├─ 读取 Outbox 待处理记录（PROCESSING 租约）
  ├─ 幂等检查（sourceType+sourceId+sourceLineId+movementRole）
  └─ 单事务：INSERT Movement(COMMITTED) + UPSERT StockProjection + MARK Outbox PROCESSED
```
- **红线**：Transactional Outbox 提升为 6A 前置能力；不再容忍 5B 当前 best-effort 事件发布（库存不能接受"偶尔少一笔"）；业务事实 + Outbox 写入必须同事务

## P2：Movement 状态机与命名 —— ✅ Final（CTO #7458）

**创建即 COMMITTED**。6A 第一版不需要 PENDING Movement；**需要暂存的是业务单据，不是 Ledger**。
`创建（幂等校验）→ COMMITTED + committedAt/ById`；`COMMITTED →（仅通过 Reversal/Correction 追加，不改变原行）`

## P3：ReservedQty 是否进入 6A —— ✅ Final（CTO #7458）

**ReservedQty 不进入 6A**。`availableQty` / `reservedQty` 从 6A canonical Projection 字段移除（本阶段不作为 canonical 库存字段；预留可在更高层/后续 Sprint 处理）。

## P4：Costing 边界 —— ✅ Final（CTO #7458）

**Costing 不进入 6A**。第一版**连 `costSnapshot` 也不放**（避免 6B 边界污染）；移动平均 / FIFO 单独 Gate（6B+）。

## P5：Transfer / Conversion / Count 的 Schema 是否本期建 —— ✅ Final（CTO #7458）

**6A 只建 Ledger + Projection + Outbox**；Transfer/Conversion/Count **本期只锁规则，不建业务单据 Schema**（后续 Sprint 再建）。

## P6：负库存策略 —— ✅ Final（CTO #7458）

**禁止负库存**。所有 OUT 在锁定库存维度后必须保证 `onHandQty >= outQty`；不足**稳定拒绝**（409）。

## P7：Stock Projection 存储形态 —— ✅ Final（CTO #7458）

**物化 StockProjection + 与 Movement 同事务更新 + Ledger Reconciliation**。
- consumer 单事务：`BEGIN → 幂等检查 → INSERT Movement(COMMITTED) → UPSERT StockProjection(onHandQty += signed) → MARK Outbox PROCESSED → COMMIT`
- **Movement 是事实源；Projection 是缓存/投影，但与 Movement commit 原子更新**
- ❌ 不用"Movement 先提交、异步 consumer 再更新 StockProjection"的双重最终一致链
- **Reconciliation**：`SUM(COMMITTED Movement)` vs `StockProjection.onHandQty` → 差异 → 报警/修复投影，**不修改历史 Movement**

## P8：Outbox 表归属与重放机制 —— ✅ Final（CTO #7458）

**平台级持久 Outbox**；状态 `PENDING / PROCESSING / PROCESSED / DEAD_LETTER`；失败 `PROCESSING → PENDING(retry)` 或超阈值 → `DEAD_LETTER`；带 `attemptCount / nextAttemptAt / lockedAt / lockedBy / lastError / processedAt`；**处理成功不删除 Outbox（保留审计记录）**。

## P9：已入库退货 OUT 的 Movement 数量与批次继承 —— ✅ Final（CTO #7458）

**按原 WarehouseReceiptLine 的 warehouse/location/batch/serial 精确 OUT**；**不得 FIFO/任意批次替代**。

## P10：6A 事件命名 —— ✅ Final（CTO #7458）

**`InventoryMovementCommitted` 保留**（Movement COMMITTED 后发布）；**暂不发布** `InventoryStockProjectionChanged`（避免把 projection 变成业务事实）。

---

## 汇总表（CTO 6A Design Review #7458 拍板结果）

| # | Pending | CTO Final 决策 | 结论 |
| --- | --- | --- | --- |
| P1 | Movement 写入方式（同步同事务 / Outbox / 异步） | **Transactional Outbox**：业务事实 + Outbox 同事务；Inventory consumer 独立事务消费 | ✅ Final |
| P2 | Movement 状态机与命名 | **创建即 COMMITTED**（6A 第一版无 PENDING；需暂存的是业务单据，不是 Ledger） | ✅ Final |
| P3 | ReservedQty 是否进入 6A | **不进入**；availableQty 本阶段不作为 canonical 库存字段 | ✅ Final |
| P4 | Costing 边界 | **不进入 6A**；第一版连 costSnapshot 也不放（避免 6B 边界污染） | ✅ Final |
| P5 | Transfer/Conversion/Count Schema | **只建 Ledger + Projection + Outbox**；本期只锁规则不建业务单据 Schema | ✅ Final |
| P6 | 负库存策略 | **禁止负库存**：OUT 锁定维度后 onHandQty >= outQty；不足稳定拒绝 | ✅ Final |
| P7 | Stock Projection 存储形态 | **物化 + 与 Movement 同事务更新 + reconciliation** | ✅ Final |
| P8 | Outbox 归属与重放 | **平台级持久 Outbox**：PENDING/PROCESSING/PROCESSED/DEAD_LETTER + lease/retry metadata；保留记录不删除 | ✅ Final |
| P9 | 已入库退货 OUT 规则 | **按原 WarehouseReceiptLine 的 warehouse/location/batch/serial 精确 OUT**；不得 FIFO/任意批次替代 | ✅ Final |
| P10 | 6A 事件命名 | `InventoryMovementCommitted` 保留；**暂不发布** `InventoryStockProjectionChanged` | ✅ Final |

> **CTO 红线（本 Gate 直接锁定，不待拍板）**：业务模块不得直接创建 InventoryMovement——必须通过 Inventory Ledger service / command 层，以受支持的 `sourceType + sourceId + sourceLineId + movementRole` 生成 Movement。否则 Purchase、Sales、Transfer、Count、Conversion 会各自写库存表，事实源再次分裂。
>
> **8 项 Design Consistency Fixes（CTO #7458）**：① 幂等键 + movementRole ② serialNo 原子化（quantity=1，单值 serialNo）③ Outbox PROCESSING/lease/retry/dead-letter ④ StockProjection 同事务更新 + reconciliation ⑤ P1-P10 全部 Final ⑥ Movement 单层原子事实 + 可选 movementGroupId ⑦ 删除 costSnapshot ⑧ availableQty/reservedQty 从 canonical Projection 移除。**Re-review 只核这 8 项。**
