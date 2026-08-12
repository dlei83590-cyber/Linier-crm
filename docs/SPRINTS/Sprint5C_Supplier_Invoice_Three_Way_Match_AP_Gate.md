# Sprint 5C：Supplier Invoice / Three-Way Match / AP Design Gate（供应商发票 → 三单匹配 → 应付账款 业务边界设计）

- 版本：v0.2（**CTO 5C Design Review 88/100 — APPROVED WITH CHANGES，#8845 已拍板**；原 v0.1 草案 P1-P12 已按 CTO 表转 Final）
- 日期：2026-08-11
- 维护者：CIO（JINZA）｜审核：CTO
- 状态：**设计先行——禁止 Schema / Migration / API**（CTO Gate Re-review 通过后才允许）
- 关联：ADR-0027（**Approved with Changes**）/ Sprint5C_Field_Matrix.md / Sprint5C_CTO_Pending_Decisions.md（P1-P12 已拍板）/ EVENTS.md / ADR-0023（5A Implemented）/ ADR-0024（5B Implemented）/ ADR-0025（6A Implemented）/ ADR-0026（6B Implemented）
- CTO 授权：#8777 Post-6B Portfolio Gate —— **Track B Sprint 5C START（后端最高优先级）**；#8845 双轨首批评审（4 Blocking + 3 Hardening 已按指令修复）

---

## 0. Sprint 5C 范围切分（CTO #8777 拍板）

| 阶段 | 范围 | 状态 |
| --- | --- | --- |
| 5A | PR + PO（需求事实源 + 承诺事实源，APPROVED ≠ CONFIRMED） | ✅ 已合并 main（PR #19，CTO Final Review 97/100） |
| 5B | 到货 → 收货 → 验收 → 入库（PurchaseReceipt / Inspection / WarehouseReceipt / PurchaseReturn） | ✅ 已合并 main（PR #20，CTO Final Review 98/100 #7303） |
| 6A | InventoryMovement + StockProjection（**库存唯一事实源**） | ✅ 已合并 main（PR #21，CTO Final Review 99/100 #7683） |
| 6B | Transfer / Stock Count / Adjustment / Conversion（**Operations Vertical Slices**） | ✅ 已合并 main（PR #22，CTO Final Review 99/100 #8760） |
| **5C** | **Supplier Invoice + 3-Way Match + AP（本阶段——后端最高优先级）** | 🔄 设计先行 |

> **本阶段铁律（CTO #8777 锁死）**：5C 是 Design First。**CTO Gate 批准前，禁止写 5C Schema / Migration / API**。先交 4 份设计文档（本 Gate / ADR-0027 / Field Matrix / Pending Decisions），Gate 批准后才允许实现。

---

## 1. 现状侦查（已确认，5A/5B/6A/6B 落地事实）

- **PO 承诺事实**（ADR-0023 Implemented）：`DRAFT → SUBMITTED → APPROVED → CONFIRMED → PARTIALLY_RECEIVED → RECEIVED`；`DRAFT → CANCELLED`；行金额 = 快照复制（SUPPLIER_PRICE_SNAPSHOT / MANUAL 双通道）；**PO = 采购承诺事实源**（对供应商正式承诺，不是发票依据本身）
- **收货事实链**（ADR-0024 Implemented）：PurchaseReceipt（到货/收货现场事实）→ Inspection（质检唯一事实，qualifiedQty + rejectedQty = inspectableQty 强制）→ WarehouseReceipt（采购入库事实，Posted 才触发 6A InventoryMovement(IN)）→ PurchaseReturn（独立退货事实，REPLACE_REQUIRED 重开 PO 履约 / CREDIT_ONLY 不重开）
- **库存事实源**（ADR-0025/0026 Implemented）：InventoryMovement 唯一 SSOT + StockProjection 物化投影；6B 四块 Operations 全部 FINAL（Transfer/Count/Adjustment/Conversion）
- **采购侧既有事件**：`PurchaseReceiptReceived` / `InspectionCompleted` / `WarehouseReceiptPosted` / `PurchaseReturned` / `PurchaseOrderPartiallyReceived` / `PurchaseOrderReceived`（全部 ✅，EVENTS v1.29）
- **5C 已预留事件注册位**：`GoodsReceived` / `SupplierInvoiceCreated`（EVENTS.md 注：5B/5C 注册；**本阶段落地 SupplierInvoice* 系列**）
- **销售侧对称先例（4E，不可简单反向复制）**：Sales Invoice（Issue 原子取号 / 快照税务汇率 / DRAFT 不占号 / Partial+Consolidated Billing / Cancel 释放开票投影）；Credit/Debit Note（Invoice Adjustment 事实源 + 单票制 + 快照复制 + APPROVED≠APPLIED + 累计防超调锁内重算 + signed adjustment CN<0/DN>0 + 负 AR Customer Credit 投影）；Receipt Allocation / WriteOff（4E-2 先例）
- **现状无任何 Supplier Invoice / AP 模型**（5C 边界未越线 ✅）

