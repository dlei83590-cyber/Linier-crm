# EVENTS 领域事件注册表（Domain Events）

- 版本：v1.9
- 日期：2026-08-08
- 维护者：CIO（JINZA）｜审核：CTO
- 关联：[API_GUIDELINES.md](./API_GUIDELINES.md) ｜ [ARCHITECTURE_BASELINE.md](./ARCHITECTURE_BASELINE.md)

> **规则**：所有领域事件必须在此注册。模块之间禁止直接调用（如审批通过后直接调通知模块），
> 统一通过事件总线发布/订阅。Notification、BI、Webhook 全部监听事件，不模块互调。
> 事件总线（Domain Events 基础设施）在 **Sprint 4 前**落地；Sprint 3C 先完成事件命名与载荷约定。

## 1. 事件格式（Event Envelope）

```json
{
  "eventId": "evt_01HX...",           // 事件唯一 ID（UUID）
  "eventType": "ProjectCreated",      // 事件类型（驼峰，见注册表）
  "version": 1,                        // 事件版本
  "occurredAt": "2026-08-05T12:00:00Z", // 发生时间（UTC ISO 8601）
  "producer": "project-service",      // 产生方（模块）
  "traceId": "trace_xxx",             // 链路追踪（与 AuditLog 一致）
  "payload": { }                       // 载荷（见各事件定义）
}
```

## 2. 已注册事件

### 2.1 项目领域

| eventType | 触发时机 | 载荷示例 |
| --- | --- | --- |
| `ProjectCreated` | 项目建档 | `{ projectId, code, customerId, stage }` |
| `ProjectOpportunityCreated` | 机会建档 | `{ opportunityId, code, customerId, stage }` |
| `ProjectOpportunityConverted` | 机会转项目（唯一入口 convert，事务） | `{ opportunityId, projectId, code, customerId, convertedBy }` |
| `ProjectStageChanged` | 项目阶段变更 | `{ projectId, fromStage, toStage, remark }` |
| `ProjectMemberAssigned` | 项目成员分配 | `{ projectId, memberId, userId, name, roleInProject }` |
| `ProjectMilestoneCompleted` | 里程碑完成 | `{ projectId, milestoneId, name }` |
| `ProjectRiskRaised` | 风险提出 | `{ projectId, riskId, description, ownerId }` |
| `ProjectRiskClosed` | 风险关闭 | `{ projectId, riskId, closedAt }` |
| `ProjectAccepted` | 项目验收通过 | `{ projectId, acceptanceId, name, result }` |
| `ProjectClosed` | 项目结项（正常） | `{ projectId, closedAt, reason }` |
| `ProjectForceClosed` | 项目强制结项（带权限+原因） | `{ projectId, closedAt, reason, force, closedBy }` |

### 2.2 工作流

| eventType | 触发时机 | 载荷示例 |
| --- | --- | --- |
| `WorkflowInstanceStarted` | 审批实例启动（SUBMIT） | `{ instanceId, definitionCode, businessType, businessId, startedBy }` |
| `WorkflowApproved` | 审批通过（终态 COMPLETED） | `{ instanceId, definitionCode, businessType, businessId, approverId }` |
| `WorkflowRejected` | 审批驳回（终态 REJECTED） | `{ instanceId, definitionCode, businessType, businessId, approverId, comment }` |
| `WorkflowStepCompleted` | 单步审批完成 | `{ instanceId, stepNo, stepName, action, actorId }` |
| `WorkflowTerminated` | 审批终止 | `{ instanceId, businessType, businessId, actorId }` |
| `WorkflowWithdrawn` | 审批撤销 | `{ instanceId, businessType, businessId, actorId }` |

### 2.3 业务单据（Sprint 4+ 触发）

| eventType | 触发时机 | 载荷示例 |
| --- | --- | --- |
| `SalesOrderCreated` | 销售订单创建 | `{ orderId, code, customerId, amount }` |
| `InvoiceCreated` | 发票创建 | `{ invoiceId, code, customerId, amount }` |
| `InvoicePaid` | 收款核销 | `{ invoiceId, paymentId, amount }` |
| `PurchaseCompleted` | 采购完成（GRN 收料） | `{ poId, grnId, supplierId }` |
| `ExpenseApproved` | 费用报销审批通过 | `{ expenseId, amount, approverId }` |

