# Sprint 5B：CTO Pending Decisions（待拍板决策清单 → CTO Design Review 94/100 拍板结果）

- 版本：v0.2（**CTO Design Review 94/100 — APPROVED WITH CHANGES，2026-08-09 已拍板**；原 v0.1 草案待拍板项已全部固化）
- 日期：2026-08-09
- 状态：**设计先行——禁止 Schema / Migration 0023 / API**（拍板完成，待实现放行）
- 关联：Sprint5B_China_ERP_Process_Field_Gate.md / ADR-0024（**Approved with Changes**）/ Sprint5B_Field_Matrix.md

> 说明：P1-P10 全部经 CTO Design Review 拍板（✅ Final 或 ⚠️ 修改后固化）。4 项 Blocking Design Changes 已写回 ADR-0024 / Gate / Field Matrix。**Schema/Migration 0023 仍需实现阶段放行后创建。**

---

## P1：GoodsReceipt 模型定位 —— ✅ Final

**决策**：**方案 B：拆 `PurchaseReceipt`（到货/收货事实）+ `WarehouseReceipt`（采购入库事实）**。
- 单一 GoodsReceipt（方案 A）被否——状态矩阵会被直送/质检待入库/部分收货/退货压垮
- PurchaseReceipt 只承载收货现场事实；WarehouseReceipt 承载合格入库事实（含批次/序列号/效期 canonical capture point）

## P1b：收货/退货审批 —— ✅ Final

**决策**：普通收货是事实记录，**不走审批**（Audit 留痕即可）；**超收、特殊退货等异常才走 Workflow**。

## P2：超收容差 —— ⚠️ 修改后固化（Blocking ①）

**决策**：**System Default = 0%**（不默认 5%——工业品按件采购超收可能意味着错误收货）。
- 容差优先级：`PO Line override → Supplier+Item policy → Item policy → Supplier policy → System 0%`
- **只要超出当前有效容差：不直接收货 → 进入 Over-Receipt Approval（Workflow 审批）**；不设"5% 以内天然合法"
- P2a：容差默认值 = 0%（按 Supplier/Item/PO Line 配置放宽）
- P2b：超容差审批走 Workflow（module=PURCHASE_RECEIPT，实现阶段定）
- P2c：超收部分成本口径留 5C 供应商发票/AP

## P3：质检模式 —— ✅ Final

**决策**：**Inspection 独立事实**；SKIP / SPOT / FULL（按 Item/Supplier 配置）；待检 = 未获得入库资格。
- **免检 = 系统生成 Inspection = SKIP + QUALIFIED**（不绕过 Inspection 直接让 Receipt 成为质量事实）
- Blocking ③：PurchaseReceipt Line 不承载 acceptedQty/rejectedQty（只留 quantity/visibleDamageQty/rejectedOnReceiptQty/remark）
- P3b（剩余子项）：待检库存 6A 是否表达——实现阶段定

## P4：直送 —— ✅ Final

**决策**：**Line 级**；**PO Line 预先声明**，Receipt 只能确认/补充，**不得静默改变采购履约类型**。
- 直送 = 有 PurchaseReceipt、无 WarehouseReceipt；不产生 InventoryMovement(IN)
- 剩余子项：projectId / deliveryAddress 字段（实现阶段定）

## P5：采购退货 —— ✅ Final

**决策**：**独立 `PurchaseReturn`**；**必须有来源**（收货行/入库行/质检结论）；不采用负 GR。
- **Blocking ②：`PurchaseReturn.disposition`（必填）**：`REPLACE_REQUIRED`（供应商仍欠货，重新增加履约剩余待交数量）/ `CREDIT_ONLY`（采购数量最终减少/财务冲减，PO 不一定重新待收）
- 已入库部分 → 6A InventoryMovement(OUT)；未入库部分 → 仅事实
- 是否允许技术层"负 movement"表达退货 → **留 6A Inventory Ledger 定**

## P6：批次/序列号/生产日期/有效期 —— ✅ Final

**决策**：**WarehouseReceipt 是库存追溯信息（批次/序列号/效期）的 canonical capture point**（入库层采集，非收货层）。

## P7：PO 投影口径 —— ⚠️ 修改后固化（Blocking ②）

**决策**：
- `PurchaseReceipt.quantity` = **物理到货事实（arrivedQty）**
- **`PO Line.receivedQty` = 已被采购履约接受、可冲减 PO 未交数量的累计数量**——**当场拒收（rejectedOnReceiptQty）不计入**
- 示例：PO 100 件、送 100 件、当场损坏 20 件 → receivedQty 只 +80，PO 不视为 RECEIVED
- 后续 QC 退货：不重写历史 Receipt；经 PurchaseReturn + disposition 处置（REPLACE_REQUIRED 重新打开待交数量）