---

## 2. 核心事实边界（本轮设计核心目标）

CTO #8777 明确要求：**Supplier Invoice ≠ Sales Invoice 反向版**。每个事实必须回答：谁触发、代表什么、产生什么投影、何时连财务。

### 2.1 供应商发票（Supplier Invoice）——供应商开票事实

| 项 | 定义 |
| --- | --- |
| 业务含义 | 供应商对已交付/已承诺货物开具的收款请求（Invoice）——**采购侧应付的触发事实** |
| 触发方 | 采购/财务（供应商提供发票后录入或对接） |
| 事实属性 | 供应商、开票日期、发票号（供应商侧唯一）、币种、金额（服务端 Decimal 聚合，**禁客户端直传头金额**）、税额/进项税、行明细（PO Line / WarehouseReceipt Line 溯源） |
| 与库存关系 | **不直接产生库存动作**（库存已由 6A/6B 承载）；只参与**财务事实链**（3-Way Match → AP Liability） |
| 关键约束 | **Supplier Invoice ≠ Sales Invoice 反向版**：① Sales Invoice 由我方开给客户（Revenue），Supplier Invoice 由供应商开给我方（Expense/AP）；② 不能简单复用 4E 状态机（4E 有 Issue/Partial/Consolidated，5C 有 3-Way Match / 暂估冲销 / 分批到票）；③ 行级溯源对象不同（Sales → SO/Delivery，Supplier → PO/WarehouseReceipt） |

### 2.2 三单匹配（Three-Way Match）——PO / Receipt / Invoice 一致性事实

| 项 | 定义 |
| --- | --- |
| 业务含义 | 将供应商发票与 **PO（承诺）** + **收货/入库事实（WarehouseReceipt）** 三方核对，确认"订购了什么、实际到了什么、供应商收多少钱"三者一致 |
| 匹配维度 | **数量差异**（invoiceQty vs receiptQty vs poQty）、**单价差异**（invoiceUnitPrice vs PO 快照单价）、**税额差异**（invoiceTax vs 计算税） |
| 事实属性 | 匹配结果（MATCHED / VARIANCE）、差异明细（qtyVariance / priceVariance / taxVariance）、处置（接受差异 / 拒绝 / 挂起） |
| **不可变 Match Run（CTO #8845 Blocking ② + #8901 最终修正）** | **匹配历史必须可审计**：三单匹配可能因后续收货 / 分批发票 / snapshot / 差异处置**多次重算**——必须用 **SupplierInvoiceMatchRun + SupplierInvoiceMatchLine**（或等价 revision 模型）保存每次匹配的不可变快照；SupplierInvoiceLine 上保留 `currentMatchStatus` 作为**当前投影**；**审批事实引用 immutable `matchRunId/revision`**（存 `approvedMatchRunId/approvedMatchRevision` 于 Workflow/Invoice approval evidence，**MatchRun 自身无 approvedAt/approvedById——Approval references MatchRun，不 mutates MatchRun**；回答"这张发票当时为什么在 14:03 被批准？"） |
| 关键约束 | **匹配是校验事实，不是冲销事实**——差异处置后才会形成 AP Liability；差异超阈值需审批（Workflow）或生成 Supplier Credit/Debit Note |

### 2.3 应付账款（AP Liability）——应付债务事实

