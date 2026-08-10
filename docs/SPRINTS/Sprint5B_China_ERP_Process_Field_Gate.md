# Sprint 5B：China ERP Process & Field Gate Design（中国采购到货→收货→验收→入库 业务边界设计）

- 版本：v0.1（草案，待 CTO Design Review）
- 日期：2026-08-09
- 维护者：CIO（JINZA）｜审核：CTO
- 状态：**设计先行——禁止 Schema / Migration 0023 / API**（Gate 批准后才允许）
- 关联：ADR-0024（草案）/ Sprint5B_Field_Matrix.md / Sprint5B_CTO_Pending_Decisions.md / EVENTS.md / ADR-0023（5A 已 Implemented）

---

## 0. Sprint 5B 范围切分（CTO #6680 拍板）

| 阶段 | 范围 | 状态 |
| --- | --- | --- |
| 5A | PR + PO（需求事实源 + 承诺事实源，APPROVED ≠ CONFIRMED） | ✅ 已合并 main（PR #19，CTO Final Review 97/100） |
| **5B** | **到货 → 收货 → 验收 → 入库 业务边界 + Field Gate**（本阶段） | 🔄 设计先行 |
| 5C | Supplier Invoice + AP（区分 Supplier Invoice Fact / 中国增值税发票 Tax Invoice；已收未票→暂估应付→到票→三单匹配→进项税→AP） | ⬜ 未开始 |
| 6A | Warehouse + InventoryMovement + Stock（**库存唯一事实源**） | ⬜ 未开始 |

> **本阶段铁律（CTO #6680 锁死）**：5B 可以定义"应产生库存动作"的业务事实，**但不得直接把库存余额当事实写入**。真正库存数量变化必须由 Sprint 6A 的 `InventoryMovement` 统一承载。`Migration 0023`、GoodsReceipt 表结构、InventoryMovement 写入、库存余额字段，一律等 Gate 批准后再动。

---

## 1. 现状侦查（已确认，5A 落地事实）

- PO 生命周期已锁死：`DRAFT → SUBMITTED → APPROVED → CONFIRMED → PARTIALLY_RECEIVED → RECEIVED`；`DRAFT → CANCELLED`（APPROVED ≠ CONFIRMED）
- **只有 CONFIRMED PO 才是 5B Goods Receipt 唯一合法来源**（代码/OpenAPI/QA/ADR-0023 四处一致）
- PO Line 已预留投影字段：`receivedQty=0` / `remainingReceiveQty=quantity`（5A 禁客户端改，**5B 唯一回写方**）
- 事件已预留（5B 注册）：`PurchaseOrderPartiallyReceived` / `PurchaseOrderReceived`（GR 聚合投影）；`GoodsReceived` / `SupplierInvoiceCreated`（5C 注册）
- 销售侧对称先例：Delivery（唯一入口经 SO，防超交 availableQty 锁内校验，无 Direct Delivery）；Inventory 尚未建立（Sprint 6）
- 现状无任何 GR/Inventory 模型（5B 边界未越线 ✅）

---

## 2. 五个业务事实边界（本轮设计核心目标）

CTO #6680 要求先把 5 个业务事实边界拍死：**到货、收货、验收、入库、退货**。每个事实必须回答：谁触发、代表什么、产生什么投影、何时连库存。

### 2.1 到货 / 收货（Arrival / Receipt）——供应商送货事实

| 项 | 定义 |
| --- | --- |
| 业务含义 | 供应商按 PO 送货到指定地点，我方记录"实际到了什么、多少" |
| 触发方 | 仓库/收货员（线下验单 → 系统录入） |
| 事实属性 | 供应商实际送达的数量（**物理到货事实 arrivedQty**，可小于、等于或大于 PO 订购数量——超收是独立问题，见 §7）；**只保留收货现场事实**：quantity / visibleDamageQty / rejectedOnReceiptQty / remark |
| 与库存关系 | **不直接产生库存增加**；更新 PO Line 收货投影（**receivedQty = 已被采购履约接受、可冲减 PO 未交数量的累计数量——当场拒收 rejectedOnReceiptQty 不计入**，Blocking ②） |
| 关键约束 | 来源门禁（D2）：`CONFIRMED`→可收；`PARTIALLY_RECEIVED`→可继续收；**`RECEIVED`→禁止普通新增收货**（D9，需 Reopen/Amendment/Approved Over-Receipt Exception）；`DRAFT/SUBMITTED/APPROVED/CANCELLED`→拒绝；无 Direct GR（对齐无 Direct Delivery 锁定项）；**不承载 QC 事实**（Blocking ③，质量判定归 Inspection） |

