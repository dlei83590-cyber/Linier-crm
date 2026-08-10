# Sprint 6B：Inventory Operations Field Matrix（库存作业字段矩阵）

- 版本：v0.2（CTO 6B Design Review #7975 89/100 APPROVED WITH CHANGES 落实——P1-P12 Final；Re-review 通过前仍禁止 Schema / Migration / API）
- 日期：2026-08-11
- 维护者：CIO（JINZA）｜审核：CTO
- 关联：Sprint6B_Inventory_Operations_Architecture_Process_Gate.md / ADR-0026（Proposed）/ Sprint6B_CTO_Pending_Decisions.md / Sprint6A_Inventory_Field_Matrix.md（6A：InventoryMovement / StockProjection / OutboxMessage 已实现）/ EVENTS.md（v1.26）

> **⚠️ 铁律（CTO #7895 锁死）**：本矩阵是**字段草案（Design Only / Not Schema）**——不是 Schema，不建任何表。**业务 API 不得直接创建 InventoryMovement / 修改 StockProjection**——所有库存变化必须经 Ledger Command（同步）或 Transactional Outbox + Consumer（异步），复用 6A 已固化的 `writeInventoryOutboxAtom` / `consumeOutboxMessage` 模式。字段命名在 Schema Gate 批准后再定稿。

---

## 1. Transfer（调拨）—— 业务事实草案

### 1.1 TransferHeader（调拨单头）

| 字段（草案） | 语义 | 类型/约束草案 | 备注 |
| --- | --- | --- | --- |
| id | 主键 | UUID | |
| transferNo | 调拨单号 | DocumentSequence（前缀 TRF / TR，P2 Final） | 创建即取号（沿用 5B+ 惯例） |
| status | 状态 | enum（DRAFT / SUBMITTED / APPROVED / EXECUTED / CANCELLED） | P2 Final：独立 Transfer Document；审批走既有 Workflow Policy（跨仓默认需审批，同仓免审由策略配置，不硬编码） |
| transferType | 调拨类型 | enum（INTER_WAREHOUSE / INTRA_WAREHOUSE） | P3 Final：跨仓与同仓库位移动统一模型 |
| sourceWarehouseId / sourceLocationId | 源仓/源库位 | FK（可空 location） | |
| destinationWarehouseId / destinationLocationId | 目标仓/目标库位 | FK（可空 location） | |
| movementGroupId | 编组 id（**双边共享**） | string | **CTO #7895 强制**：SOURCE_OUT + DESTINATION_IN 同一 movementGroupId |
| approvedById | 授权人 | FK → User | |
| executedAt / executedById | 执行时点/人 | date-time / FK → User | 双边 Movement 同事务落定时写入 |
| remark | 备注 | string(500) | |
| createdById / updatedById | 审计 | FK → User | |

### 1.2 TransferLine（调拨单行）

| 字段（草案） | 语义 | 备注 |
| --- | --- | --- |
| id / transferHeaderId | 主键 / 头 FK | |
| itemId / uomId | 物料 / 单位 | 继承来源 |
| quantity | 调拨数量 | Decimal(18,4)，> 0 |
| batchNo | 批次（可空） | P5 Final：batch 精确继承，首版不拆批不换批 |
| serialNos | 序列号组（serial-managed） | **每 serial 一对 Movement**（SOURCE_OUT serialNo=X + DESTINATION_IN serialNo=X），精确继承不重生成 |
| mfgDate / expDate | 生产日期/有效期（可空） | 继承 |
| sourceLineId | 来源引用（可选） | 追溯 |

---

## 2. Stock Count（盘点）—— 实盘事实草案

### 2.1 StockCountHeader（盘点单头）

| 字段（草案） | 语义 | 备注 |
| --- | --- | --- |
| id / countNo | 主键 / 盘点单号 | DocumentSequence（前缀 CNT / SC） |
| status | 状态 | enum（DRAFT / COUNTING / COMPLETED / ADJUSTED / CANCELLED） |
| countBasisAt | 盘点基准时点 | P6 Final：per-line snapshot 时点（行级录入时取） |
| freezeStrategy | 冻结策略 | **P6 Final：DYNAMIC（不冻结业务）**——per-line atomic snapshot，非 header 级 creation snapshot |
| ledgerWatermark | 账本水位（**仅审计/重放证据**） | **CTO #7975 Blocking ②**：movementNo 只是可读编号，**不作为并发时序主键**；不参与 variance 算法；未来严格 replay 需单独设计 monotonic ledgerSeq（不复用 MV 编号） |
| countedById / completedAt | 盘点人 / 完成时点 | |
| createdById / updatedById | 审计 | |