| 项 | 定义 |
| --- | --- |
| 业务含义 | 三单匹配通过（或差异被批准）后，正式确认对供应商的应付债务 |
| **Fact vs Projection 分层（CTO #8845 Blocking ③）** | **AP Liability Fact**（SupplierInvoice POSTED / Supplier CN-DN APPLIED 产生）+ **PaymentAllocation = Settlement Fact** + **AP Open Item = materialized projection / read model**（openAmount **不是**新的财务事实源——对齐 6A 库存事实/投影纪律）。Reconciliation：**Liability + CN/DN - Allocations = Open Amount**；Allocation 纠错 → 追加 reversal/correction allocation，**不手改 openAmount** |
| 事实属性 | AP 金额（含税）、已付金额、余额（openAmount 投影）、到期日、币种、发票溯源 |
| 与付款关系 | **AP Open Item**（未清项投影）→ Payment Allocation（付款核销）→ 余额归零 |

### 2.4 暂估应付（GR/IR）——已收未票的过渡事实

| 项 | 定义 |
| --- | --- |
| 业务含义 | 货已入库（WarehouseReceipt Posted）但供应商发票未到：账务上先按 PO 金额**暂估应付**（GR/IR = Goods Receipt / Invoice Receipt） |
| 触发方 | 系统（WarehouseReceipt Posted 时自动生成暂估） |
| **完整生命周期（CTO #8845 Blocking ①）** | ① `WarehouseReceiptPosted` → **GRIR Accrual**（按 PO 快照单价 × 已入库数量）；② `WarehouseReceipt-based PurchaseReturned` → **GRIR Reversal/Reduction**（已入库后退货冲减暂估——**只有来自已 POSTED WarehouseReceiptLine 的退货才冲减 GR/IR**；未入库拒收/退货不产生 GR/IR reversal，继承 5B 区分）；③ `SupplierInvoice POSTED` → **consume/reverse remaining GRIR + create actual AP Liability**。**源幂等身份**：WHR Line → GRIR accrual identity；Return Line → GRIR reversal identity（防重复冲回，对齐 6A 五元幂等纪律） |
| 与发票关系 | 到票时**冲销剩余暂估**（到票冲暂估），按发票实际金额确认 AP；暂估与实票差异计入差异处置 |
| **金额口径（CTO #8845 Blocking ④ + #8901 P9 Final）** | **GR/IR baseAmount 必须明确 net/tax canonical basis**：PO 含税价如何 normalize 成暂估净额（税率快照自 PO/税务配置）；`GRIR baseAmount` = **不含税暂估净额**（进项税只在合规发票事实进入时确认——不在暂估阶段隐式确认 Input VAT）；`VAT recoverable` 标记 + `Invoice POSTED` 拆分 **net liability / input VAT / total AP**；**不可抵扣税（P9 Final，CTO #8901 拍板）**：recoverable=true → 税额进 **Input VAT component**；recoverable=false → 税额进 **nonRecoverableTaxAmount（expense-or-capitalizable component）财务事实**——5C 只保存/发布该金额事实，**不写 InventoryMovement/StockProjection/库存成本层**（不把不可抵扣税资本化进 Inventory Cost），未来 Costing/GL 决定最终资本化或费用化；**AP 总债务 = net + total tax，不因 recoverability 改变应付总额** |

### 2.5 Supplier Credit / Debit Note（供应商贷项/借项通知）——发票调整事实

| 项 | 定义 |
| --- | --- |
| 业务含义 | 发票差异/退货后供应商开出的调整单据：Credit Note（冲减应付）/ Debit Note（增加应付） |
| 触发方 | 供应商（我方录入或对接） |
| 与 4E 区别 | 4E CN/DN 是**我方**开给客户的（AR 侧）；5C Supplier CN/DN 是**供应商**开给我方的（AP 侧）——**方向相反，模型不可复用**（需独立设计，可借鉴 4E 的 signed adjustment + 累计防超调模式） |

### 2.6 付款（Payment / Allocation）——应付清偿事实

| 项 | 定义 |
| --- | --- |
| 业务含义 | 对 AP Open Item 进行付款核销（Payment + Allocation），AP 余额归零 |
| 触发方 | 财务（出纳） |
| 与 4E 区别 | 4E Receipt Allocation 是**收款**核销 AR；5C Payment Allocation 是**付款**核销 AP——**方向相反**，需独立设计（可借鉴 4E-2 的 M:N 锁 + 防超核销模式） |