### 2.2 验收 / 质检（Inspection / QC）——质量合格事实

| 项 | 定义 |
| --- | --- |
| 业务含义 | 对到货进行检验：合格 / 部分合格 / 拒收 / 待检 |
| 触发方 | 质检员（QC） |
| 事实属性 | 合格数量（qualifiedQty）、拒收数量（rejectedQty）、检验模式（inspectionMode）、结论（result）——**统一属于 Inspection，PurchaseReceipt 不再有 acceptedQty/rejectedQty**（Blocking ③） |
| 与库存关系 | **只有"合格可入库"数量才允许进入仓库**；不合格/拒收数量走退货或供应商处理 |
| 模式选择 | 免检 / 抽检 / 全检（SKIP / SPOT / FULL，按 Item 或 Supplier 配置）；**免检 = 系统生成 Inspection=SKIP+QUALIFIED**（不绕过 Inspection，P3 Final） |

### 2.3 入库 / 仓库收货（Warehouse Receipt / Stock In）——采购入库事实

| 项 | 定义 |
| --- | --- |
| 业务含义 | 验收合格的数量正式进入仓库（产生"可库存"事实） |
| 触发方 | 仓库管理员 |
| 事实属性 | 入库仓库/库位、批次/序列号（如需）、生产日期/有效期（如需）、合格入库数量 |
| 与库存关系 | **这是"应产生库存动作"的业务事实**——但它本身不写库存余额；它驱动 Sprint 6A 的 `InventoryMovement(IN)`，由 Movement 更新 Stock Projection |
| 关键约束 | 入库数量 ≤ 验收合格数量 ≤ 到货数量（逐层 ceiling）；超收上限见 §7；**是库存追溯信息（批次/序列号/效期）的 canonical capture point**（P6 Final） |

### 2.4 直送（Direct Delivery / Direct-to-Project）——不入库采购

| 项 | 定义 |
| --- | --- |
| 业务含义 | 供应商直接送货到项目现场/使用地点，**不经过公司仓库库存** |
| 触发方 | 采购/项目侧标记 + 收货确认 |
| 事实链 | `PO CONFIRMED → PurchaseReceipt / Inspection → Direct Delivery → 不进入 Warehouse Stock` |
| 与库存关系 | 不产生 InventoryMovement(IN)；消费/领用由项目侧另行记录（6D 或项目成本） |
| **履约类型** | **`fulfillmentType = WAREHOUSE \| DIRECT_PROJECT`（P4 Final，非简单 boolean）**——在 **PO Line 预先声明**，Confirm PO 时已明确入仓还是直送；PurchaseReceipt 只记录实际执行结果，**不得在到货时把原本"入仓"改成"直送"** |
| 直送字段 | Direct 至少保存：`projectId / deliveryAddress（site）/ receiver / receivedBy / receivedAt / proof（attachment reference）` |
| 关键约束 | **Line 级**（P4 Final）；直送 = 有 PurchaseReceipt、**无 WarehouseReceipt**、无 InventoryMovement(IN) |

### 2.5 采购退货（Purchase Return）——独立退货事实

| 项 | 定义 |
| --- | --- |
| 业务含义 | 因质量不合格/错发/拒收等原因，将货物退回供应商 |
| 事实链 | `PurchaseReturn` = **独立业务事实**（不是负数 GR）——CTO Design Review P5 Final |
| 触发方 | 质检拒收 / 收货后退货 / 后续发现质量问题 |
| 与库存关系 | 若货物已入库，退货产生 InventoryMovement(OUT)（6A）；若未入库（拒收），只记录退货事实不碰库存 |
| 处置 | **`PurchaseReturn.disposition`（Blocking ② 新增，必填）**：`REPLACE_REQUIRED`（供应商仍欠货，重新增加履约剩余待交数量）/ `CREDIT_ONLY`（采购数量最终减少/财务冲减，PO 不一定重新待收） |
| 技术红线 | 是否允许技术层用"负 movement"表达退货 → **留到 Inventory Ledger 设计时决定**（本阶段不拍） |

