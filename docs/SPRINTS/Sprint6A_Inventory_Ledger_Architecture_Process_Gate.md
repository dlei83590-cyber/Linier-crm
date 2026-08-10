# Sprint 6A：Inventory Ledger Architecture & Process Gate（库存账本架构与流程门禁）

- 版本：v0.2（CTO Design Review 90/100 APPROVED WITH CHANGES 落实，待 Re-review）
- 日期：2026-08-10
- 维护者：CIO（JINZA）｜审核：CTO
- 状态：**设计先行——禁止 Schema / Migration 0024 / API**（Re-review 通过后才允许）
- 关联：ADR-0025（Approved with Changes）/ Sprint6A_Inventory_Field_Matrix.md / Sprint6A_CTO_Pending_Decisions.md / EVENTS.md / ADR-0024（5B 已 Implemented，Sprint 5B 核心事实链 CLOSED）

---

## 0. Sprint 6A 范围切分（CTO #7405 拍板）

| 阶段 | 范围 | 状态 |
| --- | --- | --- |
| 5B | 到货→收货→质检→入库→退货 业务事实链（PurchaseReceipt / Inspection / WarehouseReceipt / PurchaseReturn） | ✅ 已合并 main（PR #20，CTO FINAL APPROVED 99/100，`7bd98cb`） |
| **6A** | **Inventory Ledger（库存数量唯一事实源 + Movement 生命周期 + Stock Projection + 批次/序列号账本 + 来源映射 + 幂等/历史不可变 + Transactional Outbox）**（本阶段） | 🔄 设计先行（Re-review 待 CTO 拍板） |
| 6B+ | Costing（移动平均 / FIFO / 成本） | ⬜ 单独 Gate（CTO #7405 + #7458：**Costing 不混入 6A Ledger；第一版连 costSnapshot 也不放**） |
| 5C | Supplier Invoice + AP（三单匹配 / 进项税 / 应付） | ⬜ 未开始 |
| 7B | Payment（付款核销应付） | ⬜ 未开始 |

> **本阶段铁律（CTO #7405 锁死）**：6A Gate 目标**不是先设计"库存表"**，而是先定义**库存事实怎么产生、怎么不可变、怎么被投影**。库存是整个 ERP 最容易出数据一致性事故的地方，必须先拍事实边界，再允许 Schema/Migration。

---

## 1. 现状侦查（已确认，5B 落地事实）

- 5B 核心业务链已 CLOSED：**PO CONFIRMED → PurchaseReceipt RECEIVED → Inspection Completed → WarehouseReceipt POSTED → PurchaseReturn RETURNED**
- **5B 全程 Stock / InventoryMovement = 0 业务写入**（库存事实源未被采购模块提前污染 ✅）
- WarehouseReceipt 是入库业务事实（D10：**Created ≠ Posted，只有 Posted 才触发 6A InventoryMovement(IN)**）
- PurchaseReturned（`WAREHOUSE_RECEIPT_LINE` 来源）= 已入库退货事实（5B 明确**不写 InventoryMovement(OUT)**，留给 6A）
- 批次/序列号/效期 canonical capture point = **WarehouseReceipt 入库层**（P6 Final，5B 已实现）
- 事件已注册（EVENTS.md v1.23）：`WarehouseReceiptPosted` / `PurchaseReturned` / `InspectionCompleted` / `PurchaseReceiptReceived` / PO 投影 2 事件，**全部 ✅，载荷不含库存余额**
- **已知风险（CTO #7045 债务记录）**：事件总线未落地，当前发布是事务后 best-effort（try/catch publish）——6A Gate 已正式拍板：**Transactional Outbox 为 6A 前置能力（P1/P8 Final）**，消除"业务事实成功但库存意图丢失"窗口

---

## 2. 核心原则：InventoryMovement = 库存数量唯一事实源（Single Source of Truth）

