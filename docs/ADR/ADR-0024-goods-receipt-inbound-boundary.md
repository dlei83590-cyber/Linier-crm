# ADR-0024：Goods Receipt & Inbound Boundary（收货与入库边界决策）

- 状态：**Implemented（2026-08-10，Sprint 5B 完整实现 + CTO PurchaseReturn FINAL APPROVED 98/100 #7303——Sprint 5B 核心事实链 CLOSED；Schema/Migration 0023 已实现）**
- 关联：Sprint5B_China_ERP_Process_Field_Gate.md / Sprint5B_Field_Matrix.md / Sprint5B_CTO_Pending_Decisions.md / EVENTS.md / ADR-0023（5A 已 Implemented）
- 决策人：CIO（JINZA）提案 ｜ 审核：CTO
- 背景：Sprint 5A 已完成 PR/PO Foundation（PR #19 合并 main）。5B 需锁定“到货 → 收货 → 验收 → 入库”业务边界，回答 GoodsReceipt 到底代表什么；**5B Gate 阶段曾禁止 Schema / Migration 0023 / API（仅 Design/ADR/文档）；Gate 批准后已按阶段完成实现**（Gate 模式延续 Sprint 4/5 纪律）

## 核心决策（Final / Implemented）

### D1：到货/收货 与 采购入库 拆为两层事实（CTO Design Review P1 Final）

- **`PurchaseReceipt`（到货/收货事实）**：记录供应商实际送达（谁送的、到了什么、多少、送到哪、收货单号）；**只保留收货现场事实**（quantity / visibleDamageQty / rejectedOnReceiptQty / remark）；更新 PO Line 收货投影（receivedQty / remainingReceiveQty）；**不直接产生库存增加**
- **`WarehouseReceipt`（采购入库事实）**：记录“验收合格数量正式入库到仓库/库位”（仓库/库位、批次/序列号、生产日期/有效期、合格入库数量）；**是驱动 InventoryMovement(IN) 的业务事实**；**是库存追溯信息（批次/序列号/效期）的 canonical capture point**（P6 Final）
- 理由：直送（只有 PurchaseReceipt 无 WarehouseReceipt）、质检待入库（Receipt 已建 WarehouseReceipt 未建）、部分收货/部分入库（各自多次、各自 ceiling）、退货（独立 PurchaseReturn 与两层正交）——单一 GoodsReceipt 状态矩阵会压垮模型

### D2：只有 CONFIRMED PO 才是收货合法来源（5A 已锁，延续；**CTO #6719 状态机修正**）

- 来源门禁（CTO Design Review 94/100 拍板）：
  - `CONFIRMED` → **可收**（首次收货）
  - `PARTIALLY_RECEIVED` → **可继续收**
  - `RECEIVED` → **禁止普通新增收货**（履约已完成，是终止新增 Receipt 的 Gate；若需追加超收，必须走 `Reopen / Amendment / Approved Over-Receipt Exception`，不能直接允许 Receipt API 继续写）
  - `DRAFT/SUBMITTED/APPROVED/CANCELLED` → 拒绝
- 无 Direct GR（对齐无 Direct Delivery 锁定项）——收货必须挂在 PO 上

### D3：库存数量唯一事实源 = InventoryMovement（6A），5B 永不直接写库存

- **红线（CTO #6680 锁死）**：5B 可以定义"应产生库存动作"的业务事实（WarehouseReceipt），但不得直接把库存余额当事实写入（`stock.qty += x` 禁止）
- 真正库存数量变化必须由 Sprint 6A 的 `InventoryMovement` 统一承载；Stock = Movement 余额投影
- WarehouseReceipt 落库后发布事件（`WarehouseReceiptPosted`——D10：只有 Posted 才发布并触发 6A InventoryMovement(IN)；已实现，见 EVENTS.md 2.3.9），6A 消费生成 InventoryMovement(IN)（衔接方式实现阶段定）

### D4：直送不进入仓库库存

- 直送链：`PO CONFIRMED → PurchaseReceipt / Inspection → Direct Delivery → 不进入 Warehouse Stock`
- 直送 = 有 PurchaseReceipt、无 WarehouseReceipt；不产生 InventoryMovement(IN)；消费/领用由项目侧另行记录