---

## 3. CTO 核心决策点：GoodsReceipt 到底代表什么？

> CTO #6680：**"GoodsReceipt 到底代表'供应商到货/收货事实'，还是'采购入库事实'；我倾向把两者拆开，避免以后直送、质检待入库、部分收货、退货把一个单据模型压垮。"**

### 3.1 方案 A：单一 GoodsReceipt（不推荐）

一个模型同时承载"到货"+"入库"，用状态区分（如 RECEIVED → QUALIFIED → STOCKED）。

- ✅ 模型少，录入快（收货员一次操作）
- ❌ 直送场景硬塞"仓库"字段；质检待入库没有清晰中间态；部分收货+部分退货+部分入库在一个单子里状态矩阵爆炸；后续 6A 对齐难

### 3.2 方案 B：拆两层（CTO Design Review P1 Final）

| 层 | 模型（草案名，非 Schema） | 职责 |
| --- | --- | --- |
| 收货层 | `PurchaseReceipt`（到货/收货事实） | 记录供应商实际送达（物理到货事实）；**只保留收货现场事实**（quantity/visibleDamageQty/rejectedOnReceiptQty/remark）；更新 PO 收货投影；**不承载 QC 事实** |
| 入库层 | `WarehouseReceipt`（采购入库事实） | 记录"合格数量正式入库到仓库/库位"；携带批次/序列号/效期（**canonical capture point**，P6 Final）；**是驱动 InventoryMovement(IN) 的业务事实** |

- ✅ 直送 = 只有 PurchaseReceipt，没有 WarehouseReceipt（自然表达"不入库"）
- ✅ 质检待入库 = PurchaseReceipt 已建、WarehouseReceipt 未建（清晰中间态）
- ✅ 部分收货 = 多次 PurchaseReceipt；部分入库 = 多次 WarehouseReceipt（各自独立 ceiling）
- ✅ 退货 = 独立 PurchaseReturn，与两层正交
- ❌ 模型多一层（收货一次操作要两笔录入，或系统联动生成）

### 3.3 推荐目标链（CTO #6680 锁死）

```
PO CONFIRMED
   ↓
PurchaseReceipt（到货/收货事实；更新 PO receivedQty/remainingReceiveQty）
   ↓
Inspection / QC（合格/部分合格/拒收/待检）—— 可与收货合并录入或独立
   ↓
WarehouseReceipt（采购入库事实；仓库/库位/批次/序列号/效期）
   ↓
InventoryMovement(IN)（Sprint 6A 唯一库存事实源）
   ↓
Stock Projection（库存余额投影，任何模块不得直接改）
```

**直送链**：`PO CONFIRMED → PurchaseReceipt / Inspection → Direct Delivery → 不进入 Warehouse Stock`

**退货链**：`PurchaseReturn（独立事实）→ 已入库部分 → InventoryMovement(OUT)（6A）；未入库部分 → 仅退货事实`

---

## 4. 部分收货（Partial Receipt）

| 规则 | 草案（CTO Design Review 已拍板） |
| --- | --- |
| 允许多次收货 | ✅ 一个 PO Line 允许多次 PurchaseReceipt（对齐销售侧多次 Delivery 先例） |
| ceiling | 累计**被接受收货** ≤ PO Line 订购数量 + 有效容差（§7；容差默认 0%） |
| 投影回写 | 每次 PurchaseReceipt 后更新 PO Line `receivedQty`（**= 被采购履约接受、可冲减未交数量的累计数量；当场拒收 rejectedOnReceiptQty 不计入**，Blocking ②）与 `remainingReceiveQty` |
| 全部收完 | 累计被接受收货 ≥ 订购数量（且无退货挂起）→ PO status → `RECEIVED`；否则 `PARTIALLY_RECEIVED` |
| 并发 | 事务内 Lock PO Line（FOR UPDATE）→ 校验 ceiling → 写投影（对齐 5A Confirm 行锁模式） |
| 事件 | `PurchaseOrderPartiallyReceived` / `PurchaseOrderReceived`（5B 注册） |

