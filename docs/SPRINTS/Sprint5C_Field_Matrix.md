# Sprint 5C：Field Matrix（供应商发票 → 三单匹配 → 应付账款 字段矩阵）

- 版本：v0.2（**CTO 5C Design Review 88/100 — APPROVED WITH CHANGES，#8845 已拍板**；原 v0.1 草案 P1-P12 已按 CTO 表转 Final）
- 日期：2026-08-11
- 状态：**设计先行——禁止 Schema / Migration / API**（CTO Gate Re-review 通过后才允许）
- 关联：Sprint5C_Supplier_Invoice_Three_Way_Match_AP_Gate.md（v0.2）/ ADR-0027（**Approved with Changes**）/ Sprint5C_CTO_Pending_Decisions.md（P1-P12 已拍板）
- CTO 授权：#8777 Post-6B Portfolio Gate —— **Track B Sprint 5C START（后端最高优先级）**；#8845 双轨首批评审（4 Blocking + 3 Hardening 已按指令修复）

> 说明：本矩阵是**字段草案**（业务语义层），不是 Schema。所有字段名/类型/约束待 CTO Gate 批准后由 Migration 0027 落地。带 🔶 的字段为 Pending Decision（见 Pending Decisions 文档）。

---

## 1. SupplierInvoice（供应商发票事实）—— 供应商开票

### Header

| 字段（草案） | 语义 | 类型/约束草案 | 备注 |
| --- | --- | --- | --- |
| id | 主键 | UUID | |
| invoiceNo | 发票单号 | DocumentSequence（前缀 **SINV**，创建即取号） | **创建即取号**（P1 Final：对齐 5A PO/6B 模式；Sequence 缺失 fail closed） |
| supplierInvoiceNo | 供应商发票号 | string(100)，**供应商侧唯一**（UNIQUE 约束候选） | 防重复录入同一张发票 |
| supplierId | 供应商 | FK → Supplier，必填 | 供应商主数据（3C-1）复用 |
| invoiceDate | 开票日期 | date | |
| receivedDate | 收到日期 | date | |
| currency | 币种 | FK → Currency | 快照自 PO/供应商 |
| exchangeRate | 汇率 | Decimal(18,6) | **创建时快照 FX**（P2 Final）；人工覆盖需受限权限 + audit |
| grossAmount | 发票含税总额 | Decimal(18,2)，**服务端 Decimal 聚合**（Σ 行） | **禁客户端直传头金额**（对齐 5A PO 金额事实） |
| netAmount | 不含税总额 | Decimal(18,2)，服务端计算 | netAmount = Σ(行净额) |
| taxAmount | 税额合计 | Decimal(18,2)，服务端计算 | taxAmount = grossAmount - netAmount |
| **documentStatus** | 单据状态（**P3 Final 两维之一**） | `DRAFT / SUBMITTED / MATCHED / APPROVED / POSTED / CANCELLED`（截止 POSTED/CANCELLED） | **付款核销不反向改变 documentStatus** |
| **settlementStatus** | 结算状态（**P3 Final 两维之二**，独立维度） | `UNPAID / PARTIALLY_PAID / PAID` | 由 Payment Allocation 驱动，不污染 documentStatus |
| matchResult | 三单匹配结果 | enum：`MATCHED / VARIANCE / PENDING` | 当前投影（历史走 immutable MatchRun） |
| **currentMatchRunId** | 当前匹配 Run 引用 | FK → SupplierInvoiceMatchRun | **审批必须引用 immutable matchRunId/revision**（Blocking ②） |
| sourceType | 来源类型 | enum：**`RECEIPT_BASED`（首版唯一，P4 Final）** | 必须 PO Line + 已 POSTED WHR 来源；Non-PO Expense/Service/纯费用 AP 不进入首版 |
| paymentDueDate | 付款到期日 | date | 账期计算（对齐 4E-1 dueDate 模式，方向相反） |
| postedAt / postedById | 过账证据 | date-time / FK → User | **POSTED 终态证据**（对齐 6B 模式）；AP Liability Fact 生成点 |
| cancelledAt / cancelledById | 取消证据 | date-time / FK → User | POSTED 后禁取消（纠错走 Supplier CN/DN） |
| createdById / updatedById | 审计 | FK → User | |
| deletedAt / isActive | 软删 | 对齐既有模式 | |

