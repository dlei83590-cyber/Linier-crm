# ADR-0019：Invoice Domain（发票领域模型边界与财务事实源决策）

- 状态：**Draft（Sprint 4D 设计阶段，CTO 启动令 2026-08-07；4 项 Pending Decisions 待拍板；禁止写业务代码）**
- 日期：2026-08-07
- 关联：ADR-0015（Pricing Engine 唯一入口）、ADR-0016（Quotation Domain）、ADR-0017（Sales Order Domain）、ADR-0018（Delivery Domain）、Sprint4D_Invoice_Design.md、EVENTS.md（v1.7 注册）、Sprint4C_Delivery_Design.md（已实现，PR #14）
- 背景：Sprint 4C Delivery Foundation 已合并（PR #14，d1d8106）。Sprint 4D 进入 Invoice 设计。CTO 启动令：**Invoice 是整个 ERP 财务链的起点**（后续 AR、Receipt、Credit Note、Debit Note、GL 都依赖它），比 4A~4C 更需要一次性设计正确。**Invoice 是财务事实，不是物流事实**；本阶段仅设计（3 文件），不写代码；Payment 属 Sprint 4E。
- **边界锁死（CTO 启动令）**：Invoice 唯一来源 = Delivery（禁止 Quotation→Invoice、SalesOrder→Invoice）；Invoice 永远不重新计算价格（直接复制价格快照，不调用 Pricing Engine——Pricing Engine 到 Sales Order 为止）；不建 InvoiceApproval / InvoiceAttachment / InvoicePrice（复用 Workflow / File Center / Pricing Snapshot）；无 VOID（VOID 语义后续交 Credit Note）。

## 决策

### 1. Invoice 是财务事实源（定位）

- **核心原则：发票金额以 InvoiceLine 为唯一财务事实。** Invoice 处于销售财务链第四环：Quotation → SalesOrder → Delivery → **Invoice** → AR → Receipt。
- Invoice 从 Delivery 开票（Delivery 为物流事实源，Invoice 为财务事实源；两者职责分离，互不重算）。
- 收款投影 `paidAmount / balanceAmount` 仅 4E Receipt 回写（本阶段固定 0）；`invoiceTotal` 由行复制值加总（Decimal 求和）。

### 2. Invoice 唯一来源 Delivery（Direct Invoice 禁止）

- `Invoice.deliveryId` NOT NULL；唯一入口 `POST /api/deliveries/{id}/invoice`；不开放 `POST /api/invoices`。
- **禁止** `Quotation → Invoice`、`SalesOrder → Invoice`（不允许从报价/订单直接开票）。
- 开票前置：Delivery.status = DELIVERED（客户已确认收货，方可开票）。
- InvoiceLine 必须 `sourceDeliveryLineId`（四段溯源链末端）：QuotationLine → SalesOrderLine → DeliveryLine → InvoiceLine。

### 3. 不建 InvoiceApproval / InvoiceAttachment / InvoicePrice（统一复用）

- **审批**：不建 InvoiceApproval 表；WorkflowInstance/WorkflowAction/WorkflowHistory 为唯一审批事实源（与 ADR-0016/0017/0018 同构）；Invoice 仅存投影 workflowInstanceId / approvalStatus / approvedAt / approvedById。
- **附件**：不建 InvoiceAttachment 表；FileAttachment businessType="invoice"（File Center）。
- **价格**：不建 InvoicePrice 表；价格事实源在 QuotationPriceSnapshot（ADR-0015）；Invoice 不重新定价。

### 4. Invoice 永远不重新计算价格（新增红线，CTO 启动令）

- Invoice 创建时**直接复制**价格快照：`priceSnapshotId / unitPrice / discountRate / lineAmount / taxAmount / totalAmount` ← SalesOrderLine 对应快照值（经 DeliveryLine.sourceSalesOrderLineId 溯源取价）。
- **Invoice 不调用 Pricing Engine**；Pricing Engine 作用域**到 Sales Order 为止**（ADR-0015）；Invoice 属于财务确认，不属于重新报价。
- 头金额 `subtotal / taxAmount / invoiceTotal` 由行复制值 Decimal 加总；禁止前端提交任何价格字段。

