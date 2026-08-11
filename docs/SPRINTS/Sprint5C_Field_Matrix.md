# Sprint 5C：Field Matrix（供应商发票 → 三单匹配 → 应付账款 字段矩阵）

- 版本：v0.1（草案，待 CTO Design Review）
- 日期：2026-08-11
- 状态：**设计先行——禁止 Schema / Migration / API**
- 关联：Sprint5C_Supplier_Invoice_Three_Way_Match_AP_Gate.md / ADR-0027（草案）/ Sprint5C_CTO_Pending_Decisions.md
- CTO 授权：#8777 Post-6B Portfolio Gate —— **Track B Sprint 5C START（后端最高优先级）**

> 说明：本矩阵是**字段草案**（业务语义层），不是 Schema。所有字段名/类型/约束待 CTO Gate 批准后由 Migration 0027 落地。带 🔶 的字段为 Pending Decision（见 Pending Decisions 文档）。

---

## 1. SupplierInvoice（供应商发票事实）—— 供应商开票

### Header

| 字段（草案） | 语义 | 类型/约束草案 | 备注 |
| --- | --- | --- | --- |
| id | 主键 | UUID | |
| invoiceNo | 发票单号 | DocumentSequence（前缀 **SINV** 🔶，创建即取号） | **DRAFT 不占号 vs 创建即取号**（对齐 4D Issue 原子取号 vs 5A 创建即取号——Pending Decision P1） |
| supplierInvoiceNo | 供应商发票号 | string(100)，**供应商侧唯一**（UNIQUE 约束候选） | 防重复录入同一张发票 |
| supplierId | 供应商 | FK → Supplier，必填 | 供应商主数据（3C-1）复用 |
| invoiceDate | 开票日期 | date | |
| receivedDate | 收到日期 | date | |
| currency | 币种 | FK → Currency | 快照自 PO/供应商 |
| exchangeRate | 汇率 | Decimal(18,6) 🔶 | 对齐 4D 快照汇率模式（外币场景，Pending Decision P2） |
| grossAmount | 发票含税总额 | Decimal(18,2)，**服务端 Decimal 聚合**（Σ 行） | **禁客户端直传头金额**（对齐 5A PO 金额事实） |
| netAmount | 不含税总额 | Decimal(18,2)，服务端计算 | netAmount = Σ(行净额) |
| taxAmount | 税额合计 | Decimal(18,2)，服务端计算 | taxAmount = grossAmount - netAmount |
| status | 状态 | 草案：`DRAFT / SUBMITTED / MATCHED / APPROVED / POSTED / CANCELLED` | **状态机待 Pending Decision P3**（含 VARIANCE 差异路径） |
| matchResult | 三单匹配结果 | enum：`MATCHED / VARIANCE / PENDING` | 匹配后置位 |
| sourceType | 来源类型 | enum：`PO_ONLY / RECEIPT_BASED` 🔶 | PO-only 直票 vs 强制入库溯源（Pending Decision P4） |
| paymentDueDate | 付款到期日 | date 🔶 | 账期计算（对齐 4E-1 dueDate 模式，方向相反） |
| postedAt / postedById | 过账证据 | date-time / FK → User | **POSTED 终态证据**（对齐 6B 模式） |
| cancelledAt / cancelledById | 取消证据 | date-time / FK → User | POSTED 后禁取消（纠错走 Supplier CN/DN） |
| createdById / updatedById | 审计 | FK → User | |
| deletedAt / isActive | 软删 | 对齐既有模式 | |

### Lines（行级溯源 + 三单匹配）

| 字段（草案） | 语义 | 类型/约束草案 | 备注 |
| --- | --- | --- | --- |
| id | 主键 | UUID | |
| supplierInvoiceId | 发票头 | FK → SupplierInvoice | |
| purchaseOrderLineId | 溯源 PO Line | FK → PurchaseOrderLine（**可空** 🔶） | PO-only 直票可为空；RECEIPT_BASED 必填 |
| warehouseReceiptLineId | 溯源入库行 | FK → WarehouseReceiptLine（**可空** 🔶） | RECEIPT_BASED 必填（数量匹配基准） |
| itemId | 物料 | FK → Item，必填 | 快照自 PO/入库行 |
| quantity | 开票数量 | Decimal(18,4)，> 0 | |
| unitPrice | 单价 | Decimal(18,6) | 与 PO 快照单价比对（单价差异） |
| netAmount | 行净额 | Decimal(18,2)，服务端计算 | = quantity × unitPrice（Decimal 聚合） |
| taxRate | 税率快照 | Decimal(6,4) | 开票时点税率冻结（对齐 4D 快照税务） |
| taxAmount | 行税额 | Decimal(18,2)，服务端计算 | = netAmount × taxRate |
| matchStatus | 行匹配结果 | enum：`MATCHED / QTY_VARIANCE / PRICE_VARIANCE / TAX_VARIANCE / OVER_INVOICE / UNDER_INVOICE` | 三单匹配行级结果 |
| varianceQty / variancePrice / varianceTax | 差异明细 | Decimal | 数量/单价/税额差异（绝对值 + 方向） |
| matchedQty | 可匹配数量 | Decimal(18,4) | = min(invoiceQty, 可用入库量)；**超过已收数量部分不可入 AP**（红线） |
| remark | 备注 | string(500) | |

---

