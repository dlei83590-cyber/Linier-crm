# Sprint 6B：Inventory Operations Field Matrix（库存作业字段矩阵）

- 版本：v0.1（Design First，待 CTO Design Review #7900 拍板；未批准前禁止 Schema / Migration / API）
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
| transferNo | 调拨单号 | DocumentSequence（前缀 TRF / TR，P2 待拍板） | 创建即取号（沿用 5B+ 惯例） |
| status | 状态 | enum（DRAFT / SUBMITTED / APPROVED / EXECUTED / CANCELLED） | P2 待拍板：是否需要独立 Transfer Order 及审批流 |
| transferType | 调拨类型 | enum（INTER_WAREHOUSE / INTRA_WAREHOUSE） | P3 待拍板：跨仓与同仓库位是否统一模型（默认统一） |
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
| batchNo | 批次（可空） | P5 待拍板：batch 精确继承 vs 允许指定新批次 |
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
| countBasisAt | 盘点基准时点 | P6 待拍板：snapshot 时刻 |
| freezeStrategy | 冻结策略 | enum（FREEZE_DIMENSION / DYNAMIC / CONFIGURABLE）——P6 待拍板 |
| snapshotWatermark | 账面快照水位 | 基准时点已入账最大 Movement（movementNo/seq） |
| countedById / completedAt | 盘点人 / 完成时点 | |
| createdById / updatedById | 审计 | |

### 2.2 StockCountLine（盘点明细行）

| 字段（草案） | 语义 | 备注 |
| --- | --- | --- |
| id / countHeaderId | 主键 / 头 FK | |
| warehouseId / locationId / itemId / batchNo / serialNo | 盘点维度（五维） | 与 6A Projection 维度一致 |
| bookQtySnapshot | 账面数（基准时点快照） | 不实时查表——冻结时点值 |
| countedQty | 实盘数 | 业务事实 |
| varianceQty | 差异 = 实盘 - 账面 | 服务端计算 |
| dynamicAdjustment | 盘点期间已入账净变动（动态盘点用） | 服务端计算（盘点期间 IN - OUT） |
| netVarianceQty | 净差异 = varianceQty + dynamicAdjustment | **净差异才生成 ADJUSTMENT**（P6 待拍板） |
| adjustmentRef | 生成的 Adjustment 引用 | Count 本身不碰库存账 |

---

## 3. Adjustment（调整）—— 受控库存账事实草案

| 字段（草案） | 语义 | 类型/约束草案 | 备注 |
| --- | --- | --- | --- |
| id / adjustmentNo | 主键 / 调整单号 | DocumentSequence（前缀 ADJ） | |
| reasonCode | 原因码 | enum（COUNT_VARIANCE / DAMAGE / LOSS / GIFT / SYSTEM_CORRECTION / MANUAL / …） | P8 待拍板：原因码清单与授权映射 |
| direction | 方向 | enum（IN / OUT） | 正负方向（quantity 恒正数） |
| quantity | 数量 | Decimal(18,4) > 0 | 方向承载正负 |
| warehouseId / locationId / itemId / batchNo / serialNo | 维度（五维） | | serial-managed 仍逐 serial 原子化 |
| approvedById | 授权人 | FK → User | P8/P9 待拍板：MANUAL 需高权限角色 |
| sourceReference | 来源引用 | string（countNo / 原单据 / 说明） | 追溯 |
| idempotencyIdentity | 幂等身份 | string（adjustmentNo + lineId + atomKey） | 防重复过账 |
| remark / createdById / updatedById | 审计 | | |

---

## 4. Conversion（转换）—— Consume/Produce 编组草案

### 4.1 ConversionHeader（转换单头）

| 字段（草案） | 语义 | 备注 |
| --- | --- | --- |
| id / conversionNo | 主键 / 转换单号 | DocumentSequence（前缀 CVT） |
| status | 状态 | enum（DRAFT / SUBMITTED / EXECUTED / CANCELLED） |
| movementGroupId | 编组 id（**CONSUME + PRODUCE 共享**） | CTO #7895 强制 |
| uomRelation | 输入/输出 UOM 关系 | P11 待拍板：以同一 UOM 基换算统一守恒口径 |
| executedAt / executedById | 执行时点/人 | |
| remark / 审计 | | |