#### 2.3.1 报价领域（Sprint 4A 注册，先注册后开发）

> 统一载荷：所有 Quotation 事件 payload 至少包含 `eventId / eventType / occurredAt / actorId / quotationId / quotationCode / revisionNo / customerId / projectId / workflowInstanceId / currency / totalAmount`（eventId/eventType/occurredAt 由 Event Envelope 提供）。

| eventType | 触发时机 | 载荷示例 | 实现状态（Sprint 4A） |
| --- | --- | --- | --- |
| `QuotationCreated` | 报价单创建（DRAFT） | `{ quotationId, quotationCode, revisionNo, customerId, projectId, workflowInstanceId, currency, totalAmount, createdBy }` | ✅ 已发布 |
| `QuotationUpdated` | 草稿/驳回态修改（商业内容变更） | `{ quotationId, quotationCode, revisionNo, customerId, projectId, workflowInstanceId, currency, totalAmount, changedBy }` | ✅ 已发布（头/行变更均触发） |
| `QuotationRevisionCreated` | 影响商业内容的修改生成 Revision | `{ quotationId, quotationCode, revisionNo, changeReason, customerId, projectId, currency, totalAmount, createdBy }` | ⏳ 注册待实现（当前伴随 QuotationUpdated） |
| `QuotationSubmitted` | 报价单提交审批（SUBMITTED） | `{ quotationId, quotationCode, revisionNo, customerId, projectId, workflowInstanceId, currency, totalAmount, submittedBy }` | ✅ 已发布 |
| `QuotationApproved` | Workflow 最终批准时产生（终态 COMPLETED） | `{ quotationId, quotationCode, revisionNo, customerId, projectId, workflowInstanceId, currency, totalAmount, approverId }` | ✅ 已发布（workflow-sync 回写） |
| `QuotationRejected` | Workflow 最终驳回时产生（终态 REJECTED） | `{ quotationId, quotationCode, revisionNo, customerId, projectId, workflowInstanceId, currency, totalAmount, approverId, comment }` | ✅ 已发布（workflow-sync 回写） |
| `QuotationSent` | 报价已发送客户（SENT） | `{ quotationId, quotationCode, revisionNo, customerId, projectId, workflowInstanceId, currency, totalAmount, sentBy }` | ⏳ 注册待实现（SENT 无独立发送 API） |
| `QuotationExpired` | 读取或业务操作发现过期时记录（不要求定时发布） | `{ quotationId, quotationCode, revisionNo, customerId, currency, totalAmount, validUntil, expiredAt }` | ⏳ 注册待实现（惰性判定，仅投影） |
| `QuotationAccepted` | 客户接受报价（ACCEPTED） | `{ quotationId, quotationCode, revisionNo, customerId, projectId, workflowInstanceId, currency, totalAmount, acceptedBy }` | ✅ 已发布 |
| `QuotationConverted` | 报价转 Sales Order（CONVERTED） | `{ quotationId, quotationCode, revisionNo, customerId, projectId, workflowInstanceId, currency, totalAmount, salesOrderId, convertedBy }` | ⏳ 注册待实现（Sprint 4B convert 落地） |
| `QuotationCancelled` | 报价取消（CANCELLED） | `{ quotationId, quotationCode, revisionNo, customerId, projectId, workflowInstanceId, currency, totalAmount, cancelledBy, reason }` | ✅ 已发布 |

#### 2.3.2 销售订单领域（Sprint 4B 注册，先注册后开发）

> 统一载荷：所有 SalesOrder 事件 payload 至少包含 `eventId / eventType / occurredAt / actorId / salesOrderId / salesOrderCode / quotationId / customerId / currency / totalAmount`（eventId/eventType/occurredAt 由 Event Envelope 提供）。
> 来源：Sprint4B_SO_Design.md / ADR-0017；事件总线落地前以 AuditLog 留痕（与 Quotation 一致）。