### Lines（行级溯源 + 三单匹配）

| 字段（草案） | 语义 | 类型/约束草案 | 备注 |
| --- | --- | --- | --- |
| id | 主键 | UUID | |
| supplierInvoiceId | 发票头 | FK → SupplierInvoice | |
| purchaseOrderLineId | 溯源 PO Line | FK → PurchaseOrderLine，**必填（P4 Final）** | 首版必须 PO Line 来源 |
| warehouseReceiptLineId | 溯源入库行 | FK → WarehouseReceiptLine，**必填（P4 Final）** | 首版必须已 POSTED WHR 来源（数量匹配基准） |
| itemId | 物料 | FK → Item，必填 | 快照自 PO/入库行 |
| quantity | 开票数量 | Decimal(18,4)，> 0 | |
| unitPrice | 单价 | Decimal(18,6) | 与 PO 快照单价比对（单价差异） |
| netAmount | 行净额 | Decimal(18,2)，服务端计算 | = quantity × unitPrice（Decimal 聚合） |
| taxRate | 税率快照 | Decimal(6,4) | 开票时点税率冻结（对齐 4D 快照税务） |
| taxAmount | 行税额 | Decimal(18,2)，服务端计算 | = netAmount × taxRate |
| **currentMatchStatus** | 行匹配结果（**当前投影**） | enum：`MATCHED / QTY_VARIANCE / PRICE_VARIANCE / TAX_VARIANCE / OVER_INVOICE / UNDER_INVOICE` | 三单匹配行级结果；**历史走 immutable MatchRun**（Blocking ②） |
| **currentMatchRunId** | 当前匹配 Run 引用 | FK → SupplierInvoiceMatchRun | **审批必须引用 immutable matchRunId/revision**（Blocking ②） |
| varianceQty / variancePrice / varianceTax | 差异明细 | Decimal | 数量/单价/税额差异（绝对值 + 方向） |
| matchedQty | 可匹配数量 | Decimal(18,4) | = min(invoiceQty, 可用入库量)；**超过已收数量部分不可入 AP**（红线） |
| remark | 备注 | string(500) | |

---

## 2. SupplierInvoiceMatchRun + SupplierInvoiceMatchLine（**immutable Match Snapshot**，Blocking ② Final）

> **CTO #8845 Blocking ②**：三单匹配可能因后续收货 / 分批发票 / snapshot / 差异处置**多次重算**——只靠 InvoiceLine 当前字段 + AuditLog 无法回答"这张发票当时为什么在 14:03 被批准？"。
> **拍板**：**不可变 MatchRun/MatchSnapshot**（每次匹配生成一条 Run，不可 UPDATE/DELETE，纠错追加新 Run）；`SupplierInvoiceLine.currentMatchStatus/currentMatchRunId` 只是**当前投影**；**审批必须引用 immutable matchRunId/revision**。

### 2.1 SupplierInvoiceMatchRun（匹配 Run 头——不可变）

| 字段（草案） | 语义 | 类型/约束草案 |
| --- | --- | --- |
| id | 主键 | UUID |
| supplierInvoiceId | 发票 | FK → SupplierInvoice |
| runNo | Run 序号 | int（每发票递增 1,2,3…） |
| revision | 修订号 | int | 不可变快照标识（审批引用） |
| runAt / runById | 匹配时点 | date-time / FK → User | |
| result | 头级结果 | enum：`MATCHED / VARIANCE` |
| disposition | 头级处置 | enum：`ACCEPT / REJECT / HOLD / CREATE_CN_DN` | 触发 Workflow 审批条件 |
| approvedAt / approvedById | 审批证据 | date-time / FK → User（可空） | **审批引用此 immutable runId** |
| createdById | 审计 | FK → User | |

### 2.2 SupplierInvoiceMatchLine（匹配 Run 行——不可变）

