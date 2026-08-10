# Sprint 5B：Field Matrix（中国采购到货→收货→验收→入库 字段矩阵）

- 版本：v0.1（草案，待 CTO Design Review）
- 日期：2026-08-09
- 状态：**设计先行——禁止 Schema / Migration 0023 / API**
- 关联：Sprint5B_China_ERP_Process_Field_Gate.md / ADR-0024（草案）/ Sprint5B_CTO_Pending_Decisions.md

> 说明：本矩阵是**字段草案**（业务语义层），不是 Schema。所有字段名/类型/约束待 Gate 批准后由 Migration 0023 落地。带 🔶 的字段为 Pending Decision（见 Pending Decisions 文档）。

---

## 1. PurchaseReceipt（到货/收货事实）—— 供应商送货

### Header

| 字段（草案） | 语义 | 类型/约束草案 | 备注 |
| --- | --- | --- | --- |
| id | 主键 | UUID | |
| code | 收货单号 | DocumentSequence（前缀 REC / GRN-，**P10 拍板**） | 创建即取号 |
| purchaseOrderId | 来源 PO | FK → PurchaseOrder，必填 | **只有 CONFIRMED/PARTIALLY_RECEIVED/RECEIVED PO 可收货**（D2） |
| supplierId | 供应商 | 快照自 PO（不单独校验） | 对齐 PO 快照原则 |
| warehouseId | 到货地点 | FK → Warehouse（**5B 建最小主数据**，P8 Final），**可空** | **仅 WAREHOUSE 收货场景使用**（Blocking ①）；DIRECT_PROJECT 直送不用 warehouse，用 deliveryAddress/receiver/proof + Header receivedAt/receivedBy |
| status | 收货单状态 | 草案：`DRAFT / RECEIVED / CANCELLED` | **普通收货不走审批**（P1b Final）；超收/特殊退货才走 Workflow |
| receivedAt | 收货时间 | date-time | |
| receivedById | 收货员 | FK → User | |
| remark | 备注 | string(500) | |
| createdById / updatedById | 审计 | FK → User | |
| deletedAt / isActive | 软删 | 对齐既有模式 | |

### Lines（Blocking ③：只保留收货现场事实，不承载 QC 事实）

| 字段（草案） | 语义 | 类型/约束草案 | 备注 |
| --- | --- | --- | --- |
| id | 主键 | UUID | |
| purchaseReceiptId | 头 | FK | |
| purchaseOrderLineId | 来源 PO Line | FK → PurchaseOrderLine，必填 | 行级溯源 |
| lineNo | 行号 | int | |
| itemId | 物料 | FK → Item | |
| quantity | **物理到货数量（arrivedQty）** | Decimal > 0 | 可 <、=、> PO 订购量（超收见 §7） |
| uomId | 单位 | FK → UoM | 快照自 PO Line |
| visibleDamageQty | 收货现场可见损坏数量 | Decimal ≥ 0，默认 0 | 收货当场发现损坏（Blocking ③：改名自 rejectedQty，避免与 QC 拒收混淆） |
| rejectedOnReceiptQty | 收货现场即拒收数量 | Decimal ≥ 0，默认 0 | **不计入 PO receivedQty**（Blocking ②） |
| remark | 备注 | string(500) | |
| ~~acceptedQty / rejectedQty~~ | ~~收货验收合格/拒收~~ | **移除** | **质量判定统一归 Inspection**（Blocking ③，避免两套 QC 事实源） |
| batchNo / serialNos / mfgDate / expDate | 批次/序列号/效期 | **不在此层** | **canonical capture point = WarehouseReceipt**（P6 Final） |

---

## 2. Inspection / QC（验收/质检事实）—— 独立质量事实源（Blocking ③，P3 Final）

> **Inspection 独立模型，统一承载质量判定**（SKIP / SPOT / FULL）；PurchaseReceipt 不承载 acceptedQty/rejectedQty；免检 = 系统生成 Inspection=SKIP+QUALIFIED。质量链：`PurchaseReceipt → Inspection → WarehouseReceipt`。

| 字段（草案） | 语义 | 类型/约束草案 | 备注 |
| --- | --- | --- | --- |
| id | 主键 | UUID | |
| purchaseReceiptLineId | 来源收货行 | FK | |
| inspectionMode | 检验模式 | 枚举：`SKIP / SPOT / FULL` | 按 Item/Supplier 配置（**P3**） |
| result | 结论 | 枚举：`QUALIFIED / PARTIAL / REJECTED / PENDING` | 待检 = 未决 |
| qualifiedQty | 合格数量 | Decimal ≥ 0 | 合格入库 ceiling |
| rejectedQty | 拒收数量 | Decimal ≥ 0 | → PurchaseReturn |
| inspectedById | 质检员 | FK → User | |
| inspectedAt | 检验时间 | date-time | |
| remark | 检验说明 | string(500) | |

---