| eventType | 触发时机 | 载荷示例 | 实现状态 |
| --- | --- | --- | --- |
| `SalesOrderCreated` | Quotation convert 成功（DRAFT） | `{ salesOrderId, salesOrderCode, quotationId, quotationCode, customerId, projectId, currency, totalAmount, createdBy }` | ✅ 已发布（Sprint 4B convert 落地） |
| `SalesOrderUpdated` | 订单头/行商业条件变更（Revision） | `{ salesOrderId, salesOrderCode, revisionNo, changeReason, changedBy }` | ✅ 已发布（头/行 PATCH） |
| `SalesOrderConfirmed` | 确认订单（DRAFT → CONFIRMED） | `{ salesOrderId, salesOrderCode, customerId, totalAmount, confirmedBy }` | ✅ 已发布（confirm） |
| `SalesOrderCancelled` | 取消订单（DRAFT/CONFIRMED → CANCELLED） | `{ salesOrderId, salesOrderCode, cancelledBy, reason }` | ✅ 已发布（cancel） |
| `SalesOrderApprovalStarted` | Workflow 条件触发创建审批实例（Sprint 4B 新增留痕） | `{ salesOrderId, salesOrderCode, workflowInstanceId, currency, totalAmount }` | ✅ 已发布（workflow-sync，AuditLog 留痕；未注册独立领域事件） |
| `SalesOrderDeliveryStarted` | 首次交付触发（Sprint 4C 联动） | `{ salesOrderId, salesOrderCode, deliveryId, startedBy }` | ⏳ 注册待实现（4C，首次 confirm-delivery 可联动发布） |
| `SalesOrderDelivered` | 全部交付完成（Sprint 4C 联动） | `{ salesOrderId, salesOrderCode, deliveryId, deliveredAt }` | ✅ 已发布（confirm-delivery 聚合联动，v1.6 标注） |
| `SalesOrderCompleted` | 交付+回款完成终态（Sprint 4C/4D） | `{ salesOrderId, salesOrderCode, completedAt }` | ⏳ 注册待实现（4C/4D） |

> 注：§2.3 业务单据表原有 `SalesOrderCreated { orderId, code, customerId, amount }` 占位，v1.4 升级为统一载荷并补齐 7 个事件。

#### 2.3.3 交付领域（Sprint 4C 注册，先注册后开发）

> 统一载荷：所有 Delivery 事件 payload 至少包含 `eventId / eventType / occurredAt / actorId / deliveryId / deliveryCode / salesOrderId / customerId`（eventId/eventType/occurredAt 由 Event Envelope 提供）。
> 来源：Sprint4C_Delivery_Design.md / ADR-0018；Delivery 为交付事实源，SalesOrder 仅保存聚合投影（PARTIALLY_DELIVERED/DELIVERED 由 Delivery 聚合回写）；事件总线落地前以 AuditLog 留痕（与 Quotation/SalesOrder 一致）。