| 字段（草案） | 语义 | 类型/约束草案 |
| --- | --- | --- |
| id | 主键 | UUID |
| matchRunId | Run | FK → SupplierInvoiceMatchRun |
| supplierInvoiceLineId | 发票行 | FK → SupplierInvoiceLine |
| purchaseOrderLineId | PO Line | FK → PurchaseOrderLine |
| warehouseReceiptLineId | 入库行 | FK → WarehouseReceiptLine |
| poQty / receiptQty / invoiceQty | 三单数量 | Decimal(18,4) |
| poUnitPrice / invoiceUnitPrice | 单价比对 | Decimal(18,6) |
| qtyVariance / priceVariance / taxVariance | 差异 | Decimal（服务端计算） |
| result | 行结果 | enum：`MATCHED / VARIANCE` |
| disposition | 行处置 | enum：`ACCEPT / REJECT / HOLD / CREATE_CN_DN` |

> **幂等/不可变纪律**：Run 一旦生成不可修改；重新匹配 → 追加新 Run（revision+1）；旧 Run 保留审计（对齐 6A Movement 不可变 / 5B snapshot 模式）。

---

## 3. AP Open Item（应付未清项 —— **materialized projection / read model**，Blocking ③ Final）

> **CTO #8845 Blocking ③**：AP Open Item **不是新的财务事实源**（对齐 6A 库存事实/投影纪律）。事实层：`SupplierInvoice POSTED` / `Supplier CN-DN APPLIED` = **AP Liability Facts**；`PaymentAllocation` = **Settlement Fact**；AP Open Item = 物化投影（read model）。
> **Reconciliation（服务端计算，不手改）**：`openAmount = Liability + CN/DN - Allocations`；Allocation 纠错 → **追加 reversal/correction allocation**，不直接改 openAmount。

| 字段（草案） | 语义 | 类型/约束草案 | 备注 |
| --- | --- | --- | --- |
| id | 主键 | UUID | |
| supplierInvoiceId | 来源发票 | FK → SupplierInvoice（POSTED 时生成投影） | AP Liability Fact 投影 |
| supplierId | 供应商 | FK → Supplier | |
| **liabilityAmount** | 应付事实金额 | Decimal(18,2)，含税 | 源自 AP Liability Fact（不可变） |
| **cnDnAdjustment** | CN/DN 调整 | Decimal(18,2)，signed | 源自 Supplier CN/DN APPLIED Fact |
| allocatedAmount | 已核销金额 | Decimal(18,2)，默认 0 | **累计 allocation ≤ openAmount**（防超核销） |
| **openAmount** | 未清余额（**投影**） | Decimal(18,2)，服务端计算 | = liabilityAmount + cnDnAdjustment - allocatedAmount（reconciliation，不手改） |
| dueDate | 到期日 | date | 账龄（对齐 4E-1 aging，方向相反） |
| settlementStatus | 结算状态 | enum：`UNPAID / PARTIALLY_PAID / PAID` | 独立维度（P3 Final），不污染 documentStatus |

---

## 3.1 GRIR（暂估应付 —— Accrual / Reversal 生命周期，Blocking ① Final）

> **CTO #8845 Blocking ①**：GR/IR 必须有完整生命周期，含 **Purchase Return 冲回**。

| 阶段 | 触发 | 语义 | 源幂等身份 |
| --- | --- | --- | --- |
| **GRIR Accrual** | `WarehouseReceiptPosted` | 按 PO 快照单价 × 已入库数量生成暂估投影；**baseAmount = 不含税暂估净额**（P9 Final：进项税只在合规发票进入时确认） | WHR Line → accrual identity |
| **GRIR Reversal/Reduction** | `WarehouseReceipt-based PurchaseReturned` | **只有来自已 POSTED WarehouseReceiptLine 的退货才冲减 GR/IR**（未入库拒收/退货不产生 reversal，继承 5B 区分） | Return Line → reversal identity |
| **GRIR Consume** | `SupplierInvoice POSTED` | consume/reverse remaining GRIR + 生成真实 AP Liability Fact | Invoice Line → consume identity |

> 幂等纪律：三个 identity 各自唯一，**防重复冲回**（对齐 6A 五元幂等纪律）；暂估与实票差异走差异处置（P6 tolerance）。