## 3. WarehouseReceipt（采购入库事实）—— 合格入库（P6 Final：库存追溯信息 canonical capture point）

### Header

| 字段（草案） | 语义 | 类型/约束草案 | 备注 |
| --- | --- | --- | --- |
| id | 主键 | UUID | |
| code | 入库单号 | DocumentSequence（前缀 IN / WHR-，P10 Final 命名） | 创建即取号 |
| purchaseReceiptId | 来源收货单 | FK → PurchaseReceipt | 可多次入库（部分入库） |
| warehouseId | 入库仓库 | FK → Warehouse（**5B 建最小主数据**，P8 Final） | 必填 |
| locationId 🔶 | 库位 | FK → Location（可空） | **P8** 剩余子项：库位是否必填 |
| status | 入库单状态 | 草案：`DRAFT / POSTED / CANCELLED`（**Created ≠ Posted，D10**） | **只有 POSTED 才触发 InventoryMovement(IN)**；DRAFT 只是草稿/登记态；**已删除 stockedAt/stockedById（Blocking ④：杜绝双完成事实，统一 status+postedAt+postedById）** |
| postedAt | 过账时间（D10） | date-time | 触发库存动作的生效点 |
| postedById | 过账人（D10） | FK → User | |
| createdById / updatedById | 审计 | FK → User | |
| deletedAt / isActive | 软删 | | |

### Lines

| 字段（草案） | 语义 | 类型/约束草案 | 备注 |
| --- | --- | --- | --- |
| id | 主键 | UUID | |
| warehouseReceiptId | 头 | FK | |
| purchaseReceiptLineId | 来源收货行 | FK | 溯源 |
| inspectionId | 来源质检结论（**必填**，Blocking ②） | FK → Inspection（**组合 FK**：`(inspectionId, purchaseReceiptLineId)` → `Inspection(id, purchaseReceiptLineId)`，Schema Integrity B①） | 入库必须引用**同一收货行**的具体质检结论（拒绝"收货行 A + 检验 B"串线）；累计 posted qty ≤ 对应 Inspection qualifiedQty |
| itemId | 物料 | FK → Item | |
| quantity | **入库数量** | Decimal > 0 | ≤ 合格数量（逐层 ceiling） |
| uomId | 单位 | FK → UoM | |
| batchNo | 批次号 | string | **P6 Final：canonical capture point**（入库层采集） |
| serialNos | 序列号列表 | string[] | **P6 Final** |
| mfgDate | 生产日期 | date | **P6 Final** |
| expDate | 有效期至 | date | **P6 Final** |
| remark | 备注 | string(500) | |

> **红线（D3）**：WarehouseReceipt = “应产生库存动作”的业务事实，**不直接写库存余额**；驱动 6A `InventoryMovement(IN)`。

---

## 4. Direct Delivery（直送）标记（P4 Final：Line 级 + fulfillmentType，PO Line 预先声明）

| 字段（草案） | 语义 | 类型/约束草案 | 备注 |
| --- | --- | --- | --- |
| fulfillmentType | **履约类型（P4 Final，非简单 boolean）** | 枚举：`WAREHOUSE \| DIRECT_PROJECT` | 在 **PO Line 预先声明**；Confirm PO 时已明确入仓还是直送 |
| projectId 🔶 | 直送项目/使用地点 | FK → Project（可空） | Direct 必填 |
| deliveryAddress 🔶 | 直送地址 / site | string | Direct 必填 |
| receiver 🔶 | 现场接收人 | string | Direct 必填 |
| receivedBy | 确认收货人 | FK → User | Direct 必填 |
| receivedAt | 现场收货时间 | date-time | Direct 必填 |
| proof 🔶 | 签收证明 / attachment reference | string | Direct 必填 |

> 直送 = 有 PurchaseReceipt、**无 WarehouseReceipt**；不产生 InventoryMovement(IN)。**PO Line 在 Confirm 时已声明 fulfillmentType=DIRECT_PROJECT，PurchaseReceipt 只记录实际执行结果，不得在到货时把原本"入仓"改成"直送"**（P4 Final）。

---

## 5. PurchaseReturn（采购退货事实）—— 独立事实，非负 GR（P5 Final：必须有来源 + disposition）

### Header

| 字段（草案） | 语义 | 类型/约束草案 | 备注 |
| --- | --- | --- | --- |
| id | 主键 | UUID | |
| code | 退货单号 | DocumentSequence（前缀 PRT-，P10 Final 命名） | 创建即取号 |
| purchaseOrderId | 来源 PO | FK | 溯源 |
| supplierId | 供应商 | 快照自 PO | |
| returnType | 退货类型 | 枚举：`REJECTED_ON_RECEIPT`（收货拒收）/ `RETURN_AFTER_STOCK_IN`（入库后退货）/ `QUALITY_ISSUE`（质量问题） | |
| status | 退货单状态 | 草案：`DRAFT / RETURNED / CANCELLED` | **P1b Final**：普通退货不审批；特殊退货走 Workflow |
| returnedAt | 退货时间 | date-time | |
| returnedById | 经办人 | FK → User | |
| remark | 备注 | string(500) | |
| createdById / updatedById | 审计 | FK → User | |
| deletedAt / isActive | 软删 | | |