---

## 3. 业务事实链（CTO #8777 建议，本阶段锁死）

```
PO Commitment（5A，已 Implemented）
  → Receipt Fact（5B PurchaseReceipt / Inspection / WarehouseReceipt，已 Implemented）
  → Warehouse/Inventory Fact（6A/6B InventoryMovement + StockProjection，已 Implemented）
  → Supplier Invoice（5C，本阶段）
  → 3-Way Match（5C，本阶段：PO / Receipt / Invoice）
  → AP Liability（5C，本阶段）
  → Payment（5C，本阶段：Payment Allocation 核销 AP Open Item）
```

> **红线**：5C 只消费 5A/5B/6A/6B 的**已 FINAL 契约**；**不反向修改库存事实模型、不触碰 InventoryMovement/StockProjection**（6A SSOT 保持）；不提前实现 Costing（FIFO/移动平均）——**发票金额是财务事实，不是成本事实**（成本在采购+库存+AP 链闭合后再排优先级，CTO #8777 HOLD）。

---

## 4. 重点设计维度（CTO #8777 清单逐项）

| # | 设计维度 | 初步边界 |
| --- | --- | --- |
| 4.1 | **已收未票** | WarehouseReceipt Posted 但无 Supplier Invoice → 自动暂估应付（GRIR Accrual，**P8 Final**） |
| 4.2 | **暂估应付（GRIR）** | 按 PO 快照单价 × 已入库数量暂估；**baseAmount = 不含税暂估净额**（P9 Final：进项税只在合规发票进入时确认，暂估阶段不隐式确认 Input VAT）；暂估不产生真实 AP Open Item（是过渡投影，到票冲销） |
| 4.3 | **到票冲暂估** | 发票到达并匹配后：**consume/reverse remaining GRIR** → 按发票实际金额生成 AP Liability；暂估与实票差异走差异处置 |
| 4.3b | **GRIR 冲回（CTO #8845 Blocking ①，P8 Final）** | **WarehouseReceipt-based PurchaseReturned → GRIR Reversal/Reduction**（只有来自已 POSTED WarehouseReceiptLine 的退货才冲减 GR/IR；未入库拒收/退货不产生 GR/IR reversal，继承 5B 区分）；源幂等身份：WHR Line → accrual identity、Return Line → reversal identity（防重复冲回，对齐 6A 五元幂等纪律） |
| 4.4 | **PO / Receipt / Invoice 三单匹配** | 数量：invoiceQty vs min(poQty, receiptQty) 可用额；单价：invoiceUnitPrice vs PO 快照；税额：invoiceTax vs 服务端计算税（税率快照自 PO/税务配置） |
| 4.5 | **数量差异** | invoiceQty > 已收数量 → 部分匹配/挂起（未收货部分不可入 AP）；invoiceQty < 已收数量 → 差异处置（CREDIT_ONLY 或 Supplier CN） |
| 4.6 | **单价差异** | invoiceUnitPrice ≠ PO 快照单价 → 差异审批（Workflow）或 Supplier CN/DN；超容差 fail closed（对齐 5B 超收容差模式） |
| 4.7 | **税额差异** | 进项税：invoiceTax ≠ 服务端计算税 → 差异处置（税务快照/税率配置）；进项税凭证归属 GL 边界（§10） |
| 4.8 | **进项税（P9 Final，CTO #8901 最终拍板）** | **价税分离**：SupplierInvoiceLine 存 netAmount（不含税）+ taxRate（快照）+ taxAmount；税基 = 匹配后的净额；**VAT recoverable 标记** + Invoice POSTED 拆分 **net liability / input VAT / total AP**；**不可抵扣税（Final）**：recoverable=true → Input VAT component；recoverable=false → **nonRecoverableTaxAmount（expense-or-capitalizable component）财务事实**——5C 只保存/发布该金额事实，**不写库存成本层**（Costing HOLD 保持），未来 Costing/GL 决定资本化/费用化；**AP 总债务 = net + total tax，不因 recoverability 改变**；进项税凭证归属 GL 边界（§10） |
| 4.9 | **发票多次/分批到票** | 一张 PO 可对应多张 Supplier Invoice（部分开票）；累计开票金额 ≤ PO 行可开票余额（锁内重算防超开，对齐 4E Partial Billing + 5B 来源可退余额模式） |
| 4.10 | **Credit Note / Supplier Debit/Credit** | Supplier CN（冲减 AP）/ Supplier DN（增加 AP）；signed adjustment（CN<0/DN>0）+ 累计防超调锁内重算（对齐 4E-3 模式，方向相反）；**独立事实，不能修改已 POSTED Invoice（P7 Final）** |
| 4.11 | **AP Open Item（P10 相关）** | **materialized projection / read model**（CTO #8845 Blocking ③）——不是财务事实源；`openAmount` = **Liability + CN/DN - Allocations** 的 reconciliation 结果（服务端计算）；到期日/账龄（对齐 4E-1 AR aging 模式，方向相反） |
| 4.12 | **Payment Allocation** | 付款单 + M:N 核销 AP Open Item；防超核销（累计 allocation ≤ openAmount，锁内重算）；同供应商同币种（对齐 4E-2 模式，方向相反）；**纠错 → 追加 reversal/correction allocation，不手改 openAmount** |
| 4.13 | **Supplier Invoice 状态机（P3 Final 两维）** | **documentStatus**：`DRAFT → SUBMITTED → MATCHED → APPROVED → POSTED（AP Liability 生成）/ CANCELLED`（截止 POSTED/CANCELLED）；**settlementStatus（独立维度）**：`UNPAID / PARTIALLY_PAID / PAID`——**付款核销不反向改变 documentStatus**（CTO #8845 Hardening 1） |
| 4.14 | **与 General Ledger 的边界** | 本阶段**不建 GL 总账**（GL 是未来 Finance 阶段）；5C 产出"财务事实"（AP Liability / 暂估 / 调整），GL 过账留给总账阶段消费（对齐 4E 不写 GL 先例——4E 产出 AR 事实，GL 后续） |

