# Sprint 6A：Inventory Ledger Architecture & Process Gate（库存账本架构与流程门禁）

- 版本：v0.1（草案，待 CTO Design Review）
- 日期：2026-08-10
- 维护者：CIO（JINZA）｜审核：CTO
- 状态：**设计先行——禁止 Schema / Migration 0024 / API**（Gate 批准后才允许）
- 关联：ADR-0025（草案）/ Sprint6A_Inventory_Field_Matrix.md / Sprint6A_CTO_Pending_Decisions.md / EVENTS.md / ADR-0024（5B 已 Implemented，Sprint 5B 核心事实链 CLOSED）

---

## 0. Sprint 6A 范围切分（CTO #7405 拍板）

| 阶段 | 范围 | 状态 |
| --- | --- | --- |
| 5B | 到货→收货→质检→入库→退货 业务事实链（PurchaseReceipt / Inspection / WarehouseReceipt / PurchaseReturn） | ✅ 已合并 main（PR #20，CTO FINAL APPROVED 99/100，`7bd98cb`） |
| **6A** | **Inventory Ledger（库存数量唯一事实源 + Movement 生命周期 + Stock Projection + 批次/序列号账本 + 来源映射 + 幂等/历史不可变 + Transactional Outbox）**（本阶段） | 🔄 设计先行 |
| 6B+ | Costing（移动平均 / FIFO / 成本快照） | ⬜ 单独 Gate（CTO #7405：**Costing 不混入 6A Ledger**，除非只保留 cost snapshot/reference） |
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
- **已知风险（CTO #7045 债务记录）**：事件总线未落地，当前发布是事务后 best-effort（try/catch publish）——6A Gate 必须正式拍板此问题（见 §8）

---

## 2. 核心原则：InventoryMovement = 库存数量唯一事实源（Single Source of Truth）

| 规则 | 锁死 |
| --- | --- |
| **唯一事实源** | `InventoryMovement` = 库存数量的**唯一业务事实**。任何库存数量变化都必须是一笔（或一组）InventoryMovement |
| **投影非事实** | `Stock` / `OnHandQty` / `AvailableQty` **只能是投影**（由 Movement 聚合而来），不能成为独立业务事实、不能直接写入 |
| **业务模块禁直写（CTO 红线）** | **业务模块不得直接创建 InventoryMovement**。必须通过 **Inventory Ledger service / command 层**，以受支持的 `sourceType + sourceId + sourceLineId` 生成 Movement。否则 Purchase / Sales / Transfer / Count / Conversion 会各自写库存表，事实源再次分裂 |
| **幂等** | 同一业务来源必须通过**唯一幂等键**（`sourceType + sourceId + sourceLineId`）防止重复生成 Movement；重复消费 → 幂等跳过（200 但不重复建） |
| **历史不可变** | Movement 一旦 POSTED/COMMITTED：**不可修改、不可删除**；纠错只能**追加 Reversal / Correction Movement** |
| **库存维度** | Warehouse + Location + Item + Batch/Serial **共同决定库存维度** |

> 类比：InventoryMovement ≈ 会计"流水账（Ledger）"；Stock Projection ≈ "科目余额"。余额永远由流水聚合而来，业务只写流水。

---

## 3. 来源映射（Source Mapping）—— 5B 事实 → 6A Movement

| 业务来源（sourceType） | 触发事实 | Movement 方向 | 说明 |
| --- | --- | --- | --- |
| `WAREHOUSE_RECEIPT_POSTED` | `WarehouseReceiptPosted`（status=POSTED） | **IN** | 入库过账即入库事实生效点（D10）；逐行生成（sourceLineId = WarehouseReceiptLine.id）；**已入库数量进入库存账** |
| `PURCHASE_RETURN_RETURNED`（**仅 WAREHOUSE_RECEIPT_LINE 来源行**） | `PurchaseReturned`（disposition 任意） | **OUT** | 已入库退货 → 库存减少；逐行生成（sourceLineId = PurchaseReturnLine.id） |
| `PURCHASE_RETURN_RETURNED`（RECEIPT_LINE / INSPECTION 来源行） | `PurchaseReturned` | **无 Movement** | **未入库退货不产生库存 Movement**（从未入库，无库存可减）；只记录退货事实 |
| 未来：SALES / SALES_RETURN / TRANSFER / CONVERSION / STOCK_COUNT / ADJUSTMENT | 各业务事实（后续 Sprint） | IN/OUT/双边 | 必须同样走 Inventory Ledger command 层 + 幂等键 |