### D5：采购退货 = 独立 PurchaseReturn 事实（非负数 GR；P5 Final）

- `PurchaseReturn` 独立模型（Header + Lines），不做负数 GoodsReceipt；**必须有来源**（收货行 / 入库行 / 质检结论）
- 来源：质检拒收（未入库）/ 入库后退货（已入库，需 6A InventoryMovement(OUT)）/ 后续质量问题
- **`PurchaseReturn.disposition`（Blocking ② 新增，必填）**：`REPLACE_REQUIRED`（供应商仍欠货，重新增加履约剩余待交数量）/ `CREDIT_ONLY`（采购数量最终减少/财务冲减，PO 不一定重新待收）
- 是否允许技术层用“负 movement”表达退货 → **留到 Inventory Ledger（6A）设计时决定**（本阶段不拍）

### D6：PO Line 收货投影（Blocking ② 重新锁精确定义；P7 Final）

- PO Line 预留 `receivedQty=0 / remainingReceiveQty=quantity`（5A 已建列，禁客户端改）
- **`PurchaseReceipt.quantity` = 物理到货事实（arrivedQty / physicallyReceivedQty）**——供应商实际送了来的毛数量
- **`PO Line.receivedQty` ≠ 到货毛数量**：定义为 **已被采购履约接受、可冲减 PO 未交数量的累计数量**——**当场拒收（rejectedOnReceiptQty）不计入 receivedQty**
- 示例：PO 100 件，供应商送 100 件，当场损坏 20 件 → receivedQty 只 +80；PO 不视为 RECEIVED（供应商仍欠 20 件）
- 后续 QC 发现问题的退货：不偷偷重写历史 Receipt；通过 `PurchaseReturn` + `disposition` 决定是否重新打开待交数量（REPLACE_REQUIRED → 重新增加履约剩余）
- `remainingReceiveQty = max(quantity - receivedQty, 0)`（服务端唯一计算；**tolerance 只决定 receiveCeiling，不改变正常未交数量**——CTO Sprint 5B Final Review 锁死口径：
  `receivedQty` = 累计被采购履约接受数量；`remainingReceiveQty` = max(PO quantity - receivedQty, 0)；`receiveCeiling` = PO quantity × (1 + effectiveToleranceRate)。
  例：PO=100、Tolerance=5%、receivedQty=100 → remainingReceiveQty=0、receiveCeiling=105，**不能显示“还欠 5 件”**；容差见 D7）
- 全部收完（且无退货挂起）→ PO status → `RECEIVED`；否则 `PARTIALLY_RECEIVED`（事件 `PurchaseOrderPartiallyReceived` / `PurchaseOrderReceived`）

### D7：超收容差与审批（Blocking ① 修正；P2 Final）

- **System Default = 0%**（不默认 5%——工业品按件采购超收可能意味着错误收货；业务人员不应把超 PO 当正常路径）
- 容差优先级：`PO Line override → Supplier+Item policy → Item policy → Supplier policy → System 0%`
- **只要超出当前有效容差：不直接收货 → 进入 Over-Receipt Approval（Workflow 审批）**；不设“5% 以内天然合法”
- 防超收红线：与 5A“GR 防超收 = PO Line 数量 ceiling”一致；锁内校验

### D8：质检为独立事实（Blocking ③ 修正；P3 Final）

- **Inspection 独立模型**（SKIP / SPOT / FULL），统一承载质量判定：`qualifiedQty / rejectedQty / inspectionMode / result`
- **PurchaseReceipt Line 不承载 QC 事实**：只保留收货现场事实 `quantity / visibleDamageQty / rejectedOnReceiptQty / remark`；不再有 acceptedQty/rejectedQty（避免两套质量事实源）
- 免检（SKIP）→ 系统生成 `Inspection = SKIP + QUALIFIED`（不绕过 Inspection 直接让 Receipt 成为质量事实）
- 质量链统一：`PurchaseReceipt → Inspection → WarehouseReceipt`；待检 = 未获得入库资格（不产生 WarehouseReceipt）

### D9：RECEIVED PO 不得普通新增 PurchaseReceipt（CTO #6719 新增 Final Decision）