## P8：仓库/库位阶段 —— ⚠️ 修改现有红线后固化（Blocking ④）

**决策**：**5B 建最小 Warehouse / Location 主数据**（收货/入库需要仓库维度；参考 Supplier 主数据先例）；**6A 接管库存能力扩展**（Stock / InventoryMovement / 库位深度）。
- 原红线"5B 不创建 Warehouse/Location 属 6A"**已修正**（Blocking ④ 消除阶段依赖冲突）
- 剩余子项：库位是否必填（实现阶段定）

## P9：库存触发 —— ✅ Final

**决策**：**WarehouseReceipt 是入库业务事实；`InventoryMovement(IN)` 才是库存数量事实（6A）**。
- 5B 任何模型/API 不得直接写库存余额（`stock.qty += x` 禁止）
- 5B-6A 衔接：WarehouseReceipt 落库后发布事件，6A 消费生成 InventoryMovement(IN)（实现细节 Gate 后定）

## P10：事件命名 —— ✅ Final（CTO Gate Re-review 统一为 WarehouseReceiptPosted）

**决策**：**用业务动作事件，不以 Draft `Created` 作为完成事实事件**；命名与状态机一致（状态已叫 `POSTED`，核心语义是"过账生效"）。
- ✅ Final：`PurchaseReceiptReceived` / `InspectionCompleted` / `WarehouseReceiptPosted` / `PurchaseReturned` / `PurchaseOrderPartiallyReceived` / `PurchaseOrderReceived`
- 最终命名与载荷在 EVENTS.md 注册时定（**统一使用 `WarehouseReceiptPosted`，与状态机 POSTED 一致**）

---

## 汇总表（CTO Design Review 94/100 拍板结果）

| # | Pending | CTO 决策 | 结论 |
| --- | --- | --- | --- |
| P1 | GoodsReceipt 定位 | 方案 B：拆 PurchaseReceipt + WarehouseReceipt | ✅ Final |
| P1b | 收货审批 | 普通收货不审批；超收/特殊退货才走 Workflow | ✅ Final |
| P2 | 超收容差 | **System Default = 0%**；PO Line→Supplier+Item→Item→Supplier→System 0%；超容差 Over-Receipt Approval | ⚠️→✅ 已修正 |
| P3 | 质检模式 | Inspection 独立事实；SKIP/SPOT/FULL；免检=SKIP+QUALIFIED；待检=未获入库资格 | ✅ Final |
| P4 | 直送 | Line 级；PO Line 预声明；Receipt 不得静默改变履约类型 | ✅ Final |
| P5 | 采购退货 | 独立 PurchaseReturn；必须有来源；+disposition（REPLACE_REQUIRED/CREDIT_ONLY）；负 movement 留 6A | ✅ Final |
| P6 | 批次/效期 | WarehouseReceipt = canonical capture point | ✅ Final |
| P7 | PO 投影 | PurchaseReceipt.quantity=物理到货；receivedQty=被接受可冲减未交数量（当场拒收不计入） | ⚠️→✅ 已修正 |
| P8 | 仓库/库位 | **5B 建最小 Warehouse/Location**；6A 接管库存能力扩展 | ⚠️→✅ 已修正 |
| P9 | 库存触发 | WarehouseReceipt=入库业务事实；InventoryMovement(IN)=库存数量事实（6A） | ✅ Final |
| P10 | 事件 | 业务动作事件（Received/Completed/Stocked/Returned），非 Draft Created | ⚠️→✅ 已修正 |

> **Blocking Design Changes 4 项**（全部已写回 ADR-0024 / Gate / Field Matrix / 本清单）：① 超收默认 0% ② receivedQty 口径 + PurchaseReturn.disposition ③ PurchaseReceipt 不承载 QC 事实（Inspection 独立）④ 5B 建最小 Warehouse/Location（消除 5B/6A 阶段依赖冲突）。
>
> **CTO #6719 补充 Final Decision 2 项（已写回）**：**D9** RECEIVED PO 不得普通新增 PurchaseReceipt（需 Reopen/Amendment/Approved Over-Receipt Exception）；**D10** WarehouseReceipt Created ≠ Posted，只有 Posted 才触发 InventoryMovement(IN)。**P4** 直送改为 `fulfillmentType = WAREHOUSE | DIRECT_PROJECT`（PO Line 预声明，非简单 boolean）。
>
> **下一步**：CTO Gate Re-review（8 门禁点：0% 默认超收 / receivedQty 精确定义 / Inspection 唯一 QC 事实源 / PurchaseReturn disposition / RECEIVED 禁普通继续收货 / 5B 最小 Warehouse/Location / WarehouseReceipt Created≠Posted / P1-P10 全部 Final）→ 一致后批准 Schema Design → Migration 0023。