### Lines

| 字段（草案） | 语义 | 类型/约束草案 | 备注 |
| --- | --- | --- | --- |
| id | 主键 | UUID | |
| purchaseReturnId | 头 | FK | |
| sourceRefType | 来源引用类型 | 枚举：`RECEIPT_LINE / WAREHOUSE_RECEIPT_LINE / INSPECTION`（业务类型，与 exactly-one FK 匹配） | **P5 Final：必须有来源** |
| sourcePurchaseReceiptLineId | 来源收货行（真实 FK） | FK → PurchaseReceiptLine（可空，**onDelete Restrict**，Schema Integrity B②） | **Blocking ③：三个真实 FK 之一，exactly-one 非空且与 sourceRefType 匹配（API+QA 强制，不用 polymorphic string）；来源已成为退货事实则不得物理删除** |
| sourceWarehouseReceiptLineId | 来源入库行（真实 FK） | FK → WarehouseReceiptLine（可空，**onDelete Restrict**，Schema Integrity B②） | **Blocking ③** |
| sourceInspectionId | 来源质检（真实 FK） | FK → Inspection（可空，**onDelete Restrict**，Schema Integrity B②） | **Blocking ③** |
| itemId | 物料 | FK → Item | |
| quantity | 退货数量 | Decimal > 0 | ≤ 可退数量（防超退，锁内校验） |
| uomId | 单位 | FK → UoM | |
| batchNo / serialNos | 批次/序列号 | 可空 | 已入库退货追溯 |
| **disposition** | **履约处置（Blocking ② 新增，必填）** | 枚举：`REPLACE_REQUIRED`（供应商仍欠货，重新增加履约剩余待交数量）/ `CREDIT_ONLY`（采购数量最终减少/财务冲减，PO 不一定重新待收） | **防止 PO/退货/AP 互相打架** |
| returnReason | 退货原因 | string(500) | 必填 |
| remark | 备注 | string(500) | |

> **红线（D5）**：PurchaseReturn 独立事实；已入库部分 → 6A `InventoryMovement(OUT)`；未入库部分 → 仅事实。是否允许“负 movement”表达退货 → **留 6A Inventory Ledger 定**。

---

## 6. PO Line 收货投影（5B 唯一回写方，已存在于 5A；Blocking ② 精确定义）

| 字段 | 语义 | 5B 回写规则 |
| --- | --- | --- |
| receivedQty | **已被采购履约接受、可冲减 PO 未交数量的累计数量**（非到货毛数量；**当场拒收 rejectedOnReceiptQty 不计入**） | 每次 PurchaseReceipt 后 +=（quantity - rejectedOnReceiptQty）（服务端计算）；退货 REPLACE_REQUIRED 时重新打开待交数量 |
| remainingReceiveQty | 剩余可收数量 | = max(quantity - receivedQty, 0)（服务端唯一计算；**tolerance 只决定 receiveCeiling，不改变正常未交数量**——CTO Sprint 5B Final Review 锁死口径；例：PO=100、Tolerance=5%、receivedQty=100 → remainingReceiveQty=0、receiveCeiling=105，不能显示“还欠 5 件”；容差见下） |
| PO.status | 收货聚合状态 | 全部收完（且无退货挂起）→ `RECEIVED`；否则 `PARTIALLY_RECEIVED` |

> 5A 已建列、禁客户端改；**5B 是唯一回写方**（ADR-0023 D2 延续）。

> 5A 已建列、禁客户端改；**5B 是唯一回写方**（ADR-0023 D2 延续）。

---

## 7. 字段矩阵红线

- ❌ 本矩阵**不是 Schema**；任何字段不落库直到 Gate 批准 + Migration 0023
- ❌ 无 Stock / InventoryMovement / 库存余额字段（6A）
- ❌ 无供应商发票 / 三单匹配 / AP 字段（5C）
- ✅ **CTO Design Review 94/100 已拍板（2026-08-09）**：P1 方案 B 拆两层 / P2 超收默认 0%+配置容差 / P3 Inspection 独立事实 / P4 直送 Line 级预声明 / P5 退货独立事实+必须有来源+disposition / P6 批次效期 canonical capture point=WarehouseReceipt / P7 receivedQty 精确定义 / P8 5B 建最小 Warehouse/Location / P9 库存触发=6A Movement / P10 业务动作事件
- 🔶 剩余待确认子项（不阻塞设计方向）：P3b 待检库存 6A 表达、P4 projectId/address 字段、P8 库位是否必填、P10 事件最终命名（EVENTS.md 注册时定）
