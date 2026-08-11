# Sprint 5C：CTO Pending Decisions（待拍板决策清单 → **CTO 5C Design Review 88/100 已拍板**）

- 版本：v0.2（**CTO #8845 已全部拍板**；原 v0.1 草案 P1-P12 已按 CTO 决策表转 Final）
- 日期：2026-08-11
- 状态：**设计先行——禁止 Schema / Migration / API**（CTO 5C Gate Re-review 通过前不写任何 5C 实现）
- 关联：Sprint5C_Supplier_Invoice_Three_Way_Match_AP_Gate.md（v0.2）/ ADR-0027（**Approved with Changes**）/ Sprint5C_Field_Matrix.md（v0.2）
- CTO 授权：#8777 Post-6B Portfolio Gate —— **Track B Sprint 5C START（后端最高优先级）**；#8845 双轨首批评审（4 Blocking + 3 Hardening 已修复，P1-P12 按表转 Final）

---

## CTO P1-P12 拍板总表（#8845）

| P | CTO Decision | 状态 |
| --- | --- | --- |
| P1 | ✅ 创建即取 SINV 编号；Sequence 缺失 fail closed | **Final** |
| P2 | ✅ Invoice creation 快照 FX；人工覆盖需受限权限 + audit | **Final** |
| P3 | 🔧 Document status 截止 POSTED/CANCELLED；付款进独立 settlementStatus（两维） | **Final（修改后固化）** |
| P4 | ✅ 首版只做 RECEIPT_BASED；必须 PO Line + 已 POSTED WHR 来源 | **Final** |
| P5 | ❌ 改为 immutable MatchRun/MatchSnapshot + current projection | **Final（方案推翻重定）** |
| P6 | ✅ tolerance policy；超阈值不得自动通过 | **Final** |
| P7 | ✅ Supplier CN/DN 独立事实，不能修改已 POSTED Invoice | **Final** |
| P8 | 🔧 GRIR 加 WarehouseReceipt-based PurchaseReturn reversal | **Final（修改后固化）** |
| P9 | 🔧 明确 net/tax canonical basis 与 input VAT recognition | **Final（修改后固化）** |
| P10 | ✅ PaymentAllocation M:N；防超核销，锁内重算 | **Final** |
| P11 | ✅ 5C 不建 GL，只发布稳定会计事件/接口 | **Final** |
| P12 | ✅ maker-checker，Creator ≠ Approver/Poster；Payment 同样执行 | **Final** |

---

## P1：SupplierInvoice 编号时机 —— ✅ Final（创建即取号 SINV）

**决策（CTO）**：**创建即取号（SINV DocumentSequence）**，缺失 fail closed 零 fallback（对齐 6B TRF/CNT/ADJ/CVT 模式）。
- 理由：采购侧单据一贯创建即取号（PO/GR/收据），发票录入是"供应商已开票"的事实记录，不是我方签发动作。
- 风险：创建即取号消耗编号（草稿废弃不回收）——采购侧可接受。

## P2：外币发票汇率 —— ✅ Final（创建时快照 FX）

**决策（CTO）**：**Invoice creation 时点快照 FX**（服务端 Decimal，头级），金额统一折本币聚合；**人工覆盖需受限权限 + audit**（快照即事实，对齐 4D 快照税务/汇率先例）。

## P3：SupplierInvoice 状态机 —— ✅ Final（两维：documentStatus + settlementStatus）

**决策（CTO）**：**documentStatus 截止 POSTED/CANCELLED**（`DRAFT → SUBMITTED → MATCHED → APPROVED → POSTED / CANCELLED`，含 VARIANCE 差异路径）；**付款进独立 settlementStatus**（`UNPAID / PARTIALLY_PAID / PAID`）——**付款核销不反向改变 documentStatus**（两维分离，CTO #8845 Hardening 1）。
- **APPROVED ≠ POSTED**（POSTED 唯一生成 AP Liability Fact 入口，终态证据 postedAt/postedById 非空）
- 差异路径：VARIANCE 不是终态，是中间态（挂起待处置）