| 规则 | 锁死 |
| --- | --- |
| **唯一事实源** | `InventoryMovement` = 库存数量的**唯一业务事实**。任何库存数量变化都必须是一笔（或一组）InventoryMovement |
| **单层原子事实** | **一行 `InventoryMovement` = 一个不可变库存原子事实**（不做 Header/Line 两层）。未来 Transfer/Conversion 需要多笔编组时增加 `movementGroupId`，而不是建 Header/Line 两层模型（CTO #7458 拍板） |
| **投影非事实** | `Stock` / `OnHandQty` **只能是投影**（由 Movement 聚合而来），不能成为独立业务事实、不能直接写入 |
| **业务模块禁直写（CTO 红线）** | **业务模块不得直接创建 InventoryMovement**。必须通过 **Inventory Ledger service / command 层**，以受支持的 `sourceType + sourceId + sourceLineId + movementRole + movementAtomKey` 生成 Movement。否则 Purchase / Sales / Transfer / Count / Conversion 会各自写库存表，事实源再次分裂 |
| **幂等（CTO #7458 + #7469 Blocking ① 修正）** | canonical 幂等键 = **`sourceType + sourceId + sourceLineId + movementRole + movementAtomKey`**（DB UNIQUE）。一个 source line 可合法产生多笔原子 Movement（Transfer 同行 → SOURCE_OUT + DESTINATION_IN；Conversion 同来源 → CONSUME + PRODUCE；**serial-managed 每 serial 一条**），因此必须加 `movementRole` + **`movementAtomKey`**（非 serial = BULK、serial = serialNo）区分；**Reversal/Correction 拥有自己的 source/action identity，不得与原 Movement 共用幂等身份** |
| **历史不可变** | Movement 一旦 COMMITTED：**不可修改、不可删除**；纠错只能**追加 Reversal / Correction Movement** |
| **库存维度** | Warehouse + Location + Item + Batch/Serial **共同决定库存维度** |

> 类比：InventoryMovement ≈ 会计"流水账（Ledger）"；Stock Projection ≈ "科目余额"。余额永远由流水聚合而来，业务只写流水。

---

## 3. 来源映射（Source Mapping）—— 5B 事实 → 6A Movement

| 业务来源（sourceType） | 触发事实 | movementRole | 方向 | 说明 |
| --- | --- | --- | --- | --- |
| `WAREHOUSE_RECEIPT_POSTED` | `WarehouseReceiptPosted`（status=POSTED） | `IN` | **IN** | 入库过账即入库事实生效点（D10）；逐行生成（sourceLineId = WarehouseReceiptLine.id）；**已入库数量进入库存账** |
| `PURCHASE_RETURN_RETURNED`（**仅 WAREHOUSE_RECEIPT_LINE 来源行**） | `PurchaseReturned`（disposition 任意） | `OUT` | **OUT** | 已入库退货 → 库存减少；逐行（sourceLineId = PurchaseReturnLine.id）；**P9：按原 WarehouseReceiptLine 的 warehouse/location/batch/serial 精确 OUT**（不得 FIFO/任意批次替代） |
| `PURCHASE_RETURN_RETURNED`（RECEIPT_LINE / INSPECTION 来源行） | `PurchaseReturned` | — | **无 Movement** | **未入库退货不产生库存 Movement**（从未入库，无库存可减）；只记录退货事实 |
| 未来：SALES / SALES_RETURN / TRANSFER / CONVERSION / STOCK_COUNT / ADJUSTMENT | 各业务事实（后续 Sprint） | SOURCE_OUT / DESTINATION_IN / CONSUME / PRODUCE / ADJUSTMENT 等 | IN/OUT/双边 | 必须同样走 Inventory Ledger command 层 + `sourceType+sourceId+sourceLineId+movementRole+movementAtomKey` 幂等键 |

> **红线**：来源映射表是 6A 的契约。新增业务来源必须先扩展此表并经 CTO 批准，**不允许业务模块绕过映射自行建 Movement**。

---

## 4. Movement 生命周期与历史不可变

| 阶段 | 规则 |
| --- | --- |
| 创建 | Movement 由 Inventory Ledger command 层生成（业务模块调用 command，不直接建表） |
| **创建即 COMMITTED（P2 Final）** | **6A 第一版不需要 PENDING Movement**——创建即 COMMITTED（幂等键校验通过 → status=COMMITTED + committedAt/ById）；**需要暂存的是业务单据，不是 Ledger** |
| 不可变 | COMMITTED 后：**禁止 UPDATE / DELETE**（数据库层约束 + API 层无此能力） |
| 纠错 | 只能**追加**：`REVERSAL`（冲销原 Movement，方向相反、引用 reversalOfMovementId）或 `CORRECTION`（修正）；**Reversal/Correction 拥有自己的 source/action identity，不与原 Movement 共用幂等身份** |
| 幂等 | 重复消费同一事件 → 幂等键（`sourceType+sourceId+sourceLineId+movementRole+movementAtomKey`）命中 → 跳过（不重复生成） |
| 编组 | 未来 Transfer/Conversion 多笔 Movement 用 **`movementGroupId`** 编组（单层模型，无 Header/Line） |

> **对齐 5B 纪律**：只有 COMMITTED 才发布 `InventoryMovementCommitted`（P10 Final 保留；**不发布** `InventoryStockProjectionChanged`——避免把投影变成业务事实）。

---

## 5. 库存维度与批次/序列号账本