> **红线**：来源映射表是 6A 的契约。新增业务来源必须先扩展此表并经 CTO 批准，**不允许业务模块绕过映射自行建 Movement**。

---

## 4. Movement 生命周期与历史不可变

| 阶段 | 规则 |
| --- | --- |
| 创建 | Movement 由 Inventory Ledger command 层生成（业务模块调用 command，不直接建表） |
| COMMITTED（落定） | 幂等键校验通过 → status=COMMITTED + committedAt/ById；**这是库存账的生效点** |
| 不可变 | COMMITTED 后：**禁止 UPDATE / DELETE**（数据库层约束 + API 层无此能力） |
| 纠错 | 只能**追加**：`REVERSAL`（冲销原 Movement，方向相反、引用 reversalOfMovementId）或 `CORRECTION`（修正） |
| 幂等 | 重复消费同一事件 → 幂等键命中 → 跳过（不重复生成） |

### 状态机（草案）
`PENDING（可选暂存） → COMMITTED`；`COMMITTED →（仅通过 Reversal/Correction 追加，不改变原行）`

> **对齐 5B 纪律**：DRAFT 创建不发领域事件；只有 COMMITTED 才发布 `InventoryMovementCommitted`（或类似命名，P10 待拍板）。

---

## 5. 库存维度与批次/序列号账本

| 维度 | 规则 |
| --- | --- |
| 维度键 | Warehouse + Location + Item + Batch/Serial（共同决定一条库存投影） |
| **Batch/Serial canonical source** | **继承 5B WarehouseReceipt（P6 Final）**——库存模块**不得重新创建第二份批次/序列号追溯事实**；6A 只引用 WarehouseReceiptLine 已采集的 batchNo/serialNos/mfgDate/expDate |
| 批次账本 | Movement 行携带 `batchNo / serialNos`（从来源事实继承）；批次维度库存投影 = 按批次聚合 Movement |
| 序列号追踪 | 序列号维度 = 按 serial 聚合（每序列号一条库存状态） |

> **红线**：6A 建的是"Movement + 投影"，**不重建批次/序列号主数据**（那仍是 5B WarehouseReceipt 的 canonical 职责）。

---

## 6. Transfer / Conversion / Count 规则（本期只拍规则，不建表）

| 业务 | 规则 | 禁止 |
| --- | --- | --- |
| **Transfer（调拨）** | **成对 Movement**：SOURCE OUT + DESTINATION IN（同事务/同批提交，原子性）；只调投影不调事实 | ❌ 不能只改两个余额 |
| **Conversion（物料转换/组装拆分）** | **一组 Consume/Produce Movement**：Consume 原料（OUT）+ Produce 成品（IN），按配方比例 | ❌ 不能用一个 Adjustment 代替 |
| **Stock Count（盘点）** | 只生成**盘盈/盘亏 Adjustment Movement**（差异 = 实盘 - 投影，正→盘盈 IN / 负→盘亏 OUT） | ❌ 不能直接"改库存数" |

> 以上本期**只拍板规则**（写进 ADR-0025 D8-D10），Schema 是否本期建、还是 6B 建，属于 Pending Decision（见 P5）。

---

## 7. ReservedQty 与 Costing 边界

| 项 | 边界 |
| --- | --- |
| **ReservedQty（预留量）** | **是否进入 6A 单独拍板（P3），不能顺手加**。默认倾向：**不进入 6A 核心 Ledger**（预留是可用性投影的一部分，可在更高层处理或后续 Sprint） |
| **Costing（成本）** | **不混进 6A Ledger**。除非只保留 `costSnapshot / costReference`（引用来源单据的成本快照字段，不做移动平均/FIFO 计算）；**移动平均 / FIFO 单独 Gate（6B+）** |

> 红线：6A Movement 行可带 `costSnapshot`（只读引用/快照），**禁止**在 6A 做成本计算逻辑。

---

## 8. 事件驱动与事务一致性 —— P1：Transactional Outbox（本 Gate 第一号决策）

### 8.1 问题（CTO #7405 明确提出）

5B 当前模式：业务事实提交成功后发布事件（try/catch best-effort）。
**如果 WarehouseReceipt 已 POSTED，但 `WarehouseReceiptPosted` 事件发布失败，库存是否永远没入账？**

