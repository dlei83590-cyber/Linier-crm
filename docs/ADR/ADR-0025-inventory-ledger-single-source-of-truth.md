# ADR-0025：Inventory Ledger — Single Source of Truth（库存账本单一事实源决策）

- 状态：**Proposed（2026-08-10，Sprint 6A Inventory Ledger Architecture & Process Gate——待 CTO Design Review 拍板；未批准前禁止 Schema / Migration 0024 / API）**
- 关联：Sprint6A_Inventory_Ledger_Architecture_Process_Gate.md / Sprint6A_Inventory_Field_Matrix.md / Sprint6A_CTO_Pending_Decisions.md / EVENTS.md / ADR-0024（5B 已 Implemented，Sprint 5B 核心事实链 CLOSED）
- 决策人：CIO（JINZA）提案 ｜ 审核：CTO
- 背景：Sprint 5B 已完成"到货 → 收货 → 质检 → 入库 → 退货"业务事实链（PR #20 合并 main，`7bd98cb`），全程 **Stock / InventoryMovement = 0 业务写入**（6A 唯一事实源未被污染）。6A 需正式建立库存数量事实源——**不是先设计"库存表"，而是先定义"库存事实怎么产生、怎么不可变、怎么被投影"**（CTO #7405 锁死）。库存是 ERP 最易出数据一致性事故的领域，必须先拍事实边界再允许 Schema。

## 核心决策（草案，CTO 倾向确认中）

### D1：InventoryMovement = 库存数量唯一事实源（Single Source of Truth）

- **`InventoryMovement` = 库存数量的唯一业务事实**。任何库存数量变化都必须是一笔（或一组）InventoryMovement
- `Stock` / `OnHandQty` / `AvailableQty` **只能是投影**（由 Movement 聚合），不能成为独立业务事实、不能直接写入
- 类比：InventoryMovement ≈ 会计流水账（Ledger）；Stock Projection ≈ 科目余额。**余额永远由流水聚合而来，业务只写流水**

### D2：业务模块不得直接创建 InventoryMovement（CTO 红线）

- **业务模块不得直接创建 InventoryMovement**
- 必须通过 **Inventory Ledger service / command 层**，以受支持的 `sourceType + sourceId + sourceLineId` 生成 Movement
- 否则 Purchase / Sales / Transfer / Count / Conversion 会各自写库存表，事实源再次分裂
- 来源映射表（D3）是契约；新增业务来源必须先扩展映射并经 CTO 批准

### D3：来源映射（Source Mapping）

| sourceType | 触发事实 | 方向 | 说明 |
| --- | --- | --- | --- |
| `WAREHOUSE_RECEIPT_POSTED` | `WarehouseReceiptPosted`（status=POSTED） | **IN** | 入库过账即入库事实生效点（D10）；逐行（sourceLineId = WarehouseReceiptLine.id） |
| `PURCHASE_RETURN_RETURNED`（仅 WAREHOUSE_RECEIPT_LINE 来源行） | `PurchaseReturned` | **OUT** | 已入库退货 → 库存减少；逐行（sourceLineId = PurchaseReturnLine.id） |
| `PURCHASE_RETURN_RETURNED`（RECEIPT_LINE / INSPECTION 来源行） | `PurchaseReturned` | **无 Movement** | **未入库退货不产生库存 Movement**（从未入库，无库存可减） |
| 未来：SALES / SALES_RETURN / TRANSFER / CONVERSION / STOCK_COUNT / ADJUSTMENT | 各业务事实（后续 Sprint） | IN/OUT/双边 | 同样走 command 层 + 幂等键 |

### D4：幂等（Idempotency）

- **唯一幂等键 = `sourceType + sourceId + sourceLineId`**（数据库唯一约束）
- 同一业务来源重复生成（事件重放 / 重复调用）→ 幂等键命中 → 跳过（不重复建 Movement）
- 幂等是 Inventory consumer 的硬要求（库存不能重复入账）

### D5：历史不可变（Immutability）

- Movement 一旦 **COMMITTED：不可修改、不可删除**（数据库层约束 + API 层无此能力）
- 纠错只能**追加**：`REVERSAL`（冲销原 Movement，方向相反、引用 reversalOfMovementId）或 `CORRECTION`（修正）
- 对齐 5B 纪律：DRAFT 创建不发领域事件；只有 COMMITTED 才发布库存事件

### D6：库存维度（Inventory Dimension）

- **Warehouse + Location + Item + Batch/Serial 共同决定库存维度**
- 维度键 = (warehouseId, locationId, itemId, batchNo, serialNo)
- Stock Projection 按维度键聚合 Movement