| 维度 | 规则 |
| --- | --- |
| 维度键 | Warehouse + Location + Item + Batch/Serial（共同决定一条库存投影） |
| **Batch/Serial canonical source** | **继承 5B WarehouseReceipt（P6 Final）**——库存模块**不得重新创建第二份批次/序列号追溯事实**；6A 只引用 WarehouseReceiptLine 已采集的 batchNo/serialNos/mfgDate/expDate |
| **Serial 原子化（CTO #7458 Blocking ② 修正）** | **Serial-managed Item 必须原子化**：每个 serial 形成**独立 Movement 事实**（`serialNo = exactly one`、`quantity = 1`）；**Ledger canonical 字段用 `serialNo?` 单值，不是 `serialNos[]`**。5B WarehouseReceipt 可继续批量采集 `serialNos[]`，**6A command 层负责展开成多个库存事实**（一个 Movement 无法稳定投影成 10 个独立 serial dimension；部分退货/调拨一个 serial/冲销一个 serial 需自然引用） |
| 非序列号管理 | Movement `quantity > 0`、`serialNo = null` |
| 批次账本 | Movement 行携带 `batchNo / serialNo`（从来源事实继承/展开）；批次维度库存投影 = 按批次聚合 Movement |

> **红线**：6A 建的是"Movement + 投影"，**不重建批次/序列号主数据**（那仍是 5B WarehouseReceipt 的 canonical 职责）。

---

## 6. Transfer / Conversion / Count 规则（本期只拍规则，不建表；P5 Final）

| 业务 | 规则 | 禁止 |
| --- | --- | --- |
| **Transfer（调拨）** | **成对 Movement**：`SOURCE_OUT + DESTINATION_IN`（同 `movementGroupId` 编组、同事务/同批提交，原子性）；只调投影不调事实 | ❌ 不能只改两个余额 |
| **Conversion（物料转换/组装拆分）** | **一组 Consume/Produce Movement**：`CONSUME`（原料 OUT）+ `PRODUCE`（成品 IN），按配方比例，同 `movementGroupId` 编组 | ❌ 不能用一个 Adjustment 代替 |
| **Stock Count（盘点）** | 只生成**盘盈/盘亏 Adjustment Movement**（差异 = 实盘 - 投影，正→盘盈 IN / 负→盘亏 OUT） | ❌ 不能直接"改库存数" |

> **P5 Final（CTO #7458）**：6A **只建 Ledger + Projection + Outbox**；Transfer/Conversion/Count **本期只锁规则，不建业务单据 Schema**（后续 Sprint 再建）。

---

## 7. ReservedQty 与 Costing 边界（P3/P4 Final）

| 项 | 边界（CTO #7458 Final） |
| --- | --- |
| **ReservedQty（预留量）** | **不进入 6A**。`availableQty` / `reservedQty` **从 6A canonical Projection 字段移除**（本阶段不作为 canonical 库存字段；预留可在更高层/后续 Sprint 处理） |
| **Costing（成本）** | **不进入 6A**。**第一版连 `costSnapshot` 也不放**（避免 6B 边界污染）；移动平均 / FIFO 单独 Gate（6B+） |

> 红线：6A Movement / Projection **不含任何成本字段**；成本属 6B+ 单独 Gate。

---

## 8. 事件驱动与事务一致性 —— P1/P8：Transactional Outbox + 同事务 Stock Projection（CTO #7458 Final）

### 8.1 问题（CTO #7405 明确提出）

5B 当前模式：业务事实提交成功后发布事件（try/catch best-effort）。
**如果 WarehouseReceipt 已 POSTED，但 `WarehouseReceiptPosted` 事件发布失败，库存是否永远没入账？**

> **答案必须是否定的**。库存不能接受"偶尔少一笔"。Inventory Ledger 的完整性**不能依赖 best-effort 事件发布**。

### 8.2 方案（P1 Final，CTO #7458 拍板）

```
业务事实事务（如 WarehouseReceipt POST 事务）
  ├─ 写入业务事实（WarehouseReceipt.status = POSTED）
  ├─ **同事务写入 Outbox 表**（eventType / aggregateId / payload / idempotencyKey）
  └─ 事务提交（业务事实 + Outbox 原子落库）
        ↓
Inventory consumer（独立事务）
  ├─ 读取 Outbox 待处理记录（PROCESSING 租约）
  ├─ 幂等检查（sourceType+sourceId+sourceLineId+movementRole）
  └─ 单事务（P7 Final）：
       BEGIN
       INSERT InventoryMovement(COMMITTED)
       UPSERT StockProjection（onHandQty += signed movement qty）
       MARK Outbox PROCESSED
       COMMIT
```

### 8.3 一致性模型（P7 Final，CTO #7458 Blocking ④ 修正）