> **答案必须是否定的**。库存不能接受"偶尔少一笔"。Inventory Ledger 的完整性**不能依赖 best-effort 事件发布**。

### 8.2 方案（CTO 倾向，本 Gate 默认采纳，待 CTO Design Review 拍板）

```
业务事实事务（如 WarehouseReceipt POST 事务）
  ├─ 写入业务事实（WarehouseReceipt.status = POSTED）
  ├─ **同事务写入 Outbox 表**（eventType=WarehouseReceiptPosted, aggregateId, payload, idempotencyKey）
  └─ 事务提交（业务事实 + Outbox 原子落库）
        ↓
Inventory consumer（独立进程/事务）
  ├─ 读取 Outbox 未发送记录
  ├─ 幂等消费（幂等键 = sourceType + sourceId + sourceLineId）
  └─ 调用 Inventory Ledger command 层生成 Movement（COMMITTED）
```

- **同步同事务 / Outbox / 异步消费 三选一 → 本 Gate 默认：业务事实事务 + Outbox 同事务落库 → Inventory consumer 幂等生成 Movement（P1，待 CTO 拍板）**
- 优点：业务事实与"应产生库存动作"的意图**原子落库**；事件丢失不丢账（Outbox 重放）；consumer 幂等防重复入账
- 对比备选：a) 同步同事务直接建 Movement（强一致但跨模块耦合、无事件中间层）；b) 维持异步 best-effort（**拒绝**——库存不接受丢账）

### 8.3 Outbox 表（草案，见 Field Matrix §4）

`OutboxMessage`（或对齐仓库既有模式）：`id / eventType / aggregateType / aggregateId / payload / idempotencyKey / status(PENDING|SENT|FAILED) / createdAt / processedAt`

> **红线**：6A 上线前，**Transactional Outbox 必须落地**（提升为 6A 前置能力，不再容忍 Known Risk best-effort 发布）；业务事实 + Outbox 写入必须同事务。

---

## 9. 事件注册（6A，先注册后开发，对齐 EVENTS.md 纪律）

| eventType（草案，命名 P10 待拍板） | 触发时机 | 载荷要点 |
| --- | --- | --- |
| `InventoryMovementCommitted` | Movement COMMITTED（事务后发） | movementId / sourceType / sourceId / sourceLineId / direction(IN\|OUT) / warehouseId / locationId / itemId / batchNo / serialNos / quantity / committedAt；**不含投影余额** |
| `InventoryStockProjectionChanged`（可选，P10 待拍板） | 投影聚合变化后 | 维度键 + 新投影值（供 BI/查询缓存） |

> 6A 事件同样遵循：**业务动作事件，不以 PENDING 创建为完成事实**；载荷**不含余额**（余额是投影，不是事实，事件不承载投影语义——避免下游把投影当事实）。

---

## 10. 边界红线（6A 实现范围）

- ❌ 不创建 Schema / Migration 0024 / Prisma model / API（本 Gate 只出设计文档）
- ❌ 业务模块**不得直接创建 InventoryMovement**（必须走 Inventory Ledger command 层 + 受支持 sourceType/sourceId/sourceLineId）
- ❌ 不直接写 Stock / OnHandQty / AvailableQty（只能由 Movement 聚合投影）
- ❌ Movement COMMITTED 后不得 UPDATE / DELETE（纠错只能 Reversal / Correction 追加）
- ❌ 不重建批次/序列号主数据（canonical = 5B WarehouseReceipt）
- ❌ ReservedQty 默认不进 6A（除非 CTO 单独拍板 P3）
- ❌ Costing（移动平均/FIFO）不混入（P4；仅 cost snapshot/reference）
- ❌ 不实现 Transfer / Conversion / Count 的 API（本期只拍规则 P5）
- ❌ 5C（Supplier Invoice / 三单匹配 / AP）不实现

## 11. CTO Design Review 后动作

1. CTO 拍板 P1-P10（见 Sprint6A_CTO_Pending_Decisions.md）
2. ADR-0025 草案 → Approved with Changes / Final
3. 拍板后才允许 **6A Schema / Migration 0024**（先 InventoryMovement + Outbox，再 Stock Projection，再 Transfer/Conversion/Count——按 CTO 批准顺序）
4. 实现阶段仍走 commit → push → GitHub CI（禁止本地高资源验证）
