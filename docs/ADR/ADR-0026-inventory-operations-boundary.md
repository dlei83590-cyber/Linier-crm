# ADR-0026：Inventory Operations Boundary（库存作业边界决策）

- 状态：**Approved with Changes（CTO 6B Design Review #7975 89/100——P1-P12 全部 Final；Schema / Migration / API 继续 HOLD，CTO 6B Gate Re-review 通过后才放行）**
- 关联：Sprint6B_Inventory_Operations_Architecture_Process_Gate.md / Sprint6B_Inventory_Operations_Field_Matrix.md / Sprint6B_CTO_Pending_Decisions.md / EVENTS.md / ADR-0025（6A Implemented，Sprint 6A FINAL APPROVED 99/100 #7865）
- 决策人：CIO（JINZA）提案 ｜ 审核：CTO
- 背景：Sprint 6A 已建立库存数量唯一事实源（`InventoryMovement` = SSOT；`StockProjection` = 物化投影；Transactional Outbox + Consumer + Ledger Command 固化，PR #21 合并 main `67c031d`）。6B 需要把 **Transfer / Stock Count / Adjustment / Conversion** 四类库存作业接入 6A SSOT，而**不建立第二套库存事实源**（CTO #7895 锁死）。库存作业是最容易污染库存账的领域——先拍事实边界，再允许 Schema/Migration。

## 核心决策（D1-D7，CTO #7975 拍板）

### D1：Operations 不建立第二套库存事实源（6A 红线继承）

- 6B 所有库存变化**最终只能形成不可变 `InventoryMovement`**；`StockProjection` 继续只是 Movement 的物化投影
- Transfer / Count / Adjustment / Conversion 业务 API **不得直接 INSERT InventoryMovement / UPDATE StockProjection**
- 必须经 **共享 Ledger Command（同步）或 Transactional Outbox + Consumer（异步）**——与 6A 完全同一套架构原则（复用 `writeInventoryOutboxAtom` / `consumeOutboxMessage` 模式，不另起炉灶）

### D2：Transfer = 双边原子事实（SOURCE_OUT + DESTINATION_IN）

- 一个 Transfer 业务事实 → **成对原子 Movement**：`SOURCE_OUT`（OUT）+ `DESTINATION_IN`（IN）
- 双边共享 **同一 `movementGroupId`**，**全有或全无**（同事务提交）
- **禁止先 OUT、后异步 IN**（否则产生运输途中"库存凭空消失"的账务窗口）
- 源仓五维锁内检查 `onHandQty >= qty`（并发防超扣）；serial/batch 精确继承（P5 Final：serial 不重生成、batch 不拆批不换批）
- 同仓不同库位 / 跨仓调拨统一模型（P3 Final）；同一五维不能自调拨
- **整组冲销（CTO #7975 Blocking ④）**：使用正式 **REVERSAL** role——REVERSAL/IN 引用原 SOURCE_OUT、REVERSAL/OUT 引用原 DESTINATION_IN，两笔新 Reversal 用新 movementGroupId；**不发明 SOURCE_IN / DESTINATION_OUT role**

### D3：Stock Count = 实盘事实，不是库存账事实（CTO #7975 Blocking ①/② 修正）

- 事实链：`StockCount → Count Result → Variance → Adjustment Command → InventoryMovement(ADJUSTMENT)`
- **严禁** `StockCount → UPDATE StockProjection`（跳过 Movement 的直接改投影）
- **per-line atomic snapshot（CTO 拍板，不用 header 级创建时快照/动态补偿公式）**：每行录入 `countedQty` 时同事务读取五维 `StockProjection` → 保存 `bookQtyAtCount` / `countedAt` / `ledgerWatermark`（仅审计）；`varianceQty = countedQty - bookQtyAtCount`；**已删除 `dynamicAdjustment` / `netVariance` 动态加减公式**（会把盘点期间正常业务 Movement 重复算进差异）
- **watermark 仅审计**：`movementNo` 只是可读业务编号，**不作为并发时序/提交顺序主键**；未来严格 replay 需单独设计 **monotonic ledgerSeq**，不复用 MV 编号
- **sourceType 不新增 STOCK_COUNT**：Count 本身不产生 Movement，真正产生库存账的是 Adjustment；Count 通过 `Adjustment.sourceStockCountLineId` 保留业务追溯（CTO #7975）
- 差异审批：P7 Final（System Default = 0 自动阈值——所有非零 variance 首版默认需审批）

### D4：Adjustment = 受控的库存账事实（P8/P9 Final）

- 独立业务原因 + 授权边界：`reasonCode / approvedBy / sourceReference / idempotencyIdentity`；**direction 下沉到行级（CTO 6B Schema Review Blocking ①）**：`InventoryAdjustmentLine.direction = IN/OUT`、`quantity` 恒正数——同一 Adjustment 可原子承载盘盈+盘亏差异行（一次 Stock Count 的 +5/-3 属于同一盘点事实，无需拆两张 ADJ 单）；Manual Adjustment 同样支持多行不同方向，仍在同一 maker-checker 审批事实下
- reasonCode = **系统保留码 + 可扩展字典**（不把所有原因永久写死 enum）
- **一个 StockCountLine 最多结算一次（Blocking ②）**：`sourceStockCountLineId` 加 UNIQUE——同一 CountLine 差异事实只能产生一个正式 AdjustmentLine，防双重入账（PG 普通 UNIQUE 允许多个 NULL，Manual 不受影响）；未来对已调整差异纠错走 Reversal/Correction，不建第二张 Count Adjustment
- **maker-checker 闭环（Integrity ②）**：`createdById NOT NULL`——createdById 可空会让 SQL 三值逻辑使 maker-checker CHECK 失效；系统自动创建的 Count Adjustment 也必须带明确 system actor
- 只能通过 **共享 Ledger Command 追加 Movement**；**禁止编辑历史 Movement / 直接改 Projection**
- 人工创建（MANUAL）：**允许但 maker-checker**——创建人与批准/Apply 人不得相同；高权限（`inventory-adjustment:apply`，仅 SUPER_ADMIN/ADMIN）+ 强审计
- **终态证据（Integrity ①）**：DB CHECK 保证 `status=APPLIED` 时 `approvedById/appliedById/appliedAt` 全部非空——防"终态无执行证据"坏数据（不能证明 Ledger 一定成功，但杜绝空终态）

