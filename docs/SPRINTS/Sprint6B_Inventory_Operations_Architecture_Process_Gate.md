# Sprint 6B：Inventory Operations Architecture & Process Gate（库存作业架构与流程门禁）

- 版本：v0.1（Design First，待 CTO Design Review #7900 拍板）
- 日期：2026-08-11
- 维护者：CIO（JINZA）｜审核：CTO
- 状态：**设计先行——禁止 Schema / Migration / API / Consumer 改造**（CTO Design Review 批准后才允许）
- 关联：ADR-0026（Proposed）/ Sprint6B_Inventory_Operations_Field_Matrix.md / Sprint6B_CTO_Pending_Decisions.md / ADR-0025（6A Implemented，Sprint 6A FINAL APPROVED 99/100 #7865）/ EVENTS.md（v1.26）/ Sprint6A_Inventory_Ledger_Architecture_Process_Gate.md

---

## 0. Sprint 6B 范围切分（CTO #7895 拍板）

| 阶段 | 范围 | 状态 |
| --- | --- | --- |
| 6A | Inventory Ledger Foundation（SSOT Movement + StockProjection + Transactional Outbox + Consumer + Ledger Command + MV 编号源 + consume RBAC） | ✅ 已合并 main（PR #21，`67c031d`，CI run #208 全绿） |
| **6B** | **Inventory Operations Gate（Transfer / Stock Count / Adjustment / Conversion——Design First）**（本阶段） | 🔄 设计先行（本轮只交付 4 份设计文档） |
| 6B+ | Reservation / ReservedQty / AvailableQty | ⬜ 继续 HOLD（CTO #7895） |
| 6B+ | Costing / FIFO / Moving Average / valuation | ⬜ 继续 HOLD（CTO #7895；6A P4 Final 连 costSnapshot 都不放） |
| 6B+ | Sales shipment OUT 等其他新 sourceType | ⬜ 继续 HOLD（CTO #7895） |
| 5C/7B | Supplier Invoice + AP / Payment | ⬜ 未开始 |

> **本阶段铁律（CTO #7895 锁死）**：6B 目标**不是先设计"Transfer/Count 表"**，而是先定义**库存作业事实怎么产生、怎么编组、怎么不可变地落入 6A SSOT**。四件事最容易污染库存账：Transfer 双边原子性、Count 与 Adjustment 的事实边界、Conversion 的 Consume/Produce 守恒、以及绕过 Ledger Command 直写 Projection。必须先拍事实边界，再允许 Schema/Migration。

---

## 1. 现状侦查（6A 已落地事实，6B 继承基线）

- **6A SSOT 已生效**：`InventoryMovement` = 库存数量唯一事实源；`StockProjection` = 物化投影（与 Movement 同事务更新）；Movement COMMITTED 后不可变（immutable trigger）；纠错只允许追加 Reversal/Correction
- **Ledger Command 已固化**：`consumeOutboxMessage`（五元幂等 `sourceType+sourceId+sourceLineId+movementRole+movementAtomKey`、五维锁 `warehouseId+locationId+itemId+batchNo+serialNo` NULLS NOT DISTINCT、OUT 禁负库存、Movement+Projection+Outbox PROCESSED 同事务）
- **Transactional Outbox 已固化**：`writeInventoryOutboxAtom` + `expandSourceLineAtoms`（业务事实 + Outbox 同事务）；`consumePendingOutboxBatch` / `runInventoryConsumer`（FOR UPDATE SKIP LOCKED + lease fencing + retry 退避 + DEAD_LETTER）
- **触发端点已固化**：`POST /api/inventory-ledger/consume`（权限 `inventory-ledger:consume`，受限系统权限，仅 SUPER_ADMIN/ADMIN）
- **编号源已固化**：DocumentSequence `INVENTORY_MOVEMENT`（MV，seed 幂等 upsert）；缺失 = 配置错误 RETRY，无 fallback
- **5B 事实链基线**：WarehouseReceipt POSTED → `WarehouseReceiptPosted`（IN）；PurchaseReturn RETURNED（WAREHOUSE_RECEIPT_LINE）→ `PurchaseReturned`（OUT）；批次/序列号/效期 canonical capture = WarehouseReceipt 入库层
- **事件基线**：`InventoryMovementCommitted`（Consumer 单事务提交后发布，不含投影余额）
- **movementGroupId 已预留**（6A Field Matrix）：Transfer/Conversion 多笔 Movement 编组用（替代 Header/Line 两层）——6B 正是它的第一批消费方