### 2.2 StockCountLine（盘点明细行）

| 字段（草案） | 语义 | 备注 |
| --- | --- | --- |
| id / countHeaderId | 主键 / 头 FK | |
| warehouseId / locationId / itemId / batchNo / serialNo | 盘点维度（五维） | 与 6A Projection 维度一致 |
| countedQty | 实盘数（录入） | 业务事实 |
| bookQtyAtCount | 账面数（**录入时同事务读取该五维 StockProjection**） | **CTO #7975 Blocking ①**：per-line atomic snapshot——不再用 header 级创建时快照，也不做动态补偿公式 |
| countedAt | 盘点录入时点 | 同事务写入 |
| ledgerWatermark | 账本水位（仅审计/重放证据） | **CTO #7975 Blocking ②**：movementNo 只是可读编号，**不作为并发时序主键**，不参与 variance 算法 |
| varianceQty | 差异（服务端计算） | **varianceQty 取 countedQty 减 bookQtyAtCount**——盘点期间正常 Movement 同时改变物理与账面库存，无需再加减；**已删除 dynamicAdjustment / netVarianceQty 动态补偿公式** |
| adjustmentRef | 生成的 Adjustment 引用 | Count 本身不碰库存账 |

---

## 3. Adjustment（调整）—— 受控库存账事实草案

| 字段（草案） | 语义 | 类型/约束草案 | 备注 |
| --- | --- | --- | --- |
| id / adjustmentNo | 主键 / 调整单号 | DocumentSequence（前缀 ADJ） | |
| reasonCode | 原因码 | **P8 Final：系统保留码（COUNT_VARIANCE / DAMAGE / LOSS / GIFT / SYSTEM_CORRECTION / MANUAL）+ 可扩展字典**——不把所有原因永久写死 enum | |
| direction | 方向 | enum（IN / OUT） | 正负方向（quantity 恒正数） |
| quantity | 数量 | Decimal(18,4) > 0 | 方向承载正负 |
| warehouseId / locationId / itemId / batchNo / serialNo | 维度（五维） | | serial-managed 仍逐 serial 原子化 |
| approvedById | 授权人 | FK → User | P8/P9 Final：MANUAL 需高权限角色；**maker-checker：创建人与批准/Apply 人不得相同** |
| sourceReference | 来源引用 | string（countNo / 原单据 / 说明） | 追溯 |
| sourceStockCountLineId | 盘点行追溯（可空） | FK → StockCountLine | **CTO #7975：Count 通过此字段追溯，不新增 STOCK_COUNT sourceType** |
| idempotencyIdentity | 幂等身份 | string（adjustmentNo + lineId + atomKey） | 防重复过账 |
| remark / createdById / updatedById | 审计 | | |

---

## 4. Conversion（转换）—— Consume/Produce 编组草案

### 4.1 ConversionHeader（转换单头——**6B 收窄为同 item Repack / UOM Conversion**，CTO #7975 Blocking ③）

| 字段（草案） | 语义 | 备注 |
| --- | --- | --- |
| id / conversionNo | 主键 / 转换单号 | DocumentSequence（前缀 CVT） |
| status | 状态 | enum（DRAFT / SUBMITTED / EXECUTED / CANCELLED） |
| movementGroupId | 编组 id（**CONSUME + PRODUCE 共享**） | CTO #7895 强制 |
| itemId | 物料（**输入输出必须同一 itemId**） | **CTO #7975 锁死**：6B 只允许 Inventory Repack / UOM Conversion；不允许多物料配方式 N→M 转换（多原料→多产出/装配/拆解 → 未来 Manufacturing / Transformation Gate） |
| baseUomId | 库存基准 UOM | **CTO #7975 Blocking ③**：明确 inventory/base UOM；Movement/Projection 数量以 canonical inventory UOM 计账 |
| conversionRate | 显式换算率 snapshot | 业务 UOM 与 base UOM 间换算率，单据显式声明（不隐式查表） |
| executedAt / executedById | 执行时点/人 | |
| remark / 审计 | | |

### 4.2 ConversionLine（转换行——输入或输出）