| eventType | 触发时机 | 载荷示例 | 实现状态 |
| --- | --- | --- | --- |
| `DeliveryCreated` | 创建交付单（DRAFT，经 SO 创建） | `{ deliveryId, deliveryCode, salesOrderId, salesOrderCode, customerId, createdBy }` | ✅ 已实现（Phase 3 POST /api/sales-orders/{id}/deliveries） |
| `DeliveryUpdated` | 头/行内容变更（Revision） | `{ deliveryId, deliveryCode, revisionNo, changeReason, changedBy }` | ✅ 已实现（Phase 3 PATCH 头/行） |
| `DeliveryReady` | ready（DRAFT → READY，行锁定） | `{ deliveryId, deliveryCode, salesOrderId, readyBy }` | ✅ 已实现（Phase 4 POST /ready） |
| `DeliveryDispatched` | dispatch（READY → DISPATCHED，发运） | `{ deliveryId, deliveryCode, carrier, trackingNo, dispatchedBy }` | ✅ 已实现（Phase 4 POST /dispatch） |
| `DeliveryConfirmed` | confirm-delivery（DISPATCHED → DELIVERED） | `{ deliveryId, deliveryCode, deliveredAt, confirmedBy }` | ✅ 已实现（Phase 4 POST /confirm-delivery） |
| `DeliveryCancelled` | cancel（DRAFT/READY → CANCELLED） | `{ deliveryId, deliveryCode, cancelledBy, reason }` | ✅ 已实现（Phase 4 POST /cancel） |
| `SalesOrderPartiallyDelivered` | Delivery 聚合回写：SO 部分交付（投影） | `{ salesOrderId, salesOrderCode, deliveryId, remainingQty, updatedAt }` | ✅ 已实现（confirm-delivery 聚合联动） |
| `SalesOrderDelivered` | Delivery 聚合回写：SO 全部交付（投影 + deliveredAt） | `{ salesOrderId, salesOrderCode, deliveryId, deliveredAt }` | ✅ 已实现（confirm-delivery 聚合联动） |

> 注：`SalesOrderDeliveryStarted` / `SalesOrderCompleted`（v1.4 注册）——前者由首次 confirm-delivery 联动发布，后者待 Sprint 4D（交付+回款完成）。

#### 2.3.4 发票领域（Sprint 4D 注册，先注册后开发）

> 统一载荷：所有 Invoice 事件 payload 至少包含 `eventId / eventType / occurredAt / actorId / invoiceId / invoiceCode / deliveryId / customerId`（eventId/eventType/occurredAt 由 Event Envelope 提供）。
> 来源：Sprint4D_Invoice_Design.md / ADR-0019；Invoice 是财务事实源（Delivery 为物流事实源，Invoice 为财务事实源）；Invoice 唯一来源 Delivery（禁止 Quotation/SalesOrder 直接开票）；Invoice 永远不重新计算价格（直接复制价格快照，不调用 Pricing Engine）；Payment 属 Sprint 4E，PartiallyPaid/Paid 先注册后实现。

| eventType | 触发时机 | 载荷示例 | 实现状态 |
| --- | --- | --- | --- |
| `InvoiceCreated` | 创建发票（DRAFT，经 POST /api/deliveries/{id}/invoice） | `{ invoiceId, invoiceCode, deliveryId, deliveryCode, customerId, invoiceTotal, createdBy }` | ✅ 已实现（Sprint 4D） |
| `InvoiceIssued` | issue（DRAFT → ISSUED，原子取号 INV-2026-000123） | `{ invoiceId, invoiceCode, issuedAt, issuedBy }` | ✅ 已实现（Sprint 4D） |
| `InvoiceCancelled` | cancel（DRAFT → CANCELLED，释放开票投影） | `{ invoiceId, invoiceCode, cancelledBy, reason }` | ✅ 已实现（Sprint 4D） |
| `InvoicePartiallyPaid` | 4E Receipt 回写（ISSUED → PARTIALLY_PAID） | `{ invoiceId, invoiceCode, paidAmount, balanceAmount, receiptId, updatedAt }` | ⏳ 注册待实现（Sprint 4E） |
| `InvoicePaid` | 4E 收清（→ PAID） | `{ invoiceId, invoiceCode, paidAmount, balanceAmount, receiptId, paidAt }` | ⏳ 注册待实现（Sprint 4E） |

> 注：后两个（PartiallyPaid/Paid）虽 Sprint 4E 才实现，也**先注册**（CTO 启动令：先注册后开发）；Credit Note / Debit Note 事件待 4F/后续评估。

#### 2.3.5 应收领域（Sprint 4E-1 注册，先注册后开发）