### 4.2 ConversionLine（转换行——输入或输出）

| 字段（草案） | 语义 | 备注 |
| --- | --- | --- |
| id / conversionHeaderId | 主键 / 头 FK | |
| lineRole | 行角色 | enum（CONSUME / PRODUCE） |
| itemId / uomId / quantity | 物料 / 单位 / 数量 | 守恒：换算后 ΣCONSUME = ΣPRODUCE（P11） |
| warehouseId / locationId | 维度 | 输出可指定目标仓/库位 |
| batchNo（可空） | 批次 | P5/P10 待拍板：继承 vs 新批次 |
| serialNos（可空） | 序列号组 | serial-managed：输入 serial 组 → 输出 serial 组（重生成，继承关系记录在行上） |
| sourceLineRef | 输入→输出继承引用（可空） | 多输入/多输出编组 |

---

## 5. InventoryMovement 扩展字段草案（6A 已实现表——6B 只新增枚举/引用，不重构）

| 字段 | 现状（6A 已实现） | 6B 草案扩展 | 备注 |
| --- | --- | --- | --- |
| sourceType | enum（WAREHOUSE_RECEIPT_POSTED / PURCHASE_RETURN_RETURNED / 未来…） | **新增：TRANSFER / STOCK_COUNT / ADJUSTMENT / CONVERSION**（P12 待拍板后定稿） | **新 sourceType 须 CTO 批准**（6A 红线） |
| movementRole | enum（IN / OUT / 未来 SOURCE_OUT / DESTINATION_IN / CONSUME / PRODUCE / ADJUSTMENT / REVERSAL / CORRECTION） | **启用：SOURCE_OUT / DESTINATION_IN / CONSUME / PRODUCE / ADJUSTMENT** | 6A 已预留枚举位，6B 正式启用 |
| movementGroupId | 已实现（可空） | **Transfer/Conversion/Count-Adjustment 编组正式使用** | 无需改表 |
| movementType | enum（INBOUND / OUTBOUND / 未来 TRANSFER_OUT / TRANSFER_IN / CONSUME / PRODUCE / ADJUSTMENT / REVERSAL / CORRECTION） | **启用：TRANSFER_OUT / TRANSFER_IN / CONSUME / PRODUCE / ADJUSTMENT** | 6A 已预留 |
| idempotencyKey | 五元（sourceType+sourceId+sourceLineId+movementRole+movementAtomKey） | **不变**——Operations 的 sourceId 取业务单据 id、sourceLineId 取业务行 id、movementAtomKey 取 BULK 或 serialNo | 幂等继承 |
| quantity / serialNo 约束 | 已实现（serial 原子化） | 不变 | |

> **6B 不新增独立库存事实表**：Transfer/Count/Adjustment/Conversion 是**业务单据事实**（上述草案表），库存账只以 InventoryMovement 呈现。StockProjection 不加 reservedQty/availableQty（6A P3 Final）。

---

## 6. Outbox / 事件草案（P12 待拍板后定稿）

| 事件（草案） | 方向 | 说明 |
| --- | --- | --- |
| `InventoryTransferCommitted` | 双边 | Transfer 双边 Movement 同事务落定后发布（若走同步 Command，则作为业务事件；若走 Outbox，则业务事实 + atom Outbox 同事务） |
| `InventoryAdjustmentCommitted` | IN/OUT | Adjustment Movement 落定后发布 |
| `InventoryConversionCommitted` | 编组 | CONSUME + PRODUCE 落定后发布 |
| `InventoryCountCompleted` | 事实 | Count 完成（不含库存账变化——差异走 Adjustment） |

> 事件命名/载荷在 P12 拍板 + Schema Gate 后定稿；`InventoryMovementCommitted`（6A 已实现）继续作为 Movement 落定的通用事件，Operations 事件为业务层补充。
