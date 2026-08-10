# ADR-0025：Inventory Ledger — Single Source of Truth（库存账本单一事实源决策）

- 状态：**Approved with Changes（2026-08-10，CTO 6A Design Review 90/100——8 项 Design Consistency Fixes 已落实；Schema/Migration 0024 待 Re-review 后放行）**
- 关联：Sprint6A_Inventory_Ledger_Architecture_Process_Gate.md / Sprint6A_Inventory_Field_Matrix.md / Sprint6A_CTO_Pending_Decisions.md / EVENTS.md / ADR-0024（5B 已 Implemented，Sprint 5B 核心事实链 CLOSED）
- 决策人：CIO（JINZA）提案 ｜ 审核：CTO
- 背景：Sprint 5B 已完成"到货 → 收货 → 质检 → 入库 → 退货"业务事实链（PR #20 合并 main，`7bd98cb`），全程 **Stock / InventoryMovement = 0 业务写入**（6A 唯一事实源未被污染）。6A 需正式建立库存数量事实源——**不是先设计"库存表"，而是先定义"库存事实怎么产生、怎么不可变、怎么被投影"**（CTO #7405 锁死）。库存是 ERP 最易出数据一致性事故的领域，必须先拍事实边界再允许 Schema。

## 核心决策（Final，CTO #7458 拍板）

### D1：InventoryMovement = 库存数量唯一事实源（Single Source of Truth）

- **`InventoryMovement` = 库存数量的唯一业务事实**。任何库存数量变化都必须是一笔（或一组）InventoryMovement
- `Stock` / `OnHandQty` **只能是投影**（由 Movement 聚合），不能成为独立业务事实、不能直接写入
- **一行 `InventoryMovement` = 一个不可变库存原子事实**（单层模型，无 Header/Line 两层）；未来 Transfer/Conversion 多笔编组用 **`movementGroupId`**（CTO #7458）
- 类比：InventoryMovement ≈ 会计流水账（Ledger）；Stock Projection ≈ 科目余额。**余额永远由流水聚合而来，业务只写流水**

### D2：业务模块不得直接创建 InventoryMovement（CTO 红线）

- **业务模块不得直接创建 InventoryMovement**
- 必须通过 **Inventory Ledger service / command 层**，以受支持的 `sourceType + sourceId + sourceLineId + movementRole` 生成 Movement
- 否则 Purchase / Sales / Transfer / Count / Conversion 会各自写库存表，事实源再次分裂
- 来源映射表（D3）是契约；新增业务来源必须先扩展映射并经 CTO 批准

### D3：来源映射（Source Mapping）

| sourceType | 触发事实 | movementRole | 方向 | 说明 |
| --- | --- | --- | --- | --- |
| `WAREHOUSE_RECEIPT_POSTED` | `WarehouseReceiptPosted`（status=POSTED） | `IN` | **IN** | 入库过账即入库事实生效点（D10）；逐行（sourceLineId = WarehouseReceiptLine.id） |
| `PURCHASE_RETURN_RETURNED`（仅 WAREHOUSE_RECEIPT_LINE 来源行） | `PurchaseReturned` | `OUT` | **OUT** | 已入库退货 → 库存减少；逐行（sourceLineId = PurchaseReturnLine.id）；**P9：按原 WarehouseReceiptLine 的 warehouse/location/batch/serial 精确 OUT** |
| `PURCHASE_RETURN_RETURNED`（RECEIPT_LINE / INSPECTION 来源行） | `PurchaseReturned` | — | **无 Movement** | **未入库退货不产生库存 Movement**（从未入库，无库存可减） |
| 未来：SALES / SALES_RETURN / TRANSFER / CONVERSION / STOCK_COUNT / ADJUSTMENT | 各业务事实（后续 Sprint） | SOURCE_OUT / DESTINATION_IN / CONSUME / PRODUCE / ADJUSTMENT | IN/OUT/双边 | 同样走 command 层 + 幂等键 |