### D5：Conversion = 收窄为同 item Repack / UOM Conversion（CTO #7975 Blocking ③）

- **6B 只允许同 item 的 Inventory Repack / UOM Conversion**：同一 `itemId`、明确 inventory/base UOM、CONSUME + PRODUCE 同事务、batch 默认精确继承、**serial 不重生成**
- **单输入单输出（CTO 6B Schema Review Blocking ③）**：`UNIQUE(conversionHeaderId, lineRole)`——每张 Conversion 最多 1 CONSUME + 1 PRODUCE，数据库不再允许 N×M；service EXECUTE 前要求两种 role 都恰好存在
- **行级换算 snapshot（Blocking ④）**：`InventoryConversionLine.uomToBaseRate` + `baseQuantity`（`baseQuantity = quantity × uomToBaseRate`）；header 单一 `conversionRate` 已删除——一个 header rate 无法无歧义描述两方向各自换算。service EXECUTE 前验证 `CONSUME.baseQuantity == PRODUCE.baseQuantity`；真正写 InventoryMovement 时 `quantity=baseQuantity`、`uomId=conversion.baseUomId`——**Ledger 只记 canonical 数量**；`baseUomId` 在 service Gate 中验证等于该 Item 的 inventory/stock UOM，不允许调用方任意选 UOM 冒充库存基准
- **不允许多物料配方式 N→M 转换**；真正的多原料→多产出 / 装配 / 拆解 / 工艺转换 → **未来 Manufacturing / Transformation Gate**（防止 6B 进入 MRP/BOM）
- 守恒口径（P11 Final）：换算到 base UOM 后 `ΣCONSUME` 与 `ΣPRODUCE` 相等；**禁止不同物料/不同量纲硬算 Σ 相等**（KG 与 PC 没有通用 base——那是 BOM/Assembly 语义）

### D6：Operations 分层（P1/P12 Final）

- **Transfer / Adjustment / Repack Conversion → 同步共享 Ledger Command**（原子性最强、无账务窗口）
- **Count → 业务事实落库**，差异经 Adjustment Command 同步处理（不直接写 Ledger）
- **6A 现有 IN/OUT（入库/退货）继续走 Transactional Outbox + Consumer，不动**（6A FINAL APPROVED 不改造）
- **实现前置（CTO #7975 锁死）：6B 必须抽取共享 `InventoryLedgerCommand` core**——6A Consumer 与 6B Transfer/Adjustment/Repack 不得各写一套 Movement/Projection/锁逻辑；同步 Command 与 Outbox Consumer 共用同一底层

### D7：明确排除（CTO #7895）

- **Reservation / ReservedQty / AvailableQty**（6A P3 Final 延续，availableQty 不作 canonical 字段）
- **Costing / FIFO / Moving Average / valuation**（6A P4 Final 延续，连 costSnapshot 都不放）
- **Sales shipment OUT 等其他新 sourceType**（销售出库后续独立阶段）
- 不得因为 Transfer/Conversion 需要数量操作而顺手进入成本核算

---

## 变更记录

| 版本 | 日期       | 状态                      | 说明                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---- | ---------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v0.1 | 2026-08-11 | **Proposed**              | 6B Architecture & Process Gate 首版（D1-D7，P1-P12 待拍板）                                                                                                                                                                                                                                                                                                                                                                                                                            |
| v0.2 | 2026-08-11 | **Approved with Changes** | CTO 6B Design Review #7975 89/100——P1-P12 全部 Final；落实 4 Blocking（① Count per-line snapshot ② watermark 仅审计 ③ Conversion 收窄同 item Repack ④ Reversal 用正式 REVERSAL role）+ 2 修正（删 STOCK_COUNT sourceType；事件名 Executed/Applied/Completed）+ 共享 InventoryLedgerCommand core 前置                                                                                                                                                                                   |
| v0.3 | 2026-08-11 | **Approved with Changes** | CTO 6B Schema Review #8112 86/100 REQUEST CHANGES 修正（Migration 0026 未进 main 直接改）：D4——direction 下沉到 AdjustmentLine（Blocking ①）+ sourceStockCountLineId UNIQUE 防双重入账（Blocking ②）+ createdById NOT NULL 闭环 maker-checker（Integrity ②）+ 终态证据 CHECK（Integrity ①）；D5——单输入单输出 UNIQUE(conversionHeaderId, lineRole)（Blocking ③）+ 行级 uomToBaseRate/baseQuantity、删 header 单一 conversionRate（Blocking ④）；Transfer/Conversion 同加终态证据 CHECK |

> 批准后：更新为 Approved（Re-review 通过）→ 追加 Implementation Status（对齐 ADR-0025 I1-I12 模式）。
