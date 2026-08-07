# CTO Final Review Cover — Sprint 4D Invoice Foundation

**PR:** #15 – Invoice Foundation
**Branch:** `feature/sprint4-sales`
**Head:** `772d1e3`
**Status:** Ready for CTO Final Review

## 1. Scope

本 PR 完成 Sprint 4D Invoice Foundation 全部计划范围：

- Invoice Domain（财务事实源）
- Schema + Migration 0017
- Seed + RBAC
- Invoice Creation（唯一来源 Delivery）
- Partial Billing
- Consolidated Billing
- Invoice Issue（原子取号）
- Invoice Cancel（释放开票占用）
- Query APIs（列表/详情/lines/revisions/snapshots）
- PATCH Header（仅 DRAFT + 乐观锁 + 字段白名单）
- Workflow Integration（审批门禁 + 重审逻辑）
- OpenAPI
- QA
- Test Cases
- ADR
- ERD
- Domain Events

**未包含：**

- AR / Payment（Sprint 4E）
- Credit Note / Debit Note（4F/后续）
- InvoiceAttachment 独立表（File Center）
- InvoiceApproval 独立表（Workflow 复用）
- InvoicePrice 独立表（价格快照复用）
- VOID（Credit Note 承载）
- Direct Invoice（POST /api/invoices）

## 2. Architecture Verification

### Domain Boundary

- Invoice 为**财务事实源**（Delivery 为物流事实源，职责分离，互不重算）。
- 唯一来源：Delivery（`POST /api/deliveries/{id}/invoice`）。
- 禁止 Quotation→Invoice / SalesOrder→Invoice。

### 四段溯源链取价（金额红线）

```
InvoiceLine
    ↓ sourceDeliveryLineId
DeliveryLine
    ↓ sourceSalesOrderLineId
SalesOrderLine
    ↓ priceSnapshotId
QuotationPriceSnapshot
```

- 直接复制价格快照（priceSnapshotId / unitPrice / discountRate / lineAmount / taxAmount / totalAmount）。
- **永不重算、不调用 Pricing Engine**（Pricing 作用域到 Sales Order 为止，ADR-0015）。
- 头金额 subtotal / taxAmount / invoiceTotal 由行复制值 Decimal 加总；禁止前端提交价格字段。

### Partial Billing（CTO 拍板①）

- DeliveryLine 增加投影 `invoicedQty` / `remainingInvoiceQty`（Migration 0017）。
- 开票 qty > 0 且 ≤ remainingInvoiceQty（锁内读，禁止事务外读算写）。
- 超出 → `409 INVOICE_QUANTITY_EXCEEDED`。
- Cancel 对称回滚（invoicedQty -= qty；remainingInvoiceQty += qty）。

### Consolidated Invoice（CTO 拍板②）

- `primaryDeliveryId` + `deliveryIds[]` 合并开票。
- Customer / Currency / TaxProfile / PaymentTerm 必须一致 → 否则 `409 INVOICE_SOURCE_NOT_COMPATIBLE`。
- 锁序：全部来源 Delivery 按 id ASC 锁定（防死锁）。

### Invoice Line（CTO 拍板③）

- InvoiceLine 系统生成只读，无 lines PATCH。

### Cancel（CTO 拍板④）

- 仅 DRAFT 可取消 → `409 INVOICE_INVALID_STATE`（ISSUED+ 走 Credit Note）。
- 不提供 VOID。

### 编号策略（CTO 必改①）

- DRAFT `code = NULL` 不占号。
- 仅 ISSUE 时 DocumentSequence 原子取号（INV-2026-000123）。
- 并发 issue：FOR UPDATE 锁 + status 校验 → 第二个请求稳定 `409`，不消耗第二个编号。

### Snapshot（CTO 必改②）

- InvoiceSnapshot 含完整税务/汇率快照：`taxProfileId / taxRate / sstNo / currencyRate / exchangeRate`。
- 快照节点：CREATED / ISSUED / CANCELLED（无 APPROVED——审批终态只回写投影）。
- 所有金额 `Decimal.toString()`，禁止 Float / Number 转换。

### Workflow

- 复用统一 Workflow：ApprovalPolicy(module=INVOICE) → WorkflowDefinition → WorkflowInstance（单实例约束不变）。
- 未新增 `InvoiceApproval`。
- Issue 审批门禁：workflowInstanceId ≠ null 时仅 APPROVED 可开票，否则 409。
- PATCH 重审：paymentTerm / dueDate 变更 → 同事务 maybeTriggerInvoiceApproval（无实例创建 / RUNNING 保持 / 终态复用重新 SUBMIT）；remark 不触发；策略缺失 → 409 INVOICE_WORKFLOW_FAILED 整体回滚。

## 3. Quality Gates

- CI：Quality Gates ✅ / Build ✅ / Secret Scanning ✅
- Head：`772d1e3`（Phase 1-4 + 文档 Commit 1 全绿：#31192127210 / #31193316359 / #31199349323 / #31201507334 / #31201664772 / #31202368518；Commit 2 文档 run 排队中）

## 4. Documentation

完成：OpenAPI（8 端点 / 19 schemas，156 paths / 410 schemas）/ QA（Sprint4D_QA.md，T1-T18）/ Test Cases（Invoice_API.md，137 用例 A-M 13 组）/ DOMAIN_MODEL（v1.11，第 22 章 Invoice Foundation）/ ADR-0019（Accepted + Implemented）/ EVENTS（v1.8），全部与实现一致。

## 5. CTO Checklist

| Item | Status |
| --- | --- |
| Invoice 唯一来源 Delivery（无 Direct Invoice） | ✅ |
| Partial Billing（invoicedQty/remainingInvoiceQty 投影） | ✅ |
| Consolidated Billing（财务属性一致校验） | ✅ |
| 防超开票（409 INVOICE_QUANTITY_EXCEEDED） | ✅ |
| DRAFT 不占 Invoice 编号（code=NULL） | ✅ |
| Issue 原子取号（DocumentSequence，并发 409 不消耗编号） | ✅ |
| Cancel 释放开票占用（投影对称回滚） | ✅ |
| 不调用 Pricing Engine（四段溯源链复制价格快照） | ✅ |
| InvoiceLine 不自由编辑（无 lines PATCH） | ✅ |
| Workflow 唯一审批事实源（无 InvoiceApproval 表） | ✅ |
| 财务字段变更重新审批（paymentTerm/dueDate；remark 不触发） | ✅ |
| Decimal 无 Float/Number 精度转换（全程 Prisma.Decimal） | ✅ |
| Snapshot 税务/汇率可还原（taxProfileId/taxRate/sstNo/currencyRate/exchangeRate） | ✅ |
| 无 AR/Payment/Credit Note 越界实现（4E 边界） | ✅ |

## 6. Review Result

**Recommendation: APPROVE & MERGE**

Sprint 4D Invoice Foundation 已达到合并标准。

Merge 后执行：

1. Merge PR #15
2. 更新 CHANGELOG（Ready for Final Review → Completed）
3. 更新 RELEASE_NOTES
4. 更新 ROADMAP
5. 保留 `feature/sprint4-sales`
6. 进入 **Sprint 4E – AR/Payment（收款/核销/应收余额）**
7. 撤销本次用于推送的新 PAT
