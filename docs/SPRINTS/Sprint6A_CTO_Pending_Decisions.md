# Sprint 6A：CTO Pending Decisions（库存账本待拍板决策清单）

- 版本：v0.1（草案，待 CTO Design Review）
- 日期：2026-08-10
- 维护者：CIO（JINZA）提案 ｜ 审核：CTO
- 关联：Sprint6A_Inventory_Ledger_Architecture_Process_Gate.md / ADR-0025（草案）/ Sprint6A_Inventory_Field_Matrix.md / EVENTS.md / ADR-0024（5B 已 Implemented）

> **Gate 铁律（CTO #7405）**：6A 是 ERP 最易出数据一致性事故的领域。本清单只拍事实边界，**未拍板前禁止 Schema / Migration 0024 / API**。全部 Pending 拍板后才允许进入 Schema。

---

## P1：Inventory Movement 写入方式（同步同事务 / Outbox 驱动 / 异步消费）—— 🔴 本 Gate 第一号决策

**问题（CTO #7405 明确提出）**：WarehouseReceipt 已 POSTED，但 `WarehouseReceiptPosted` 事件发布失败 → 库存是否永远没入账？**答案必须是否定的**——库存不能接受"偶尔少一笔"。

**CTO 倾向方案（默认采纳，待正式拍板）**：
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
- 备选 a：同步同事务直接建 Movement（强一致，但跨模块耦合、无事件中间层）
- 备选 b：维持异步 best-effort（**拒绝**——库存不接受丢账）
- **红线**：Transactional Outbox 提升为 6A 前置能力；业务事实 + Outbox 写入必须同事务

## P2：Movement 状态机与命名

- 草案：`PENDING（可选暂存） → COMMITTED`；`COMMITTED →（仅通过 Reversal/Correction 追加，不改变原行）`
- 待拍板：是否需要 PENDING 暂存态，还是创建即 COMMITTED（无暂存）？状态命名是否对齐 5B（POSTED 语义）？

## P3：ReservedQty 是否进入 6A

- **CTO 倾向（#7405）**：**不进入 6A 核心 Ledger**（预留是可用性投影的一部分，可在更高层处理或后续 Sprint）
- 待拍板：若进入，reservedQty 的写入者、释放规则、与 Movement 的关系

## P4：Costing 边界

- **CTO 倾向（#7405）**：**Costing 不混进 6A Ledger**；除非只保留 `costSnapshot / costReference`（引用来源单据成本快照，不做计算）
- **移动平均 / FIFO 单独 Gate（6B+）**
- 待拍板：costSnapshot 字段是否本期保留（仅快照/引用）

## P5：Transfer / Conversion / Count 的 Schema 是否本期建

- 规则已锁（ADR D8-D10）：Transfer = 成对 Movement；Conversion = Consume/Produce 组；Count = 盘盈/盘亏 Adjustment Movement
- 待拍板：本期只建 InventoryMovement + Stock Projection + Outbox（Transfer/Conversion/Count 后续 Sprint），还是本期一并建相关业务单据模型？

## P6：负库存策略

- 待拍板：是否允许临时负库存（OUT > 当前投影时）？选项：a) 禁止（OUT 前校验，无货不可出）b) 允许负库存 + 告警 c) 允许负库存 + 强制作业阻塞
- 影响：Transfer OUT / 已入库退货 OUT / 未来 Sales OUT 的校验语义

## P7：Stock Projection 存储形态

- 待拍板：a) 物化表（Movement 聚合时增量更新，查询快）b) 视图/聚合查询（无冗余，但查询慢）c) 物化表 + 定期对账（推荐）
- 影响：BI/查询性能与一致性成本

## P8：Outbox 表归属与重放机制

- 待拍板：Outbox 表放哪个模块（6A 独立表 vs 平台公共表）；消费确认机制（SENT 后删除 vs 保留审计）；失败重试/死信策略
- 红线：业务事实 + Outbox 写入同事务（P1）

## P9：已入库退货 OUT 的 Movement 数量与批次继承

- 草案：`PURCHASE_RETURN_RETURNED`（WAREHOUSE_RECEIPT_LINE 来源行）→ OUT，数量 = PurchaseReturnLine.quantity，批次/序列号继承来源 WarehouseReceiptLine（P6 Final）
- 待拍板：退货 OUT 是否必须按原批次扣减（批次维度精确追踪），还是允许任意批次扣减（FIFO/加权）

## P10：6A 事件命名

- 草案：`InventoryMovementCommitted`（Movement 落定后发布）/ `InventoryStockProjectionChanged`（可选，投影变化后发，供 BI/查询缓存）
- 待拍板：命名是否对齐 EVENTS.md 注册纪律（业务动作事件，不以 PENDING 创建为完成事实；载荷不含投影余额）

---

## 汇总表（CTO Design Review 拍板结果——待填）

| # | Pending | CTO 决策 | 结论 |
| --- | --- | --- | --- |
| P1 | Movement 写入方式（同步同事务 / Outbox / 异步） | 待拍板（CTO 倾向：业务事实事务 + Outbox 同事务 → consumer 幂等生成） | ⏳ |
| P2 | Movement 状态机与命名 | 待拍板 | ⏳ |
| P3 | ReservedQty 是否进入 6A | 待拍板（CTO 倾向：不进入） | ⏳ |
| P4 | Costing 边界 | 待拍板（CTO 倾向：不混入，仅 cost snapshot；移动平均/FIFO 单独 Gate） | ⏳ |
| P5 | Transfer/Conversion/Count 的 Schema 是否本期建 | 待拍板（规则已锁，Schema 范围待定） | ⏳ |
| P6 | 负库存策略 | 待拍板 | ⏳ |
| P7 | Stock Projection 存储形态 | 待拍板 | ⏳ |
| P8 | Outbox 归属与重放机制 | 待拍板 | ⏳ |
| P9 | 已入库退货 OUT 数量与批次继承 | 待拍板 | ⏳ |
| P10 | 6A 事件命名 | 待拍板 | ⏳ |

> **CTO 红线（本 Gate 直接锁定，不待拍板）**：业务模块不得直接创建 InventoryMovement——必须通过 Inventory Ledger service / command 层，以受支持的 `sourceType + sourceId + sourceLineId` 生成 Movement。否则 Purchase、Sales、Transfer、Count、Conversion 会各自写库存表，事实源再次分裂。