### D7：批次/序列号账本（Batch/Serial Ledger）

- **Batch/Serial canonical source = 继承 5B WarehouseReceipt（P6 Final）**
- 6A **不得重新创建第二份批次/序列号追溯事实**；只引用 WarehouseReceiptLine 已采集的 batchNo/serialNos/mfgDate/expDate
- 批次账本 = 按批次聚合 Movement；序列号追踪 = 按 serial 聚合（每序列号一条库存状态）

### D8：Transfer = 成对 Movement（CTO #7405 锁死）

- **调拨必须是成对 Movement：SOURCE OUT + DESTINATION IN**（同事务/同批提交，原子性）
- ❌ 禁止只改两个余额

### D9：Conversion = Consume/Produce Movement 组（CTO #7405 锁死）

- **物料转换/组装拆分 = 一组 Consume/Produce Movement**：Consume 原料（OUT）+ Produce 成品（IN），按配方比例
- ❌ 禁止用一个 Adjustment 代替

### D10：Stock Count = 盘盈/盘亏 Adjustment Movement（CTO #7405 锁死）

- **盘点只生成盘盈/盘亏 Adjustment Movement**（差异 = 实盘 - 投影，正→盘盈 IN / 负→盘亏 OUT）
- ❌ 禁止直接"改库存数"

### D11：ReservedQty 单独拍板（CTO #7405 锁死）

- **ReservedQty（预留量）是否进入 6A 单独拍板（P3），不能顺手加**
- 默认倾向：**不进入 6A 核心 Ledger**（预留是可用性投影的一部分，可后续 Sprint 处理）

### D12：Costing 不混入 6A Ledger（CTO #7405 锁死）

- **Costing 不混进 6A Ledger**；除非只保留 `costSnapshot / costReference`（引用来源单据的成本快照字段，不做计算）
- **移动平均 / FIFO 单独 Gate（6B+）**
- 6A Movement 行可带 costSnapshot（只读引用/快照），禁止在 6A 做成本计算逻辑

### D13：Transactional Outbox（P1，本 Gate 第一号决策）

- **问题（CTO #7405）**：WarehouseReceipt 已 POSTED 但 `WarehouseReceiptPosted` 事件发布失败 → 库存是否永远没入账？**答案必须是否定的**——库存不能接受"偶尔少一笔"
- **方案（默认采纳，待 CTO 拍板）**：
  ```
  业务事实事务（如 WarehouseReceipt POST 事务）
    ├─ 写入业务事实（status = POSTED）
    ├─ 同事务写入 Outbox（eventType / aggregateId / payload / idempotencyKey）
    └─ 事务提交（业务事实 + Outbox 原子落库）
          ↓
  Inventory consumer（独立事务）
    ├─ 读取 Outbox 未发送记录
    ├─ 幂等消费（sourceType + sourceId + sourceLineId）
    └─ 调用 Inventory Ledger command 层生成 Movement（COMMITTED）
  ```
- 三选一（同步同事务 / Outbox 驱动 / 异步消费）→ **默认：业务事实事务 + Outbox 同事务落库 → Inventory consumer 幂等生成 Movement**
- **红线**：6A 上线前 Transactional Outbox 必须落地（提升为 6A 前置能力，不再容忍 best-effort 事件发布）；业务事实 + Outbox 写入必须同事务

## Final Decisions（待 CTO Design Review 拍板）

| # | Pending | CTO 拍板结论（待填） |
| --- | --- | --- |
| P1 | Movement 写入方式（同步同事务 / Outbox / 异步） | 待拍板（默认 Outbox） |
| P2 | Movement 状态机与命名（PENDING/COMMITTED；COMMITTED 语义） | 待拍板 |
| P3 | ReservedQty 是否进入 6A | 待拍板（默认不进入） |
| P4 | Costing 边界（cost snapshot only / 单独 Gate） | 待拍板（默认单独 Gate） |
| P5 | Transfer / Conversion / Count 的 Schema 是否本期建（还是仅拍规则） | 待拍板 |
| P6 | 负库存策略（是否允许临时负库存） | 待拍板 |
| P7 | Stock Projection 存储形态（物化表 vs 视图/聚合查询） | 待拍板 |
| P8 | Outbox 表归属与重放机制（消费确认/死信） | 待拍板 |
| P9 | 已入库退货 OUT 的 Movement 数量与批次继承规则 | 待拍板 |
| P10 | 6A 事件命名（InventoryMovementCommitted / StockProjectionChanged） | 待拍板 |