---

## 5. 关键设计原则（CTO #8845 已拍板，P1-P12 转 Final）

1. **Supplier Invoice ≠ Sales Invoice 反向版**（CTO #8777 锁死）：独立模型，可借鉴 4E 模式但方向/溯源/状态机不同
2. **3-Way Match 是校验事实，不是冲销事实**：匹配结果 + 差异处置 → 才形成 AP Liability；**匹配历史走 immutable MatchRun（Blocking ②）**
3. **暂估应付是过渡投影，不是真实债务**：GRIR Accrual（WHR Posted）→ **GRIR Reversal/Reduction（WHR-based Return，Blocking ①）** → 到票 consume remaining + 生成真实 AP Liability
4. **AP Liability Fact vs OpenItem Projection 分层（Blocking ③）**：SupplierInvoice POSTED / Supplier CN-DN APPLIED = AP Liability Facts；PaymentAllocation = Settlement Fact；AP Open Item = materialized projection / read model；openAmount = Liability + CN/DN - Allocations（reconciliation，不手改）
5. **发票金额是财务事实，不是成本事实**：Costing（FIFO/移动平均）继续 HOLD
6. **5C 全程不触碰库存**：不写 InventoryMovement / StockProjection（6A SSOT 红线继承）
7. **maker-checker / 审批边界（P12 Final）**：Creator ≠ Approver/Poster；Payment 同样执行；差异审批走 Workflow
8. **事件纪律**：业务层事件（SupplierInvoiceCreated / Matched / Posted / Paid 等）注册 EVENTS.md，事务后发布、不含余额（对齐 6B 模式）
9. **两维状态（P3 Final）**：documentStatus（截止 POSTED/CANCELLED）+ settlementStatus（UNPAID/PARTIALLY_PAID/PAID）——付款核销不反向改变 documentStatus
10. **首版 scope（P4 Final + Hardening 2）**：**PO + WarehouseReceipt-based stock procurement invoice**；Non-PO Expense Invoice / Service Invoice / 纯费用 AP **不进入首版**

---

## 5.1 实现切片（CTO #8845 Hardening 3：5C-1 / 5C-2）