> 统一载荷：所有 AR 事件 payload 至少包含 `eventId / eventType / occurredAt / actorId / accountsReceivableId / invoiceId / customerId / currency / balanceAmount`（eventId/eventType/occurredAt 由 Event Envelope 提供）。
> 来源：Sprint4E1_AR_Design.md / ADR-0020；**Invoice = 单据事实源，AccountsReceivable = 余额事实源**（Invoice 上 paidAmount/balanceAmount 仅投影回写）；余额唯一口径 `balanceAmount = originalAmount + adjustedAmount - paidAmount - writeOffAmount`；前端禁止 PATCH 金额，变动由 4E-2 Receipt / 4E-3 CN/DN 动作或下游事实表驱动；OVERDUE 惰性判定（与 EXPIRED 同思路，不新增 Scheduler）。

| eventType | 触发时机 | 载荷示例 | 实现状态 |
| --- | --- | --- | --- |
| `AccountsReceivableCreated` | Invoice ISSUED 后自动创建 AR | `{ accountsReceivableId, invoiceId, invoiceCode, customerId, currency, originalAmount, balanceAmount }` | ⏳ 注册待实现（Sprint 4E-1） |
| `AccountsReceivableUpdated` | 头/状态变更（非金额动作类） | `{ accountsReceivableId, invoiceId, customerId, status, balanceAmount, updatedBy }` | ⏳ 注册待实现（Sprint 4E-1） |
| `AccountsReceivablePartiallyPaid` | 4E-2 部分收款回写（OPEN → PARTIALLY_PAID） | `{ accountsReceivableId, invoiceId, paidAmount, balanceAmount, receiptId, updatedAt }` | ⏳ 注册待实现（Sprint 4E-2） |
| `AccountsReceivablePaid` | 4E-2 收清（→ PAID） | `{ accountsReceivableId, invoiceId, paidAmount, balanceAmount, receiptId, paidAt }` | ⏳ 注册待实现（Sprint 4E-2） |
| `AccountsReceivableOverdue` | 惰性判定 OVERDUE（OPEN/PARTIALLY_PAID + dueDate < now） | `{ accountsReceivableId, invoiceId, customerId, dueDate, balanceAmount, effectiveStatus }` | ⏳ 注册待实现（Sprint 4E-1 投影查询） |
| `AccountsReceivableAdjusted` | 4E-3 CN/DN 聚合调整（adjustedAmount 变更） | `{ accountsReceivableId, invoiceId, adjustedAmount, balanceAmount, sourceNoteId, updatedAt }` | ⏳ 注册待实现（Sprint 4E-3） |
| `AccountsReceivableWrittenOff` | 4E-2 write-off（writeOffAmount 回写） | `{ accountsReceivableId, invoiceId, writeOffAmount, balanceAmount, reason, updatedAt }` | ⏳ 注册待实现（Sprint 4E-2） |

> 注：Created/Updated/Overdue 属 4E-1（查询/投影）；PartiallyPaid/Paid/WrittenOff 属 4E-2（Receipt）；Adjusted 属 4E-3（CN/DN）——全部先注册（CTO 启动令：先注册后开发），事件总线落地前以 AuditLog 留痕。

### 2.4 主数据

| eventType | 触发时机 | 载荷示例 |
| --- | --- | --- |
| `CustomerCreated` | 客户建档（3C-1） | `{ customerId, code, name }` |
| `SupplierCreated` | 供应商建档（3C-2） | `{ supplierId, code, name }` |
| `ItemCreated` | 物料建档（3C-3） | `{ itemId, code, name, itemType }` |
| `ItemUpdated` | 物料更新（3C-3） | `{ itemId, code, changedFields, updatedBy, updatedAt }` |
| `ItemObsoleted` | 物料停产/淘汰（lifecycle → DISCONTINUED/OBSOLETE） | `{ itemId, code, lifecycle, obsoletedBy, obsoletedAt }` |
| `ItemPriceChanged` | 物料成本/价格变更（3C-3 ItemCost） | `{ itemId, code, costType, oldAmount, newAmount, currency, changedBy, changedAt }` |
| `ItemRevisionReleased` | 物料新版本发布（3C-3 ItemRevision） | `{ itemId, code, revisionNo, revision, changeSummary, releasedBy, releasedAt }` |
| `PriceListChanged` | 价格表变更（3C-5） | `{ priceListId, code, priceType }` |