- **`RECEIVED` 状态 = 采购履约完成，是终止普通新增 Receipt 的 Gate**（对齐 D2 状态机修正）
- 若 RECEIVED 后确实需要追加超收/补充收货：必须走 `Reopen / Amendment / Approved Over-Receipt Exception` 显式流程，**不得直接允许 Receipt API 继续写**
- 否则 RECEIVED 状态没有实际约束力

### D10：WarehouseReceipt Created ≠ Posted；只有 Posted 才触发 InventoryMovement(IN)（CTO #6719 新增 Final Decision）

- **`Created` ≠ `Posted`**：WarehouseReceipt 创建（Created）只是入库事实的草稿/登记态，**不触发任何库存动作**
- **只有 `Posted`（过账/确认）才触发 InventoryMovement(IN)**——Posted 是“应产生库存动作”的生效点
- Field Matrix：WarehouseReceipt.status = `DRAFT → POSTED → CANCELLED`（或 Created/Posted 两态，实现阶段定命名）
- 6A 消费 Posted 事件生成 InventoryMovement(IN)，Stock Projection 才更新

### D11：事件语义（P10 Final）

- 用**业务动作事件**，不以 Draft `Created` 作为完成事实事件
- 草案：`PurchaseReceiptReceived`（收货完成）/ `InspectionCompleted`（质检落定）/ `WarehouseReceiptPosted`（入库过账完成，驱动 6A）/ `PurchaseReturned`（退货完成）——最终命名见 EVENTS.md 注册

### D12：边界红线（本阶段无越界实现）

- ❌ 不创建 Schema / Migration 0023 / Prisma model / API
- ❌ **5B 创建最小 Warehouse / Location 主数据**（P8 Final：收货/入库需要仓库维度），但**不创建 Stock / InventoryMovement / 库存余额**（属 6A 接管库存能力扩展）
- ❌ 任何代码不得直接写库存余额
- ❌ 不实现 Supplier Invoice / 三单匹配 / AP（5C）
- ❌ 不决定“负 movement 是否允许”（留 6A Inventory Ledger）

## Final Decisions（CTO Design Review 94/100 拍板结果，2026-08-09）

| # | Pending | **CTO 拍板结论** |
| --- | --- | --- |
| P1 | GoodsReceipt 定位 | **方案 B：拆 PurchaseReceipt（到货/收货事实）+ WarehouseReceipt（采购入库事实）** ✅ Final |
| P1b | 收货审批 | 普通收货是事实记录，**不走审批**；超收、特殊退货等异常才走 Workflow ✅ Final |
| P2 | 超收容差 | **System Default = 0%**；按 Supplier/Item/PO Line 配置容差（PO Line → Supplier+Item → Item → Supplier → System 0%）；超配置容差必须审批（Over-Receipt Approval）——不默认 5% ⚠️→✅ 已修正 |
| P3 | 质检模式 | **Inspection 独立事实**；SKIP/SPOT/FULL；待检=未获得入库资格；免检=系统生成 SKIP+QUALIFIED ✅ Final |
| P4 | 直送 | **Line 级**；PO Line 预先声明，Receipt 只能确认/补充，不得静默改变采购履约类型 ✅ Final |
| P5 | 采购退货 | 独立 `PurchaseReturn`；**必须有来源**；不采用负 GR；**+disposition（REPLACE_REQUIRED / CREDIT_ONLY）** ✅ Final |
| P6 | 批次/序列号/效期 | **WarehouseReceipt 是库存追溯信息的 canonical capture point** ✅ Final |
| P7 | PO 投影 | `PurchaseReceipt.quantity`=物理到货；**`PO Line.receivedQty`=已被采购履约接受、可冲减未交数量的累计数量**（当场拒收不计入）；退货经 PurchaseReturn+disposition 处置 ⚠️→✅ 已修正 |
| P8 | 仓库/库位 | **5B 建最小 Warehouse/Location 主数据**，6A 接管库存能力扩展（Stock/Movement）⚠️→✅ 已修正红线 |
| P9 | 库存触发 | WarehouseReceipt 是入库业务事实；**InventoryMovement(IN) 才是库存数量事实**（6A）✅ Final |
| P10 | 事件 | 用业务动作事件（Received/Completed/Stocked/Returned），不以 Draft Created 作为完成事实事件 ⚠️→✅ 已修正 |