| 切片 | 范围 | Migration/PR 策略 |
| --- | --- | --- |
| **5C-1** | Supplier Invoice + 3-Way Match（MatchRun）+ GRIR（Accrual/Reversal/consume）+ AP Open Item（projection） | 一个 Migration + 一个 API PR——**核心财务链** |
| **5C-2** | Supplier CN/DN + Payment Allocation（Settlement Fact） | 独立 Migration + 独立 API PR——避免一个 PR 变整个 Finance 子系统 |

> 5C-1 完成并 CTO 评审后再启动 5C-2；Payment/CN-DN 保留在总设计（Field Matrix + ADR），实现按切片拆。

---

## 6. 事件注册（5C，先注册后开发，对齐 EVENTS.md 纪律）

| 事件 | 语义 | 状态 |
| --- | --- | --- |
| `SupplierInvoiceCreated` | 发票创建（DRAFT 不发领域事件——对齐 6B；仅 AuditLog） | ⏳ 5C 注册 |
| `SupplierInvoiceMatched` | 三单匹配完成（MATCHED / VARIANCE 结果，**引用 matchRunId**） | ⏳ 5C 注册 |
| `SupplierInvoicePosted` | 发票过账（POSTED，AP Liability Fact 生成 + consume remaining GRIR） | ⏳ 5C 注册 |
| `SupplierInvoiceCancelled` | 发票取消 | ⏳ 5C 注册 |
| `GrirAccrued` | GRIR 暂估发生（WHR Posted，Blocking ① 生命周期起点） | ⏳ 5C 注册 |
| `GrirReversed` | GRIR 冲回（WHR-based PurchaseReturned，Blocking ①） | ⏳ 5C 注册 |
| `SupplierCreditNoteApplied` / `SupplierDebitNoteApplied` | 供应商 CN/DN 生效（AP Liability Fact 调整） | ⏳ 5C 注册（5C-2） |
| `ApPaymentAllocated` | 付款核销 AP Open Item（Settlement Fact） | ⏳ 5C 注册（5C-2） |
| `GoodsReceived` | 5B 已预留（收货完成聚合投影）——5C-1 确认注册 | ⏳ 待 5C-1 确认 |

> 全部事务提交后 best-effort 发布、**不含余额**；命名对齐 6B 模式（Created/Matched/Posted/Applied，非 Draft 语义）。

---

## 7. 边界红线（5C 实现范围，Gate 批准后生效）

1. **不建 GL 总账**（GL 过账归未来 Finance 阶段；5C 只产出财务事实）
2. **不实现 Costing / FIFO / Moving Average / Cost Layer / Valuation / Landed Cost**（CTO #8777 明令 HOLD）
3. **不触碰 InventoryMovement / StockProjection**（6A SSOT 红线；5C 只读库存事实做数量匹配）
4. **不实现 Reservation / ReservedQty / AvailableQty**（HOLD）
5. **不复制 4E Sales 模型**：Supplier Invoice / Supplier CN-DN / Payment Allocation 均独立设计（方向相反）
6. **不实现 Manufacturing / MRP**（HOLD）

---

## 8. CTO Design Review 后动作（#8845 已拍板 P1-P12 + 4 Blocking + 3 Hardening）

1. ✅ P1-P12 已按 CTO 表转 Final（P3/P5/P8/P9 修改后固化；其余 ✅）——见 Sprint5C_CTO_Pending_Decisions.md v0.2
2. ✅ 4 Blocking 已修复：① GRIR PurchaseReturn reversal（生命周期 + 源幂等身份）② immutable MatchRun/MatchSnapshot + current projection ③ AP Liability Fact vs OpenItem Projection 分层 ④ GR/IR net/tax canonical basis + Input VAT recognition 时点锁死
3. ✅ 3 Hardening 已固化：documentStatus/settlementStatus 两维；首版 RECEIPT_BASED scope 明确；5C-1/5C-2 实现切片
4. ⏳ CTO 5C Gate Re-review（只核 4 Blocking + P1-P12 固化）→ 通过后才允许 Migration 0027
5. Schema / Migration 0027（未进 main 前直接修）→ Seed/RBAC → 5C-1 API（Supplier Invoice + Match + GRIR + AP Open Item）→ Workflow/Event/Audit → OpenAPI/QA/Test Cases → commit → push → GitHub CI → STOP
6. 5C-2（Supplier CN/DN + Payment Allocation）在 5C-1 完成后独立 Gate