---

## 4. SupplierCreditNote / SupplierDebitNote（供应商贷项/借项 —— **独立事实**，P7 Final）

> **CTO P7 Final**：Supplier CN/DN **独立事实，不能修改已 POSTED Invoice**；APPLIED 时调整 AP Liability Fact（signed）。对齐 4E-3 但方向相反（供应商开给我方）。

| 字段（草案） | 语义 | 类型/约束草案 | 备注 |
| --- | --- | --- | --- |
| id | 主键 | UUID | |
| noteNo | 调整单号 | DocumentSequence（前缀 **SCN/SDN** 🔶） | |
| type | 类型 | enum：`SUPPLIER_CREDIT_NOTE / SUPPLIER_DEBIT_NOTE` | CN<0（冲减 AP）/ DN>0（增加 AP），signed 语义 |
| supplierInvoiceId | 关联发票 | FK → SupplierInvoice（**可空** 🔶） | 独立调整 vs 挂发票——P7 Final：独立事实，可挂发票但**不修改已 POSTED Invoice** |
| supplierId | 供应商 | FK → Supplier | |
| amount | 调整金额 | Decimal(18,2)（signed） | **累计防超调**：调整后 AP Liability + CN/DN 不得为负（锁内重算） |
| status | 状态 | 草案：`DRAFT / SUBMITTED / APPROVED / APPLIED / CANCELLED` | **APPROVED ≠ APPLIED**（对齐 4E-3，Apply 唯一回写 AP Liability Fact 入口） |
| appliedAt / appliedById | 生效证据 | date-time / FK → User | 终态证据 CHECK（APPLIED ⇒ 全非空） |

---

## 5. Payment / PaymentAllocation（付款核销 —— **Settlement Fact**，Blocking ③ Final）

> **CTO #8845 Blocking ③**：PaymentAllocation = **Settlement Fact**（非 AP 余额事实）；AP Open Item 是投影。**纠错 → 追加 reversal/correction allocation**，不手改 openAmount。P10 Final：M:N 防超核销锁内重算。

| 字段（草案） | 语义 | 类型/约束草案 | 备注 |
| --- | --- | --- | --- |
| id | 主键 | UUID | |
| paymentNo | 付款单号 | DocumentSequence（前缀 **PAY** 🔶） | |
| supplierId | 收款供应商 | FK → Supplier | |
| currency | 币种 | FK → Currency | **同供应商同币种**（对齐 4E-2） |
| amount | 付款金额 | Decimal(18,2)，服务端聚合 | |
| status | 状态 | 草案：`DRAFT / SUBMITTED / APPROVED / APPLIED / CANCELLED` | **Created ≠ Applied**（Apply 唯一回写 Settlement Fact 入口，对齐 4E-2 WriteOff）；P12 Final maker-checker |
| paidAt / paidById | 付款证据 | date-time / FK → User | |
| PaymentAllocationLine | 核销行 | M:N → AP Open Item | **累计 allocation ≤ openAmount**（锁内重算防超核销，对齐 4E-2）；纠错 → reversal/correction allocation |

---

## 6. 状态机（Supplier Invoice —— **两维**，P3 Final）

### 6.1 documentStatus（单据状态，截止 POSTED/CANCELLED）

```
DRAFT → SUBMITTED → MATCHED → APPROVED → POSTED（生成 AP Liability Fact + consume GRIR）/ CANCELLED
         │              │
         │              └─> VARIANCE → 差异处置（ACCEPT → APPROVED / REJECT / HOLD / CREATE_CN_DN）
         └──────────────> CANCELLED（POSTED 后禁取消——纠错走 Supplier CN/DN）
```

### 6.2 settlementStatus（结算状态，独立维度）

```
UNPAID → PARTIALLY_PAID → PAID（由 Payment Allocation 驱动）
```

> **红线**：POSTED 即 AP Liability Fact 生成点（终态证据：postedAt/postedById 非空）；APPROVED ≠ POSTED；POSTED 后禁 Cancel（纠错走 Supplier CN/DN）；**付款核销不反向改变 documentStatus**（P3 Final，两维分离）。