## P4：发票溯源模式 —— ✅ Final（首版 RECEIPT_BASED）

**决策（CTO）**：**首版只做 RECEIPT_BASED**——必须 **PO Line + 已 POSTED WHR 来源**；SupplierInvoiceLine 溯源 WarehouseReceiptLine（数量匹配基准）+ PO Line（承诺快照）。
- **Non-PO Expense Invoice / Service Invoice / 纯费用 AP 不进入首版**（CTO #8845 Hardening 2，正式 Scope 收窄）
- 理由：三单匹配需要真实收货数量作匹配基准；PO-only 直票会破坏"已收未票/暂估冲销"闭环
- 备选（后续阶段）：预付/订金场景走独立 Prepayment/Deposit 模型（不混入 Supplier Invoice）

## P5：匹配结果模型 —— ✅ Final（immutable MatchRun/MatchSnapshot + current projection；CTO #8901 最终修正）

**决策（CTO）**：**❌ 原"行级内嵌 matchStatus + AuditLog"方案被否**（Blocking ②）——改为 **SupplierInvoiceMatchRun + SupplierInvoiceMatchLine（immutable Match Snapshot）**：
- 每次匹配生成一条 Run（**自创建后禁止任何业务字段 UPDATE/DELETE**，纠错追加新 Run）；`SupplierInvoiceLine.currentMatchStatus/currentMatchRunId` 只是**当前投影**
- **审批事实引用 immutable matchRunId/revision**：审批证据存 Workflow / SupplierInvoice approval evidence（`approvedMatchRunId` + `approvedMatchRevision`），**MatchRun 自身无 approvedAt/approvedById——Approval references MatchRun，不 mutates MatchRun**（CTO #8901 拍板：Run 在 match 时产生不可变，Approval 发生在之后、只引用不修改；若需显式业务关联，未来可设计独立 immutable approval evidence，本阶段不另造模型）
- 触发重算场景：后续收货 / 分批发票 / PO-receipt snapshot / 差异接受拒绝

## P6：差异处置 —— ✅ Final（tolerance policy；超阈值不得自动通过）

**决策（CTO）**：**tolerance policy；超阈值不得自动通过**。
- 数量差异：invoiceQty > 已收数量 → OVER_INVOICE（超过已收部分不可入 AP，挂起待收或供应商 CN）；invoiceQty < 已收数量 → UNDER_INVOICE（差异处置）
- 单价差异：invoiceUnitPrice ≠ PO 快照 → 容差内 ACCEPT；**超阈值不得自动通过** → 差异审批（Workflow，module=SUPPLIER_INVOICE）或 Supplier CN/DN；容差优先级对齐 5B 超收容差模式（PO Line → Supplier+Item → Item → Supplier → System 0%）
- 税额差异：invoiceTax ≠ 服务端计算税 → 差异处置（税务快照/税率配置核对）

## P7：Supplier CN/DN 模型 —— ✅ Final（独立事实，不能修改已 POSTED Invoice）

**决策（CTO）**：**Supplier CN/DN 独立事实**（SCN/SDN 序列），signed adjustment（CN<0 冲减 AP / DN>0 增加 AP）+ 累计防超调锁内重算（调整后 AP Liability + CN/DN 不得为负）；状态机 DRAFT/SUBMITTED/APPROVED/APPLIED/CANCELLED，**APPROVED ≠ APPLIED**（Apply 唯一回写 AP Liability Fact 入口）。
- **不能修改已 POSTED Invoice**（对齐 4E-3 治理先例，方向相反）
- 触发：发票差异处置 / 退货（5B PurchaseReturn CREDIT_ONLY 处置关联）

## P8：暂估应付触发 —— ✅ Final（自动暂估 + **WHR-based PurchaseReturn reversal**）