### D4：幂等（Idempotency，CTO #7458 Blocking ① 修正）

- **canonical 幂等键 = `sourceType + sourceId + sourceLineId + movementRole`**（数据库唯一约束）
- 一个 source line 可合法产生**多笔 Movement**（Transfer 同行 → SOURCE_OUT + DESTINATION_IN；Conversion 同来源 → CONSUME + PRODUCE），因此必须加 `movementRole` 区分
- **Reversal / Correction 拥有自己的 source/action identity，不得与原 Movement 共用幂等身份**
- 同一业务来源重复生成（事件重放 / 重复调用）→ 幂等键命中 → 跳过（不重复建 Movement）
- 幂等是 Inventory consumer 的硬要求（库存不能重复入账）

### D5：历史不可变（Immutability）

- Movement 一旦 **COMMITTED：不可修改、不可删除**（数据库层约束 + API 层无此能力）
- 纠错只能**追加**：`REVERSAL`（冲销原 Movement，方向相反、引用 reversalOfMovementId）或 `CORRECTION`（修正）
- 对齐 5B 纪律：只有 COMMITTED 才发布 `InventoryMovementCommitted`

### D6：库存维度（Inventory Dimension）

- **Warehouse + Location + Item + Batch/Serial 共同决定库存维度**
- 维度键 = (warehouseId, locationId, itemId, batchNo, serialNo)
- Stock Projection 按维度键聚合 Movement

### D7：批次/序列号账本（Batch/Serial Ledger，CTO #7458 Blocking ② 修正）

- **Batch/Serial canonical source = 继承 5B WarehouseReceipt（P6 Final）**
- 6A **不得重新创建第二份批次/序列号追溯事实**；只引用 WarehouseReceiptLine 已采集的 batchNo/serialNos/mfgDate/expDate
- **Serial-managed Item 原子化**：每个 serial 形成独立 Movement 事实（`serialNo = exactly one`、`quantity = 1`）；**Ledger canonical 字段 = `serialNo?`（单值），不是 `serialNos[]`**；5B 可继续批量采集 `serialNos[]`，**6A command 层负责展开成多个库存事实**
- 非序列号管理：Movement `quantity > 0`、`serialNo = null`
- 批次账本 = 按批次聚合 Movement；序列号追踪 = 按 serial 聚合

### D8：Transfer = 成对 Movement（CTO #7405/#7458 锁死）

- **调拨必须是成对 Movement：`SOURCE_OUT + DESTINATION_IN`**（同 `movementGroupId` 编组、同事务提交，原子性）
- ❌ 禁止只改两个余额

### D9：Conversion = Consume/Produce Movement 组（CTO #7405/#7458 锁死）

- **物料转换/组装拆分 = 一组 Consume/Produce Movement**：`CONSUME`（原料 OUT）+ `PRODUCE`（成品 IN），按配方比例，同 `movementGroupId` 编组
- ❌ 禁止用一个 Adjustment 代替

### D10：Stock Count = 盘盈/盘亏 Adjustment Movement（CTO #7405 锁死）

- **盘点只生成盘盈/盘亏 Adjustment Movement**（差异 = 实盘 - 投影，正→盘盈 IN / 负→盘亏 OUT）
- ❌ 禁止直接"改库存数"

### D11：ReservedQty 不进入 6A（P3 Final，CTO #7458 拍板）

- **ReservedQty 不进入 6A**；`availableQty` / `reservedQty` **从 6A canonical Projection 字段移除**（本阶段不作为 canonical 库存字段；预留可在更高层/后续 Sprint 处理）

### D12：Costing 不进入 6A（P4 Final，CTO #7458 拍板）

- **Costing 不进入 6A**；**第一版连 `costSnapshot` 也不放**（避免 6B 边界污染）
- **移动平均 / FIFO 单独 Gate（6B+）**
- 6A Movement / Projection **不含任何成本字段**