| 字段（草案） | 语义 | 备注 |
| --- | --- | --- |
| id / conversionHeaderId | 主键 / 头 FK | |
| lineRole | 行角色 | enum（CONSUME / PRODUCE） |
| quantity / uomId | 数量 / 业务 UOM | **守恒：换算到 base UOM 后 ΣCONSUME 与 ΣPRODUCE 相等**（P11 Final）；禁止不同物料/不同量纲硬算相等 |
| warehouseId / locationId | 维度 | 输出可指定目标仓/库位 |
| batchNo（可空） | 批次 | **P5 Final：batch 默认精确继承**（输入批次 → 输出同批次） |
| serialNos（可空） | 序列号组 | **P5 Final：serial 不重生成**——6B 首版不支持 serial 重生成（Repack 通常 non-serial；serial 场景后续阶段） |

---

## 5. InventoryMovement 扩展字段草案（6A 已实现表——6B 只新增枚举/引用，不重构）

| 字段 | 现状（6A 已实现） | 6B 草案扩展 | 备注 |
| --- | --- | --- | --- |
| sourceType | enum（WAREHOUSE_RECEIPT_POSTED / PURCHASE_RETURN_RETURNED / 未来…） | **新增：TRANSFER / ADJUSTMENT / CONVERSION（实际名可定 INVENTORY_CONVERSION / REPACK）**——**删除 STOCK_COUNT**（Count 本身不产生 Movement，真正产生库存账的是 Adjustment；Count 通过 `Adjustment.sourceStockCountLineId` 追溯，CTO #7975） | **新 sourceType 须 CTO 批准**（6A 红线） |
| movementRole | enum（IN / OUT / 未来 SOURCE_OUT / DESTINATION_IN / CONSUME / PRODUCE / ADJUSTMENT / REVERSAL / CORRECTION） | **启用：SOURCE_OUT / DESTINATION_IN / CONSUME / PRODUCE / ADJUSTMENT** | 6A 已预留枚举位，6B 正式启用 |
| movementGroupId | 已实现（可空） | **Transfer/Conversion/Count-Adjustment 编组正式使用** | 无需改表 |
| movementType | enum（INBOUND / OUTBOUND / 未来 TRANSFER_OUT / TRANSFER_IN / CONSUME / PRODUCE / ADJUSTMENT / REVERSAL / CORRECTION） | **启用：TRANSFER_OUT / TRANSFER_IN / CONSUME / PRODUCE / ADJUSTMENT** | 6A 已预留 |
| idempotencyKey | 五元（sourceType+sourceId+sourceLineId+movementRole+movementAtomKey） | **不变**——Operations 的 sourceId 取业务单据 id、sourceLineId 取业务行 id、movementAtomKey 取 BULK 或 serialNo | 幂等继承 |
| quantity / serialNo 约束 | 已实现（serial 原子化） | 不变 | |

> **6B 不新增独立库存事实表**：Transfer/Count/Adjustment/Conversion 是**业务单据事实**（上述草案表），库存账只以 InventoryMovement 呈现。StockProjection 不加 reservedQty/availableQty（6A P3 Final）。

---

## 6. Outbox / 事件草案（P12 Final：Transfer/Adjustment/Repack Conversion 走同步共享 Ledger Command；6A IN/OUT 维持 Outbox 不动）

| 事件（草案） | 方向 | 说明 |
| --- | --- | --- |
| `InventoryMovementCommitted` | 账本原子事件（6A 已实现，不变） | Movement COMMITTED 后发布，**不含投影余额**（P10 Final） |
| `InventoryTransferExecuted` | 双边 | **业务层事件**（命名对齐 CTO #7975：不用 Committed 与 Ledger 混淆）——Transfer 双边 Movement 同事务落定后发布 |
| `InventoryAdjustmentApplied` | IN/OUT | **业务层事件**——Adjustment Movement 落定后发布 |
| `InventoryConversionExecuted` | 编组 | **业务层事件**——CONSUME + PRODUCE 落定后发布 |
| `InventoryCountCompleted` | 事实 | **业务层事件**——Count 完成（不含库存账变化——差异走 Adjustment） |

> 事件命名统一为 Executed / Applied / Completed（业务语义），`InventoryMovementCommitted` 保留为账本原子事件；Schema Gate 前定稿。

> 事件命名/载荷在 P12 拍板 + Schema Gate 后定稿；`InventoryMovementCommitted`（6A 已实现）继续作为 Movement 落定的通用事件，Operations 事件为业务层补充。