---

## 2. 核心原则：Operations 不得建立第二套库存事实源（6A 红线继承）

| 规则 | 锁死 |
| --- | --- |
| **单事实源继承** | 6B 所有库存变化**最终只能形成不可变 `InventoryMovement`**；`StockProjection` 继续只是 Movement 的物化投影。**6B 不建第二套库存事实源**（不建 OnHand/Stock 业务表） |
| **业务 API 禁直写（CTO 红线）** | Transfer/Count/Adjustment/Conversion 业务 API **不得直接 INSERT InventoryMovement / UPDATE StockProjection**。必须经 Ledger Command（同步）或 Transactional Outbox + Consumer（异步） |
| **编组事实** | 一组 Operations 业务事实 → **一组原子 Movement**（同一 `movementGroupId`）：Transfer = SOURCE_OUT + DESTINATION_IN；Conversion = CONSUME + PRODUCE；Count → Variance → ADJUSTMENT |
| **原子性** | 编组内 Movement **全有或全无**：同事务提交（同步 Command 直接同事务；异步 Outbox 以"业务事实 + 全部 atom Outbox 同事务"保证意图原子，Consumer 逐 atom 消费但幂等+重放保证最终一致） |
| **幂等继承** | 每个 Movement 继续使用五元幂等键；Operations 业务事实携带自己的幂等身份（transferNo / countNo / adjustmentNo + lineId + atomKey），Reversal/Correction 拥有独立身份 |
| **禁负库存继承** | 所有 OUT（SOURCE_OUT / CONSUME / ADJUSTMENT 负向）继续在五维锁内检查 `onHandQty >= outQty`，不足稳定拒绝（409） |
| **历史不可变继承** | 已 COMMITTED Movement 不可改/删；Operations 纠错 = 追加 Reversal/Correction Movement，**禁止编辑历史 Movement / 直接改 Projection** |

---

## 3. Transfer（调拨）—— 双边原子事实

### 3.1 事实模型

Transfer 是一个**业务事实**（调拨单：从哪来、到哪去、调什么、调多少、谁批准），但库存账表现为**成对原子事实**：

```
TransferLine（业务事实，同一 transferGroupId）
  ├─ SOURCE_OUT Movement（movementRole 取 SOURCE_OUT，direction 取 OUT，movementGroupId 取 G）
  └─ DESTINATION_IN Movement（movementRole 取 DESTINATION_IN，direction 取 IN，movementGroupId 取 G）
```

### 3.2 原子性（CTO #7895 强制）

- **全有或全无**：SOURCE_OUT 与 DESTINATION_IN **必须同事务提交**。禁止先 OUT、后异步 IN（否则产生运输途中"库存凭空消失"的账务窗口）
- **同一 `movementGroupId`**：双边 Movement 共享编组 id，供对账/冲销整组引用
- **源仓锁定**：OUT 侧在五维锁内检查 `onHandQty >= qty` 并锁定源维度（防并发超扣）；IN 侧目标维度按目标仓/库位创建/更新投影
- **并发防超扣**：同一源维度并发 Transfer → 五维行锁串行化，第二个等待者看到新余额后稳定拒绝

### 3.3 维度规则（P3/P5 待拍板，默认推荐）

| 场景 | 维度处理（推荐草案） |
| --- | --- |
| 同仓不同库位 | SOURCE_OUT（源 location）+ DESTINATION_IN（目标 location），warehouseId 相同 |
| 跨仓调拨 | SOURCE_OUT（源 warehouse/location）+ DESTINATION_IN（目标 warehouse/location），warehouseId 不同 |
| serial-managed | 每 serial 一对 Movement（SOURCE_OUT serialNo=X + DESTINATION_IN serialNo=X），**serial 精确继承不重生成**（P5） |
| batch-managed | 批次精确继承：SOURCE_OUT batchNo=B → DESTINATION_IN batchNo=B（P5 待拍板：是否允许指定新批次/拆分） |
| 数量 | 双边 quantity 相等（守恒）；UOM 继承来源 |