- **Materialized Stock Projection + Movement 同事务更新 + Ledger Reconciliation**
- **Movement 是事实源；Projection 是缓存/投影，但与 Movement commit 原子更新**（同一数据库事务）
- ❌ 不采用"Movement 先提交、以后另一个异步 consumer 再更新 StockProjection"的双重最终一致链（避免库存查询长期存在第二层延迟和失败窗口）
- **Reconciliation**：`SUM(COMMITTED Movement)` vs `StockProjection.onHandQty`（按维度键）；发现差异 → **报警/修复投影，不修改历史 Movement**

### 8.4 Outbox 状态机（P8 Final，CTO #7458 Blocking ③ 修正）

- **状态语义必须区分"投递/消费/投影"**——只有 **Inventory consumer 成功幂等落 Movement 后**，才允许确认该库存事件已消费完成
- 状态机：`PENDING → PROCESSING → PROCESSED`；失败：`PROCESSING → PENDING(retry)` 或超阈值 → `DEAD_LETTER`
- 元数据：`attemptCount / nextAttemptAt / lockedAt / lockedBy / lastError / processedAt`（多 worker / worker crash / 重试 / 毒消息语义）
- **处理成功不删除 Outbox**——保留审计记录
- P8 Final：平台级持久 Outbox

> **红线**：6A 上线前 Transactional Outbox 必须落地（P1/P8 Final，不再容忍 best-effort 事件发布）；业务事实 + Outbox 写入同事务；Outbox 保留审计不删除。

---

## 9. 事件注册（6A，先注册后开发，对齐 EVENTS.md 纪律；P10 Final）

| eventType | 触发时机 | 载荷要点 |
| --- | --- | --- |
| `InventoryMovementCommitted` | Movement COMMITTED（事务后发） | movementId / sourceType / sourceId / sourceLineId / movementRole / direction(IN\|OUT) / warehouseId / locationId / itemId / batchNo / serialNo / quantity / committedAt；**不含投影余额** |
| ~~`InventoryStockProjectionChanged`~~ | **暂不发布（P10 Final）** | 避免把 projection 变成业务事实 |

> 6A 事件同样遵循：**业务动作事件**；载荷**不含余额**（余额是投影，不是事实，事件不承载投影语义——避免下游把投影当事实）。

---

## 10. 边界红线（6A 实现范围）

- ❌ 不创建 Schema / Migration 0024 / Prisma model / API（本 Gate 只出设计文档）
- ❌ 业务模块**不得直接创建 InventoryMovement**（必须走 Inventory Ledger command 层 + 受支持 sourceType/sourceId/sourceLineId/movementRole）
- ❌ 不直接写 Stock / OnHandQty（只能由 Movement 聚合投影；投影与 Movement 同事务更新）
- ❌ Movement COMMITTED 后不得 UPDATE / DELETE（纠错只能 Reversal / Correction 追加）
- ❌ 不重建批次/序列号主数据（canonical = 5B WarehouseReceipt）；serial 原子化（每 serial 独立 Movement，quantity=1）
- ❌ ReservedQty / availableQty / reservedQty 不进 6A（P3 Final）
- ❌ Costing（含 costSnapshot）不进入 6A（P4 Final）
- ❌ 不实现 Transfer / Conversion / Count 的 API 与 Schema（本期只锁规则，P5 Final）
- ❌ 禁止负库存：所有 OUT 在锁定库存维度后必须保证 `onHandQty >= outQty`；不足稳定拒绝（P6 Final）
- ❌ 5C（Supplier Invoice / 三单匹配 / AP）不实现

## 11. CTO Design Review 后动作

1. CTO 6A Design Review（#7458）已拍板 P1-P10 全部 Final（见 Sprint6A_CTO_Pending_Decisions.md）；ADR-0025 → **Approved with Changes**
2. **Re-review 核 8 项 Design Consistency Fixes**（幂等键+movementRole / serialNo 原子化 / Outbox 状态机 / Projection 同事务+reconciliation / P1-P10 Final / Movement 单层+movementGroupId / 删 costSnapshot / 删 availableQty+reservedQty）；**Schema Review 5 项（#7469）**：+movementAtomKey 五元幂等键 / StockProjection 五维 DB 唯一（NULLS NOT DISTINCT）/ onHandQty>=0 CHECK / committedAt NOT NULL / Reversal 单次冲销
3. 全部 PASS 后才放行 **6A Schema / Migration 0024**（只建 InventoryMovement + StockProjection + Outbox；**不允许 Transfer/Conversion/Count/Costing/ReservedQty 越界**）
4. 实现阶段仍走 commit → push → GitHub CI（禁止本地高资源验证）