## 5. 超收容差与审批（Over-Receipt Tolerance & Approval）

| 规则 | 草案（Blocking ① 修正，P2 Final） |
| --- | --- |
| **System Default** | **0%**（不默认 5%——工业品按件采购超收可能意味着错误收货；业务人员不应把超 PO 当正常路径） |
| 容差优先级 | `PO Line override → Supplier+Item policy → Item policy → Supplier policy → System 0%` |
| 超容差处理 | **只要超出当前有效容差：不直接收货 → 进入 Over-Receipt Approval（Workflow 审批）**；不设“5% 以内天然合法” |
| 容差计算 | 单 Line 维度：`累计被接受收货 ≤ quantity × (1 + 有效容差%)`；超出 → Over-Receipt Approval |
| 超收后金额 | PO 金额事实不变（单价×原数量）；超收部分成本口径留 5C 供应商发票/AP 时定 |
| 防超收红线 | 与 5A“GR 防超收 = PO Line 数量 ceiling”一致；`remainingReceiveQty` 服务端计算，禁客户端直传 |

## 6. 质检（Inspection / QC）——独立事实（Blocking ③，P3 Final）

| 规则 | 草案 |
| --- | --- |
| 模式 | **SKIP / SPOT / FULL**（免检 / 抽检 / 全检，按 Item 或 Supplier 配置） |
| **独立事实** | **质量判定统一属于 Inspection**（qualifiedQty / rejectedQty / inspectionMode / result）；**PurchaseReceipt Line 不承载 acceptedQty/rejectedQty**（只留现场事实）——避免两套质量事实源 |
| 免检 | **系统生成 Inspection = SKIP + QUALIFIED**（不绕过 Inspection 直接让 Receipt 成为质量事实） |
| 结论 | 合格 / 部分合格 / 拒收 / 待检（待检 = 未决，不产生入库资格） |
| 数量关系 | 合格入库数量 ≤ qualifiedQty ≤ 到货数量（逐层 ceiling） |
| 拒收 | 拒收数量 → PurchaseReturn（独立事实）；不产生 WarehouseReceipt |
| 待检库存 | 待检期间货物不进入“可库存”；6A 是否表达“待检库存”状态 → **Pending Decision P3b** |
| 质量链 | **PurchaseReceipt → Inspection → WarehouseReceipt**（无第二套 QC 事实源） |

## 7. 仓库 / 库位（Warehouse / Location）

| 规则 | 草案（Blocking ④ 修正，P8 Final） |
| --- | --- |
| 第一版 | 单仓 + 可选库位（是否多仓 / 库位是否必填 → **Pending Decision P8** 剩余子项） |
| 模型来源 | **5B 建最小 Warehouse / Location 主数据**（收货/入库需要仓库维度；参考 Supplier 主数据先例）；**6A 接管库存能力扩展**（Stock / InventoryMovement / 库位深度） |
| 入库事实 | WarehouseReceipt 记录 仓库 id + 库位 id（可空） |

## 8. 批次 / 序列号 / 生产日期 / 有效期（Batch / Serial / MFG / EXP）

| 规则 | 草案 |
| --- | --- |
| 采集时机 | **WarehouseReceipt（入库层）是库存追溯信息（批次/序列号/效期）的 canonical capture point**（P6 Final）——只有合格入库才需要批次信息 |
| 批次 | 按 Item 配置是否需要批次；入库时录入或系统生成批号 |
| 序列号 | 按 Item 配置（高价/受控物料）；入库时逐个登记 |
| 生产日期/有效期 | 食品/化工/医疗类 Item 需要（MFG / EXP）；入库时录入；预警在 6A/BI 做 |
| 追溯 | 后续出库/退货/质量问题可通过批次/序列号追溯回 WarehouseReceipt → PurchaseReceipt → PO → Supplier |

## 9. 何时触发库存增加（Inventory Trigger）——红线