**决策（CTO）**：**自动暂估**（WarehouseReceipt Posted 时按 PO 快照单价 × 已入库数量生成 GRIR Accrual；不生成真实 AP Open Item）；**🔧 加 WarehouseReceipt-based PurchaseReturn reversal（Blocking ①）**：
- 完整生命周期：`WarehouseReceiptPosted → GRIR Accrual`；`WHR-based PurchaseReturned → GRIR Reversal/Reduction`（**只有来自已 POSTED WarehouseReceiptLine 的退货才冲减 GR/IR**——未入库拒收/退货不产生 reversal，继承 5B 区分）；`SupplierInvoice POSTED → consume/reverse remaining GRIR + create actual AP Liability`
- **源幂等身份**：WHR Line → accrual identity；Return Line → reversal identity；Invoice Line → consume identity（防重复冲回，对齐 6A 五元幂等纪律）

## P9：进项税处理 —— ✅ Final（价税分离 + canonical basis 锁死；CTO #8901 最终拍板）

**决策（CTO）**：**价税分离（Blocking ④）**——SupplierInvoiceLine 存 `netAmount`（不含税）+ `taxRate`（快照）+ `taxAmount`；税基 = 匹配后的净额。
- **GR/IR baseAmount = 不含税暂估净额**：PO 含税价 normalize 成暂估净额（税率快照自 PO/税务配置）——**进项税只在合规发票事实进入时确认，暂估阶段不隐式确认 Input VAT**（中国采购业务：可抵扣进项税只在合规发票进入时确认）
- **VAT recoverable 标记** + `Invoice POSTED` 拆分 **net liability / input VAT / total AP**
- **不可抵扣税（CTO #8901 Final 边界）**：recoverable=true → 税额进 **Input VAT component**；recoverable=false → 税额进 **nonRecoverableTaxAmount（expense-or-capitalizable component）财务事实**——5C 只保存/发布该金额事实，**不写 InventoryMovement/StockProjection/库存成本层**（不把不可抵扣税资本化进 Inventory Cost，Costing HOLD 保持），未来 Costing/GL 决定该 component 最终资本化还是费用化；**AP 总债务 = net + total tax，不因 recoverability 改变应付总额**

## P10：付款核销 —— ✅ Final（Payment 独立事实 + M:N Allocation）

**决策（CTO）**：Payment（PAY 序列，DRAFT/SUBMITTED/APPROVED/APPLIED/CANCELLED）+ PaymentAllocationLine M:N 核销 AP Open Item；**Created ≠ Applied**（Apply 唯一回写 Settlement Fact）；**累计 allocation ≤ openAmount 锁内重算防超核销**；同供应商同币种。
- **PaymentAllocation = Settlement Fact**（Blocking ③ 分层）；纠错 → 追加 reversal/correction allocation，不手改 openAmount

## P11：与 GL 的边界 —— ✅ Final（5C 不建 GL，只发布稳定会计事件/接口）

**决策（CTO）**：**不建 GL 总账**；5C 产出"财务事实"（AP Liability Fact / GRIR / Supplier CN-DN / Payment Settlement），**只发布稳定会计事件/接口**，GL 过账留给未来 Finance 阶段消费（对齐 4E 不写 GL 先例）。

## P12：maker-checker / 审批边界 —— ✅ Final（Creator ≠ Approver/Poster；Payment 同样执行）

**决策（CTO）**：**POSTED（过账）与 Payment Apply（核销）为受限权限**（SUPER_ADMIN/ADMIN，对齐 6B inventory-adjustment:apply 模式）；**Creator ≠ Approver/Poster（maker-checker，DB CHECK + service 双保险）**；**Payment 同样执行 maker-checker**；差异审批走 Workflow（module=SUPPLIER_INVOICE，对齐 4E-3 条件审批模式）。

---

> **注**：P1-P12 已全部转 Final（CTO #8845）。4 Blocking + 3 Hardening 修复已固化进 ADR-0027 / Gate / Field Matrix。**Schema/Migration 0027 仍需 CTO 5C Gate Re-review 通过后创建**。