## 2. InvoiceMatch（三单匹配结果事实）🔶

> 设计取向：匹配结果随 Invoice 行内嵌（如上）vs 独立 InvoiceMatch 模型——Pending Decision P5。以下为独立模型候选（若拍板独立）。

| 字段（草案） | 语义 | 类型/约束草案 |
| --- | --- | --- |
| id | 主键 | UUID |
| supplierInvoiceId | 发票 | FK → SupplierInvoice |
| supplierInvoiceLineId | 发票行 | FK → SupplierInvoiceLine |
| purchaseOrderLineId | PO Line | FK → PurchaseOrderLine |
| warehouseReceiptLineId | 入库行 | FK → WarehouseReceiptLine |
| poQty / receiptQty / invoiceQty | 三单数量 | Decimal(18,4) |
| poUnitPrice / invoiceUnitPrice | 单价比对 | Decimal(18,6) |
| qtyVariance / priceVariance / taxVariance | 差异 | Decimal（服务端计算） |
| result | 结果 | enum：`MATCHED / VARIANCE` |
| disposition | 差异处置 | enum：`ACCEPT / REJECT / HOLD / CREATE_CN_DN` 🔶（Pending Decision P6） |

---

## 3. AP Open Item（应付未清项）

| 字段（草案） | 语义 | 类型/约束草案 | 备注 |
| --- | --- | --- | --- |
| id | 主键 | UUID | |
| supplierInvoiceId | 来源发票 | FK → SupplierInvoice（**POSTED 时生成**） | AP Liability 事实入口 |
| supplierId | 供应商 | FK → Supplier | |
| apAmount | 应付金额 | Decimal(18,2)，含税 | |
| allocatedAmount | 已核销金额 | Decimal(18,2)，默认 0 | **累计 allocation ≤ apAmount**（防超核销） |
| openAmount | 未清余额 | Decimal(18,2) | = apAmount - allocatedAmount（服务端计算） |
| dueDate | 到期日 | date | 账龄（对齐 4E-1 aging，方向相反） |
| status | 状态 | enum：`OPEN / PARTIALLY_ALLOCATED / CLOSED` | 余额归零 → CLOSED（惰性投影） |

---

## 4. SupplierCreditNote / SupplierDebitNote（供应商贷项/借项）🔶

> 模型取向：独立 SupplierCN/DN 单据 vs 复用 SupplierInvoice 调整行（signed adjustment）——Pending Decision P7。以下为独立模型候选（对齐 4E-3 但方向相反）。

| 字段（草案） | 语义 | 类型/约束草案 | 备注 |
| --- | --- | --- | --- |
| id | 主键 | UUID | |
| noteNo | 调整单号 | DocumentSequence（前缀 **SCN/SDN** 🔶） | |
| type | 类型 | enum：`SUPPLIER_CREDIT_NOTE / SUPPLIER_DEBIT_NOTE` | CN<0（冲减 AP）/ DN>0（增加 AP），signed 语义 |
| supplierInvoiceId | 关联发票 | FK → SupplierInvoice（可空 🔶） | 独立调整 vs 挂发票 |
| supplierId | 供应商 | FK → Supplier | |
| amount | 调整金额 | Decimal(18,2)（signed） | **累计防超调**：调整后 AP 余额不得为负（锁内重算） |
| status | 状态 | 草案：`DRAFT / SUBMITTED / APPROVED / APPLIED / CANCELLED` | **APPROVED ≠ APPLIED**（对齐 4E-3，Apply 唯一回写 AP 入口） |
| appliedAt / appliedById | 生效证据 | date-time / FK → User | 终态证据 CHECK |

---

## 5. Payment / PaymentAllocation（付款核销）

| 字段（草案） | 语义 | 类型/约束草案 | 备注 |
| --- | --- | --- | --- |
| id | 主键 | UUID | |
| paymentNo | 付款单号 | DocumentSequence（前缀 **PAY** 🔶） | |
| supplierId | 收款供应商 | FK → Supplier | |
| currency | 币种 | FK → Currency | **同供应商同币种**（对齐 4E-2） |
| amount | 付款金额 | Decimal(18,2)，服务端聚合 | |
| status | 状态 | 草案：`DRAFT / SUBMITTED / APPROVED / APPLIED / CANCELLED` | **Created ≠ Applied**（Apply 唯一回写 AP 余额入口，对齐 4E-2 WriteOff） |
| paidAt / paidById | 付款证据 | date-time / FK → User | |
| PaymentAllocationLine | 核销行 | M:N → AP Open Item | **累计 allocation ≤ openAmount**（锁内重算防超核销，对齐 4E-2） |

---

## 6. 状态机草案（Supplier Invoice）

```
DRAFT → SUBMITTED → MATCHED → APPROVED → POSTED（生成 AP Open Item）/ CANCELLED
         │              │
         │              └─> VARIANCE → 差异处置（ACCEPT → APPROVED / REJECT / HOLD / CREATE_CN_DN）
         └──────────────> CANCELLED（POSTED 后禁取消——纠错走 Supplier CN/DN）
```

> **红线**：POSTED 即 AP Liability 生成点（终态证据：postedAt/postedById 非空）；APPROVED ≠ POSTED；POSTED 后禁 Cancel（对齐 6B 状态机纪律：终态后纠错走 Reversal/Correction 等价物 = Supplier CN/DN）。