| 规则 | 锁死 |
| --- | --- |
| **不直接写库存** | 5B 任何模型/API **不得**直接修改 Stock 余额字段（`stock.qty += x` 禁止） |
| 触发事实 | **WarehouseReceipt（采购入库事实）= 应产生库存动作的业务事实** |
| **Created ≠ Posted（D10）** | **WarehouseReceipt 创建（Created）只是草稿/登记态，不触发任何库存动作；只有 Posted（过账/确认）才触发 InventoryMovement(IN)** |
| 库存唯一事实源 | 只有 Sprint 6A 的 `InventoryMovement(IN)` 才能改变 Stock Projection |
| 5B-6A 衔接 | WarehouseReceipt **Posted** 后 5B 发布事件（如 `WarehouseReceiptPosted`），6A 消费并生成 InventoryMovement(IN)；或 6A 实现时 WarehouseReceipt Posted 直接驱动 Movement（实现细节 Gate 后定） |
| 投影 | PO Line receivedQty/remainingReceiveQty 的"已收"口径由 5B 收货层回写（**这是允许的投影**，不是库存） |

## 10. 采购退货（Purchase Return）设计草案

| 项 | 草案 |
| --- | --- |
| 独立事实 | `PurchaseReturn` 独立模型（Header + Lines），不做负数 GR；**必须有来源**（收货行/入库行/质检结论，P5 Final） |
| 来源 | 质检拒收（未入库）/ 入库后退货（已入库，需 InventoryMovement(OUT)）/ 后续质量问题 |
| 数量 | 退货数量 ≤ 原收货数量（防超退；锁内校验） |
| **disposition** | **`PurchaseReturn.disposition`（Blocking ② 新增，必填）**：`REPLACE_REQUIRED`（供应商仍欠货，重新增加履约剩余待交数量）/ `CREDIT_ONLY`（采购数量最终减少/财务冲减，PO 不一定重新待收） |
| 库存衔接 | 已入库部分 → 6A InventoryMovement(OUT)；未入库部分 → 仅事实 |
| 技术红线 | 是否允许"负 movement"表达退货 → **留到 Inventory Ledger（6A）设计时决定**（CTO #6680 明确） |
| 金额/财务 | 退货金额冲减在 5C Supplier Invoice / AP（红字发票/退货单）处理，5B 不碰金额 |

## 11. 事件注册（5B，先注册后开发，对齐 EVENTS.md 纪律；P10 Final——业务动作事件，不以 Draft Created 作为完成事实事件）

| eventType | 触发 | 注册时机 |
| --- | --- | --- |
| `PurchaseReceiptReceived` | 收货完成（业务动作） | 5B 实现时 |
| `InspectionCompleted` | 质检结论落定 | 5B 实现时 |
| `WarehouseReceiptPosted` | 入库过账完成（驱动 6A；Created≠Posted，只有 POSTED 触发） | 5B 实现时 |
| `PurchaseReturned` | 退货完成 | 5B 实现时 |
| `PurchaseOrderPartiallyReceived` / `PurchaseOrderReceived` | PO 收货投影聚合（ADR-0023 已预留） | 5B 实现时 |
| `GoodsReceived` | 5C 注册（EVENTS.md 已注明） | 5C |

> 事件命名采用业务动作完成态（Received/Completed/Stocked/Returned），非 Draft Created（P10 Final）。

## 12. 边界红线（5B 实现范围）

- ✅ **Schema + Migration 0023 已获 CTO Gate 批准**（范围见 §13：Warehouse/WarehouseLocation 最小主数据 + GoodsReceipt 相关模型）
- ✅ **5B 允许创建最小 Warehouse / WarehouseLocation 主数据**（P8 Final）；❌ **不创建 Stock / InventoryMovement / 库存余额模型（OnHandQty/AvailableQty/ReservedQty/InventoryBalance），这些属于 6A**
- ❌ 任何代码不得直接写库存余额
- ❌ 不实现 Supplier Invoice / 三单匹配 / AP（5C）
- ❌ 不决定"负 movement 是否允许"（留 6A Inventory Ledger）
- ✅ 本阶段产出：4 份设计文档（本文 + ADR-0024 + Field Matrix + Pending Decisions）→ Schema + Migration 0023

## 13. CTO Design Review 后动作

1. CTO 复核 5 个事实边界 + Pending Decisions（P1-P10）
2. Gate 批准后：Schema + Migration 0023（GoodsReceipt 相关模型）→ Seed/RBAC → API → Workflow → OpenAPI → QA → Final Review
3. 5B 完成后进入 6A（Warehouse + InventoryMovement + Stock）