### 3.4 冲销

整组冲销：追加 REVERSAL 对（SOURCE_IN（回源）+ DESTINATION_OUT（回目标））同一新 movementGroupId，引用原双边 Movement；数量、维度、serial/batch 精确回退。

---

## 4. Stock Count（盘点）—— 实盘事实 ≠ 库存账事实

### 4.1 事实边界（CTO #7895 强制）

**StockCount 本身只是"实盘事实"**，不能成为库存账事实。必须坚持：

```
StockCount（实盘事实：countNo / 盘点维度 / 实盘数量 / 盘点人 / 盘点时点）
  → Count Result（实盘明细，含系统账面数 snapshot）
  → Variance（实盘 - 账面 = 差异）
  → Adjustment Command（经审批/阈值规则）
  → InventoryMovement(ADJUSTMENT)（movementGroupId 编组，逐差异行）
```

**严禁**：`StockCount → UPDATE StockProjection`（跳过 Movement 的直接改投影）。

### 4.2 关键设计点（P6/P7 待拍板）

- **盘点基准时点**：Count 的账面比较基准 = 盘点开始时的 StockProjection snapshot（冻结时刻）还是完成时点？推荐：**盘点单创建时取 snapshot（含 movementNo 水位）**
- **盘点期间业务冻结**：冻结策略三选一（P6）：① 冻结该维度全部业务（强一致，成本高）② 不冻结，差异按"snapshot 后发生的 Movement"补偿（动态盘点，推荐草案）③ 冻结窗口配置化
- **snapshot 后发生的 Movement**：动态盘点下，实盘数 - snapshot 数 = 原始差异；再叠加盘点期间已入账 Movement → 净差异 = 原始差异 + (盘点期间 IN - OUT)。**净差异才生成 ADJUSTMENT**，避免把正常业务 Movement 当差异
- **重复过账幂等**：同一 countNo + lineId + adjustmentNo 幂等；ADJUSTMENT Movement 五元键含 countNo+lineId+atomKey；重复提交 → 已存在 → 409/忽略
- **差异处理**：差异 = 0 → 不生成 Movement；差异 ≠ 0 → 逐行 ADJUSTMENT（正差异 = IN 方向补账，负差异 = OUT 方向冲减，均经禁负库存检查——负差异不足时拒绝并人工复核）

---

## 5. Adjustment（调整）—— 受控的库存账事实

### 5.1 事实模型（P8/P9 待拍板）

Adjustment 是**独立业务原因 + 授权边界**的库存账事实，字段草案至少：

```
adjustmentNo / reasonCode（原因码：COUNT_VARIANCE / DAMAGE / LOSS / GIFT / SYSTEM_CORRECTION / MANUAL…）
direction（IN/OUT，正负方向）
quantity（正数，方向承载正负）
warehouseId / locationId / itemId / batchNo / serialNo（维度）
approvedBy（授权人）
sourceReference（来源引用：countNo / 原单据 / 说明）
idempotencyIdentity（adjustmentNo + lineId + atomKey）
remark / 审计字段
```

### 5.2 边界（CTO #7895 强制）

- Adjustment **只能通过 Ledger Command 追加 Movement**（同事务同步命令——Adjustment 数量小、即时性强，推荐同步；P12 待拍板）
- **禁止编辑历史 Movement**（6A immutable 继承）
- **禁止直接改 Projection**
- 人工创建：CTO 倾向 **允许但高权限 + 强审计**（P9）——MANUAL reasonCode 需高权限角色（如 SUPER_ADMIN/ADMIN + inventory-adjustment 权限），全部留审计轨迹，且 serial-managed 人工调整仍逐 serial 原子化

---

## 6. Conversion（转换）—— Consume/Produce 编组守恒

### 6.1 事实模型（P10/P11 待拍板）

Conversion 是**同一个业务事实组**下的：