### D13：Transactional Outbox（P1/P8 Final，CTO #7458 拍板）

- **问题（CTO #7405）**：WarehouseReceipt 已 POSTED 但 `WarehouseReceiptPosted` 事件发布失败 → 库存是否永远没入账？**答案必须是否定的**——库存不能接受"偶尔少一笔"
- **方案（P1 Final）**：
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
- **Outbox 状态机（P8 Final，Blocking ③ 修正）**：`PENDING → PROCESSING → PROCESSED`；失败 `PROCESSING → PENDING(retry)` 或超阈值 → `DEAD_LETTER`；带 `attemptCount / nextAttemptAt / lockedAt / lockedBy / lastError / processedAt`；**处理成功不删除 Outbox（保留审计）**；平台级持久 Outbox
- **Stock Projection 一致性（P7 Final，Blocking ④ 修正）**：**Materialized Stock Projection + Movement 同事务更新 + Ledger Reconciliation**（Movement=事实源，Projection=缓存但原子更新；❌ 不用"先 Movement 后异步更新投影"的双重最终一致链）；Reconciliation：`SUM(COMMITTED Movement)` vs `StockProjection.onHandQty`，差异 → 报警/修复投影，**不修改历史 Movement**
- **红线**：6A 上线前 Transactional Outbox 必须落地（不再容忍 best-effort 事件发布）；业务事实 + Outbox 写入必须同事务

## Final Decisions（CTO 6A Design Review #7458 拍板结果）

| # | Pending | CTO Final 决策 | 结论 |
| --- | --- | --- | --- |
| P1 | Movement 写入方式 | **Transactional Outbox**：业务事实 + Outbox 同事务；Inventory consumer 独立事务消费 | ✅ Final |
| P2 | Movement 状态机 | **创建即 COMMITTED**（6A 第一版无 PENDING；需暂存的是业务单据，不是 Ledger） | ✅ Final |
| P3 | ReservedQty 是否进入 6A | **不进入**；`availableQty` 本阶段不作为 canonical 库存字段 | ✅ Final |
| P4 | Costing 边界 | **不进入 6A**；第一版连 `costSnapshot` 也不放（避免 6B 边界污染） | ✅ Final |
| P5 | Transfer/Conversion/Count Schema | **只建 Ledger + Projection + Outbox**；Transfer/Conversion/Count 本期只锁规则，不建业务单据 Schema | ✅ Final |
| P6 | 负库存策略 | **禁止负库存**：OUT 锁定库存维度后必须 `onHandQty >= outQty`；不足稳定拒绝 | ✅ Final |
| P7 | Stock Projection 存储形态 | **物化 StockProjection + 与 Movement 同事务更新 + reconciliation** | ✅ Final |
| P8 | Outbox 机制 | **平台级持久 Outbox**；`PENDING/PROCESSING/PROCESSED/DEAD_LETTER` + retry/lease metadata；保留记录不删除 | ✅ Final |
| P9 | 已入库退货 OUT 规则 | **按原 WarehouseReceiptLine 的 warehouse/location/batch/serial 精确 OUT**；不得 FIFO/任意批次替代 | ✅ Final |
| P10 | 6A 事件命名 | `InventoryMovementCommitted` 保留；**暂不发布** `InventoryStockProjectionChanged`（避免把投影变成业务事实） | ✅ Final |

> **8 项 Design Consistency Fixes（CTO #7458）全部已落实**：① 幂等键 + movementRole ② serialNo 原子化（quantity=1，单值 serialNo）③ Outbox PROCESSING/lease/retry/dead-letter ④ StockProjection 同事务更新 + reconciliation ⑤ P1-P10 全部 Final ⑥ Movement 单层原子事实 + 可选 movementGroupId ⑦ 删除 costSnapshot ⑧ availableQty/reservedQty 从 canonical Projection 移除。
