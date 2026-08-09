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
| warehouseId | 到货地点 | FK → Warehouse（6A 或 5B 最小主档，**P8**） | 到货地点 ≠ 入库仓库 |
| status | 收货单状态 | 草案：`DRAFT / RECEIVED / CANCELLED` | 是否走审批 **P1b** |
| receivedAt | 收货时间 | date-time | |
| receivedById | 收货员 | FK → User | |
| remark | 备注 | string(500) | |
| createdById / updatedById | 审计 | FK → User | |
| deletedAt / isActive | 软删 | 对齐既有模式 | |

### Lines

| 字段（草案） | 语义 | 类型/约束草案 | 备注 |
| --- | --- | --- | --- |
| id | 主键 | UUID | |
| purchaseReceiptId | 头 | FK | |
| purchaseOrderLineId | 来源 PO Line | FK → PurchaseOrderLine，必填 | 行级溯源 |
| lineNo | 行号 | int | |
| itemId | 物料 | FK → Item | |
| quantity | **到货数量** | Decimal > 0 | 可 <、=、> PO 订购量（超收见 §5） |
| uomId | 单位 | FK → UoM | 快照自 PO Line |
| rejectedQty | 收货时即拒收数量 | Decimal ≥ 0，默认 0 | 收货当场发现损坏/错发 |
| acceptedQty | 收货验收合格数量 | Decimal ≥ 0（= quantity - rejectedQty 初值） | 后续质检可修正 |
| batchNo 🔶 | 批次号 | string | **P6**：收货层采集 vs 入库层采集 |
| serialNos 🔶 | 序列号列表 | string[] | **P6** |
| mfgDate 🔶 | 生产日期 | date | **P6** |
| expDate 🔶 | 有效期至 | date | **P6** |
| remark | 备注 | string(500) | |

---

## 2. Inspection / QC（验收/质检事实）—— 质量结论

> 若质检与收货合并录入，则 Inspection 结论字段并入 PurchaseReceipt Line（accept/reject）；若独立，则单独模型。**P3 拍板**。

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

## 3. WarehouseReceipt（采购入库事实）—— 合格入库

### Header

| 字段（草案） | 语义 | 类型/约束草案 | 备注 |
| --- | --- | --- | --- |
| id | 主键 | UUID | |
| code | 入库单号 | DocumentSequence（前缀 IN / WHR-**，P10 拍板） | 创建即取号 |
| purchaseReceiptId | 来源收货单 | FK → PurchaseReceipt | 可多次入库（部分入库） |
| warehouseId | 入库仓库 | FK → Warehouse（**P8**） | 必填 |
| locationId 🔶 | 库位 | FK → Location（可空） | **P8** |
| status | 入库单状态 | 草案：`DRAFT / STOCKED / CANCELLED` | |
| stockedAt | 入库时间 | date-time | |
| stockedById | 仓管员 | FK → User | |
| createdById / updatedById | 审计 | FK → User | |
| deletedAt / isActive | 软删 | | |

### Lines

| 字段（草案） | 语义 | 类型/约束草案 | 备注 |
| --- | --- | --- | --- |
| id | 主键 | UUID | |
| warehouseReceiptId | 头 | FK | |
| purchaseReceiptLineId | 来源收货行 | FK | 溯源 |
| itemId | 物料 | FK → Item | |
| quantity | **入库数量** | Decimal > 0 | ≤ 合格数量（逐层 ceiling） |
| uomId | 单位 | FK → UoM | |
| batchNo 🔶 | 批次号 | string | **P6**：入库层采集（推荐） |
| serialNos 🔶 | 序列号列表 | string[] | **P6** |
| mfgDate 🔶 | 生产日期 | date | **P6** |
| expDate 🔶 | 有效期至 | date | **P6** |
| remark | 备注 | string(500) | |

> **红线（D3）**：WarehouseReceipt = "应产生库存动作"的业务事实，**不直接写库存余额**；驱动 6A `InventoryMovement(IN)`。

---

## 4. Direct Delivery（直送）标记

| 字段（草案） | 语义 | 类型/约束草案 | 备注 |
| --- | --- | --- | --- |
| isDirectDelivery | 是否直送 | boolean，默认 false | 在 PurchaseReceipt Header 或 Line 标记（**P4**） |
| projectId 🔶 | 直送项目/使用地点 | FK → Project（可空） | **P4** |
| deliveryAddress 🔶 | 直送地址 | string | **P4** |

> 直送 = 有 PurchaseReceipt、**无 WarehouseReceipt**；不产生 InventoryMovement(IN)。

---

## 5. PurchaseReturn（采购退货事实）—— 独立事实，非负 GR

### Header

| 字段（草案） | 语义 | 类型/约束草案 | 备注 |
| --- | --- | --- | --- |
| id | 主键 | UUID | |
| code | 退货单号 | DocumentSequence（前缀 PRT-**，P10 拍板） | 创建即取号 |
| purchaseOrderId | 来源 PO | FK | 溯源 |
| supplierId | 供应商 | 快照自 PO | |
| returnType | 退货类型 | 枚举：`REJECTED_ON_RECEIPT`（收货拒收）/ `RETURN_AFTER_STOCK_IN`（入库后退货）/ `QUALITY_ISSUE`（质量问题） | |
| status | 退货单状态 | 草案：`DRAFT / RETURNED / CANCELLED` | 是否走审批 **P1b** |
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
| sourceRefType 🔶 | 来源引用类型 | 枚举：`RECEIPT_LINE / WAREHOUSE_RECEIPT_LINE / NONE` | **P5**：退货可引用的来源 |
| sourceRefId 🔶 | 来源引用 id | string（可空） | **P5** |
| itemId | 物料 | FK → Item | |
| quantity | 退货数量 | Decimal > 0 | ≤ 可退数量（防超退，锁内校验） |
| uomId | 单位 | FK → UoM | |
| batchNo / serialNos | 批次/序列号 | 可空 | 已入库退货追溯 |
| returnReason | 退货原因 | string(500) | 必填 |
| remark | 备注 | string(500) | |

> **红线（D5）**：PurchaseReturn 独立事实；已入库部分 → 6A `InventoryMovement(OUT)`；未入库部分 → 仅事实。是否允许"负 movement"表达退货 → **留 6A Inventory Ledger 定**。

---

## 6. PO Line 收货投影（5B 唯一回写方，已存在于 5A）

| 字段 | 语义 | 5B 回写规则 |
| --- | --- | --- |
| receivedQty | 累计到货数量 | 每次 PurchaseReceipt 后 += 到货数量（服务端计算） |
| remainingReceiveQty | 剩余可收数量 | = quantity × (1 + tolerance%) - receivedQty（服务端计算；**P2** 定容差） |
| PO.status | 收货聚合状态 | 全部收完（且无退货挂起）→ `RECEIVED`；否则 `PARTIALLY_RECEIVED` |

> 5A 已建列、禁客户端改；**5B 是唯一回写方**（ADR-0023 D2 延续）。

---

## 7. 字段矩阵红线

- ❌ 本矩阵**不是 Schema**；任何字段不落库直到 Gate 批准 + Migration 0023
- ❌ 无 Stock / InventoryMovement / 库存余额字段（6A）
- ❌ 无供应商发票 / 三单匹配 / AP 字段（5C）
- 🔶 带 🔶 字段待 CTO Design Review 拍板（P2/P3/P4/P5/P6/P8/P10）
