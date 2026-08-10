# ADR-0026：Inventory Operations Boundary（库存作业边界决策）

- 状态：**Proposed（Sprint 6B Architecture & Process Gate 产物——Design First，待 CTO Design Review #7900 拍板；批准前禁止 Schema / Migration / API）**
- 关联：Sprint6B_Inventory_Operations_Architecture_Process_Gate.md / Sprint6B_Inventory_Operations_Field_Matrix.md / Sprint6B_CTO_Pending_Decisions.md / EVENTS.md / ADR-0025（6A Implemented，Sprint 6A FINAL APPROVED 99/100 #7865）
- 决策人：CIO（JINZA）提案 ｜ 审核：CTO
- 背景：Sprint 6A 已建立库存数量唯一事实源（`InventoryMovement` = SSOT；`StockProjection` = 物化投影；Transactional Outbox + Consumer + Ledger Command 固化，PR #21 合并 main `67c031d`）。6B 需要把 **Transfer / Stock Count / Adjustment / Conversion** 四类库存作业接入 6A SSOT，而**不建立第二套库存事实源**（CTO #7895 锁死）。库存作业是最容易污染库存账的领域——先拍事实边界，再允许 Schema/Migration。

## 核心决策（Proposed——CTO Design Review 待拍板）

### D1：Operations 不建立第二套库存事实源（6A 红线继承）

- 6B 所有库存变化**最终只能形成不可变 `InventoryMovement`**；`StockProjection` 继续只是 Movement 的物化投影
- Transfer / Count / Adjustment / Conversion 业务 API **不得直接 INSERT InventoryMovement / UPDATE StockProjection**
- 必须经 **Ledger Command（同步）或 Transactional Outbox + Consumer（异步）**——与 6A 完全同一套架构原则（复用 `writeInventoryOutboxAtom` / `consumeOutboxMessage` 模式，不另起炉灶）

### D2：Transfer = 双边原子事实（SOURCE_OUT + DESTINATION_IN）

- 一个 Transfer 业务事实 → **成对原子 Movement**：`SOURCE_OUT`（OUT）+ `DESTINATION_IN`（IN）
- 双边共享 **同一 `movementGroupId`**，**全有或全无**（同事务提交）
- **禁止先 OUT、后异步 IN**（否则产生运输途中"库存凭空消失"的账务窗口）
- 源仓五维锁内检查 `onHandQty >= qty`（并发防超扣）；serial/batch 精确继承规则见 D5
- 同仓不同库位 / 跨仓调拨统一模型（P3 待拍板，默认统一）

### D3：Stock Count = 实盘事实，不是库存账事实

- 事实链：`StockCount → Count Result → Variance → Adjustment Command → InventoryMovement(ADJUSTMENT)`
- **严禁** `StockCount → UPDATE StockProjection`（跳过 Movement 的直接改投影）
- 盘点基准时点、冻结策略、snapshot 后 Movement 补偿、重复过账幂等见 P6/P7（待拍板）

### D4：Adjustment = 受控的库存账事实

- 独立业务原因 + 授权边界：`reasonCode / direction / quantity / approvedBy / sourceReference / idempotencyIdentity`
- 只能通过 **Ledger Command 追加 Movement**；**禁止编辑历史 Movement / 直接改 Projection**
- 人工创建倾向允许但高权限 + 强审计（P9，CTO 倾向）

### D5：Conversion = Consume/Produce 编组守恒

- 同一业务事实组：`CONSUME（OUT）× N + PRODUCE（IN）× M`，共享同一 `movementGroupId`
- 输入/输出数量守恒 ≠ 简单 1:1：多输入/多输出模型（P10）、UOM 换算守恒口径（P11）、batch/serial 继承或重生成（P5 扩展）待拍板
- 全部 CONSUME + PRODUCE **原子提交**，绝不允许部分提交

### D6：Operations 分层（同步 Command vs Transactional Outbox）

- 推荐：**Transfer / Adjustment / Conversion 走同步 Ledger Command**（原子性最强、无账务窗口）；Count 落库后差异经 Adjustment Command 同步处理
- **6A 现有 IN/OUT（入库/退货）继续走 Transactional Outbox + Consumer，不动**（6A FINAL APPROVED 不改造）
- 备选：Transfer/Conversion 走 Outbox 编组（业务事实 + N atom Outbox 同事务）——需编组级完成检测/补偿（P1/P12 待拍板）

### D7：明确排除（CTO #7895）

- **Reservation / ReservedQty / AvailableQty**（6A P3 Final 延续，availableQty 不作 canonical 字段）
- **Costing / FIFO / Moving Average / valuation**（6A P4 Final 延续，连 costSnapshot 都不放）
- **Sales shipment OUT 等其他新 sourceType**（销售出库后续独立阶段）
- 不得因为 Transfer/Conversion 需要数量操作而顺手进入成本核算

---

## 变更记录

| 版本 | 日期 | 状态 | 说明 |
| --- | --- | --- | --- |
| v0.1 | 2026-08-11 | **Proposed** | 6B Architecture & Process Gate 首版（D1-D7，P1-P12 待 CTO Design Review 拍板） |

> 批准后：更新为 Approved → 追加 Implementation Status（对齐 ADR-0025 I1-I12 模式）。