## 3. 订阅方约定

| 订阅方 | 监听事件 | 用途 |
| --- | --- | --- |
| Notification | Workflow*/Quotation*/Invoice* 等 | 发送站内信/邮件/Telegram 通知 |
| Audit/Log | 全部 | 事件日志与链路追踪（traceId 关联） |
| BI | 全部业务事件 | 指标计算与数据仓库增量 |
| Webhook（预留） | 按客户配置 | 外部系统回调 |
| 业务模块 | 上游单据事件 | 触发下游流程（如审批通过 → 生成 SO） |

## 4. 事件总线要求（Sprint 4 前落地）

- 支持：发布/订阅、持久化（至少 once 投递）、重试、死信队列
- 实现候选：PostgreSQL LISTEN/NOTIFY + 表队列（自建轻量）、或 Redis Streams
- 落地方式以新 ADR 决策，禁止在业务代码中硬编码事件分发

## 5. 变更记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-08-08 | v1.9 | Sprint 4E-1 注册 AR 事件 7 个（Created/Updated/PartiallyPaid/Paid/Overdue/Adjusted/WrittenOff，统一载荷含 accountsReceivableId；Invoice=单据事实源，AR=余额事实源；余额唯一口径 original+adjusted-paid-writeOff；Overdue 惰性判定；见 2.3.5）；InvoicePartiallyPaid/InvoicePaid 仍为 4E 待实现 |
| 2026-08-07 | v1.7 | Sprint 4D 注册 Invoice 事件 5 个（Created/Issued/Cancelled + PartiallyPaid/Paid，统一载荷，CTO 启动令：先注册后开发；见 2.3.4）；Invoice 为财务事实源（Delivery 物流事实源 → Invoice 财务事实源），唯一来源 Delivery，不重新定价（直接复制价格快照）；Payment 属 Sprint 4E，PartiallyPaid/Paid 先注册后实现 |
| 2026-08-07 | v1.6 | Sprint 4C 实现状态标注：Delivery 8 事件（Created/Updated/Ready/Dispatched/Confirmed/Cancelled + SalesOrderPartiallyDelivered/SalesOrderDelivered）全部 ✅ 已发布（Phase 3 CRUD/Lines + Phase 4 lifecycle/aggregation）；2.3.2 SalesOrderDelivered 同步标注 |
| 2026-08-07 | v1.5 | Sprint 4C 注册 Delivery 事件 8 个（Created/Updated/Ready/Dispatched/Confirmed/Cancelled + SalesOrderPartiallyDelivered/SalesOrderDelivered，统一载荷，CTO 决策：先注册后开发；见 2.3.3）；Delivery 为交付事实源，SalesOrder 聚合投影事件联动发布 |
| 2026-08-07 | v1.4 | Sprint 4B 注册 SalesOrder 事件 7 个（Created/Updated/Confirmed/Cancelled/DeliveryStarted/Delivered/Completed，统一载荷，CTO 决策：先注册后开发；见 2.3.2）；SalesOrderCreated 占位升级为统一载荷 |
| 2026-08-07 | v1.3 | Sprint 4A 实现状态标注：11 个 Quotation 事件中已发布 7 个（Created/Updated/Submitted/Approved/Rejected/Accepted/Cancelled），4 个注册待实现（RevisionCreated/Sent/Expired/Converted，见 2.3.1 表格）；事件总线落地前以 AuditLog 留痕 |
| 2026-08-07 | v1.2 | Sprint 4A 注册完整 Quotation 事件 11 个（Created/Updated/RevisionCreated/Submitted/Approved/Rejected/Sent/Expired/Accepted/Converted/Cancelled，统一载荷，CTO 决策：先注册后开发） |
| 2026-08-06 | v1.1 | 追加 Item Master 事件（ItemCreated/ItemUpdated/ItemObsoleted/ItemPriceChanged/ItemRevisionReleased，CTO #2075） |
| 2026-08-05 | v1.0 | 初始注册（项目/工作流/业务单据/主数据事件） |