```
Conversion（业务事实：conversionNo / 输入组 + 输出组 / UOM 关系）
  ├─ CONSUME Movement × N（输入：消耗库存，OUT 方向，同一 movementGroupId）
  └─ PRODUCE Movement × M（输出：产出库存，IN 方向，同一 movementGroupId）
```

### 6.2 守恒与继承（CTO #7895 强制）

- **输入/输出数量守恒 ≠ 简单 1:1**：可能 2 输入 → 1 输出、1 输入 → 3 输出。设计必须回答：
  - **UOM 转换**：输入 KG → 输出 PC，如何表达？推荐：以**同一 UOM 基（uomId 或换算率）**统一守恒口径，Movement 各自记录自己 UOM 与 quantity，编组内换算后总量守恒（P11 待拍板）
  - **batch/serial 继承或重新生成**：输入 batch B → 输出可继承 B（推荐默认）或生成新 batch；serial-managed 输入 serial 组 → 输出 serial 组（重生成 serialNo，继承关系记录在 Conversion 行，不塞进 Movement）
  - **多输入/多输出原子提交**：全部 CONSUME + PRODUCE 同事务（同步 Command）或业务事实 + 全部 atom Outbox 同事务（异步）——**绝不允许部分提交**（P10/P12 待拍板）
- **CONSUME 禁负库存**：每个输入维度在五维锁内检查余额，不足稳定拒绝（409），整组不提交

---

## 7. Operations → Ledger 分层：同步 Command vs Transactional Outbox（P1/P12 待拍板）

| Operations | 推荐草案 | 理由 |
| --- | --- | --- |
| **Transfer** | **同步双边 Ledger Command**（业务事实 + SOURCE_OUT + DESTINATION_IN 同事务） | 双边原子性要求最高；运输窗口不可接受；同步保证"调拨单成功 = 库存账已双边落定" |
| **Adjustment** | **同步 Ledger Command** | 数量小、即时性强、人工触发；同步失败即业务失败（稳定 409） |
| **Conversion** | **同步 Ledger Command**（推荐）或 Outbox 编组 | 多输入/多输出原子提交优先；同步最直观；量级小 |
| **Count → Adjustment** | Count 落库（业务事实）→ **Adjustment Command 同步**（经审批后） | Count 本身不碰库存账；差异经 Adjustment 走同步命令 |
| **6A 现有 IN/OUT（入库/退货）** | **Transactional Outbox + Consumer**（不变，不动） | 6A 已 FINAL APPROVED，6B 不改造 |

> 备选（P1）：Transfer/Conversion 走 **Transactional Outbox 编组**（业务事实 + N 个 atom Outbox 同事务，Consumer 逐 atom 幂等消费）。风险：部分 atom 消费失败 → 编组暂不完整 → 需编组级完成检测/补偿；账务窗口取决于消费延迟。**推荐同步 Command**（6B 规模下同步更简单、更强一致）。

---

## 8. 明确排除（CTO #7895，本轮不设计）

- **Reservation / ReservedQty / AvailableQty**（availableQty 不作为 canonical 字段——6A P3 Final 延续）
- **Costing / FIFO / Moving Average / valuation**（6A P4 Final 延续；连 costSnapshot 都不放）
- **Sales shipment OUT 等其他新 sourceType**（销售出库后续独立阶段）
- 不得因为 Transfer/Conversion 需要数量操作而顺手进入成本核算

---

## 9. 交付物与 Gate

本轮交付（docs-only，Design First）：
1. 本文件（Architecture & Process Gate）
2. `docs/ADR/ADR-0026-inventory-operations-boundary.md`（Proposed）
3. `docs/SPRINTS/Sprint6B_Inventory_Operations_Field_Matrix.md`（Design Only / Not Schema）
4. `docs/SPRINTS/Sprint6B_CTO_Pending_Decisions.md`（P1-P12）

**Gate 流程**：commit → push → docs-only PR → GitHub CI → STOP → **CTO Sprint 6B Design Review**（重点：P1-P12、四条库存账红线落地、6A SSOT 零污染、CI 状态）→ 批准后才允许 Schema/Migration。
