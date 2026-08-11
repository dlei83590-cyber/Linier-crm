# ADR-0027：Supplier Invoice / Three-Way Match / AP Boundary（供应商发票 → 三单匹配 → 应付账款 边界决策）

- 状态：**Proposed**（草案，待 CTO 5C Design Review 拍板）
- 日期：2026-08-11
- 维护者：CIO（JINZA）｜审核：CTO
- 关联：Sprint5C_Supplier_Invoice_Three_Way_Match_AP_Gate.md（v0.1）/ Sprint5C_Field_Matrix.md（v0.1）/ Sprint5C_CTO_Pending_Decisions.md（v0.1）/ EVENTS.md（5C 注册位）
- 上游已 Implemented：ADR-0023（5A PO 承诺）/ ADR-0024（5B 收货入库）/ ADR-0025（6A 库存账）/ ADR-0026（6B Operations）

---

## 背景（CTO #8777）

Sprint 6B CLOSED 后，采购库存链（PO → PurchaseReceipt → Inspection → WarehouseReceipt → InventoryMovement）已完整。**若不继续接 Supplier Invoice / AP，采购库存链没有完成 ERP 的财务闭环**。5C 是当前后端最高优先级，Design First（CTO Gate 批准前禁止写 Schema/Migration/API）。

**关键锁（CTO #8777）**：**Supplier Invoice ≠ Sales Invoice 反向版**——独立模型，可借鉴 4E 模式但方向/溯源/状态机不同。

**业务事实链建议**：`PO Commitment → Receipt Fact → Warehouse/Inventory Fact → Supplier Invoice → 3-Way Match → AP Liability → Payment`。

---

## 核心决策（D1-D9，CTO 5C Design Review 待拍板）

### D1：Supplier Invoice = 独立的供应商开票事实（≠ Sales Invoice 反向版）

- **不是**把 4E Sales Invoice 反向复制：① 方向相反（供应商开给我方 = Expense/AP，我方开给客户 = Revenue/AR）；② 溯源对象不同（5C → PO/WarehouseReceipt，4E → SO/Delivery）；③ 状态机不同（5C 有 3-Way Match / 暂估冲销 / 分批到票，4E 有 Issue/Partial/Consolidated Billing）
- Supplier Invoice 行级溯源：**PO Line（承诺）+ WarehouseReceipt Line（入库事实）**，双溯源（Pending Decision：是否强制 WarehouseReceipt 溯源，还是允许 PO-only 直票）
- 行金额 = 服务端 Decimal 聚合（禁客户端直传头金额，对齐 5A PO 金额事实模式）

### D2：3-Way Match = 校验事实，不是冲销事实

- 三单匹配（PO / Receipt / Invoice）产出 **MATCHED / VARIANCE** 结果，**不直接产生库存或 AP 变动**
- 匹配维度：**数量**（invoiceQty vs receiptQty vs poQty）、**单价**（invoiceUnitPrice vs PO 快照）、**税额**（invoiceTax vs 服务端计算税）
- 差异处置（接受差异 / 拒绝 / 挂起 / 生成 Supplier CN-DN）后才进入 AP Liability
- 数量差异红线：**invoiceQty > 已收数量部分不可入 AP**（未收货部分不能形成应付）；invoiceQty < 已收数量 → 差异处置

### D3：暂估应付（GR/IR）= 过渡投影，不是真实债务

- 已收未票（WarehouseReceipt Posted 但无发票）：按 PO 快照单价 × 已入库数量**暂估应付**
- 暂估**不生成真实 AP Open Item**，是过渡投影（到票冲销）
- **到票冲暂估**：发票匹配通过后冲销暂估投影 → 按发票实际金额生成 AP Liability；暂估与实票差异走差异处置
- 触发方式（Pending Decision）：自动暂估（WarehouseReceipt Posted 时）vs 月结批量暂估

### D4：AP Liability = 应付债务事实（发票过账后生成）

- 三单匹配通过（或差异被批准）→ **POSTED** → 生成 AP Liability（含税金额 / 已付 / openAmount 余额 / 到期日 / 币种 / 发票溯源）
- **AP Open Item**（未清项）：AP 金额 - 已核销 = openAmount；账龄/到期（对齐 4E-1 AR aging 模式，方向相反）
- 状态机草案：`DRAFT → SUBMITTED → MATCHED → APPROVED → POSTED（AP Liability）/ CANCELLED`；差异路径（VARIANCE → 处置）待 Pending Decision

### D5：进项税（Input VAT）= 财务事实，快照计算

- 税基 = 匹配后的净额；税率快照（对齐 4D Invoice 快照税务/汇率模式——开票时点税率冻结）
- **进项税 ≠ 成本**：进项税是 AP 金额组成部分（含税 AP）或分离（不含税 AP + 税），Pending Decision
- 税额差异（invoiceTax ≠ 服务端计算税）→ 差异处置（税务快照/税率配置）

### D6：Supplier CN / DN = 供应商调整事实（方向与 4E 相反）

- **Supplier Credit Note（冲减 AP）/ Supplier Debit Note（增加 AP）**——供应商开给我方的调整单据
- 4E-3 的 CN/DN 是**我方**开给客户（AR 侧）；5C Supplier CN/DN 是**供应商**开给我方（AP 侧）——**模型独立，可借鉴 signed adjustment（CN<0/DN>0）+ 累计防超调锁内重算**（4E-3 模式，方向相反）
- 触发：发票差异处置 / 退货（5B PurchaseReturn CREDIT_ONLY 处置关联，Pending Decision）

### D7：Payment Allocation = 付款核销 AP（方向与 4E-2 相反）

- 付款单 + M:N 核销 AP Open Item；**防超核销**（累计 allocation ≤ openAmount，锁内重算）
- 同供应商同币种（对齐 4E-2 模式，方向相反）
- Payment 是独立事实（Created ≠ Applied，Apply 唯一回写 AP 余额入口——对齐 4E-2 WriteOff 模式）

### D8：与 General Ledger 的边界

- 本阶段**不建 GL 总账**；5C 产出"财务事实"（AP Liability / 暂估 / 调整 / 付款核销），GL 过账留给未来 Finance 阶段消费（对齐 4E 不写 GL 先例）
- 5C 只产出可被 GL 消费的**事实 + 事件**，不做过账

### D9：明确排除（CTO #8777 HOLD 延续）

- **Costing / FIFO / Moving Average / Cost Layer / Valuation / Landed Cost**：发票金额是财务事实，不是成本事实；成本在采购+库存+AP 链闭合后再排优先级
- **Reservation / ReservedQty / AvailableQty**：继续 HOLD
- **Manufacturing / MRP**：继续 HOLD
- **不触碰 InventoryMovement / StockProjection**（6A SSOT 红线继承；5C 只读库存事实做数量匹配）

---

## 变更记录

| 版本 | 日期 | 状态 | 说明 |
| --- | --- | --- | --- |
| v0.1 | 2026-08-11 | **Proposed** | 5C Design Gate 首版（D1-D9，P1-P12 待拍板） |

> 批准后：更新为 Approved（CTO Design Review 通过）→ 追加 Implementation Status（对齐 ADR-0025/0026 模式）。