### 5. Invoice 状态机与边界（CTO 启动令）

- **状态流转**：DRAFT → ISSUED → PARTIALLY_PAID → PAID；DRAFT → CANCELLED。
- **无 VOID**：VOID 语义后续由 Credit Note 承载（本阶段不提供 VOID 动作）。
- ISSUED 后不可直接取消（后续走 Credit Note）；仅 DRAFT 可取消。
- PARTIALLY_PAID / PAID 由 4E Receipt 回写（本阶段枚举保留不实现）。

### 6. Payment 不属于本 Sprint（4E 边界）

- Invoice 只维护 `invoiceTotal / paidAmount / balanceAmount` 三个金额投影；Payment（收款/核销/应收余额更新）属 **Sprint 4E（AR/Payment）**。
- 4D 不提供任何收款端点；不实现 /complete。

### 7. 开票数量防超（防超开票，对齐防超交模式）

- 创建 InvoiceLine 时校验 `quantity <= DeliveryLine.quantity`（开票数量不得超过已交付数量）。
- 同一 DeliveryLine 累计开票量校验（Partial Billing 场景）：`开票量累计 <= 已交付量`，超出 → 409（错误码 4D 实现阶段定，建议 INVOICE_QUANTITY_EXCEEDED）。
- 并发安全：事务内 FOR UPDATE 锁 Delivery → 锁 SalesOrder → 按 id ASC 锁涉及全部 DeliveryLine（对齐 4C confirm 锁序，防死锁）。

### 8. EVENTS 先注册后开发（EVENTS.md v1.7 注册）

- 注册 5 个 Invoice 事件：InvoiceCreated / InvoiceIssued / InvoiceCancelled / InvoicePartiallyPaid / InvoicePaid。
- 后两个（PartiallyPaid/Paid）虽 4E 才实现，**也要先注册**（CTO 启动令：先注册后开发）。
- 事件总线落地前以 AuditLog 留痕（与 Quotation/SalesOrder/Delivery 一致）。

### 9. 模型边界锁定

| 动作 | 模型 | 说明 |
| --- | --- | --- |
| ✅ 新增 | Invoice / InvoiceLine / InvoiceRevision / InvoiceSnapshot | 4 模型（财务事实源 + 行快照复制 + 修订 + 快照） |
| ❌ 禁止 | InvoiceApproval | Workflow 为唯一审批事实源 |
| ❌ 禁止 | InvoiceAttachment | File Center |
| ❌ 禁止 | InvoicePrice | 价格事实源在 QuotationPriceSnapshot（ADR-0015） |

### 10. CTO Pending Decisions（4 项待拍板，本轮重点）

| # | 问题 | 默认建议 | 影响面 |
| --- | --- | --- | --- |
| ① | 一张 Delivery 是否允许拆成多张 Invoice？ | **允许（Partial Billing）** | 创建路由允许多 Invoice 引用同 Delivery；超开票校验按 DeliveryLine 累计 |
| ② | 多张 Delivery 是否允许合并开一张 Invoice？ | **允许（Consolidated Invoice）** | 创建路由支持多 Delivery 聚合；锁序按多 Delivery 排序 |
| ③ | Invoice 是否允许编辑 Line？ | **禁止**（金额来自 Delivery） | 不提供 lines PATCH；行在创建时确定 |
| ④ | Invoice Cancel 是否允许直接取消？ | **仅 DRAFT 可取消**（ISSUED+ 走 Credit Note） | cancel 状态限制（DRAFT only） |

## 影响

- Sprint 4D Schema（0017_invoice_foundation，CTO Review 拍板后实现阶段创建）：**+4 枚举 / +4 表**，仅新增不改既有（若 CTO 决定 DeliveryLine 增加价格投影列则并入）。
- 取价走四段溯源链（InvoiceLine → DeliveryLine → SalesOrderLine → priceSnapshotId），保持 Delivery 物流事实源纯净。
- 后续 4E AR/Payment、Sprint 5 采购、Sprint 7 财务引用本 ADR 与 ADR-0015/0016/0017/0018，禁止重新设计开票/取价。
