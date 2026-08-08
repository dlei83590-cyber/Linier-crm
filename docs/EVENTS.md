# EVENTS 领域事件注册表（Domain Events）

- 版本：v1.12
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
| `AccountsReceivableClosed` | 余额=0 且生命周期结束 → CLOSED（CTO Review 追加） | `{ accountsReceivableId, invoiceId, customerId, balanceAmount, closedAt, closedBy, reason }` | ⏳ 注册待实现（Sprint 4E-1/4E-2） |

> 注：Created/Updated/Overdue 属 4E-1（查询/投影）；PartiallyPaid/Paid/WrittenOff 属 4E-2（Receipt）；Adjusted 属 4E-3（CN/DN）——全部先注册（CTO 启动令：先注册后开发），事件总线落地前以 AuditLog 留痕。
> **CTO Review 追加（97/100 APPROVED WITH CHANGES）**：新增 `AccountsReceivableClosed`（余额=0 且生命周期结束可 Closed；否则 OPEN/PAID 只是余额状态）；AR 事件共 8 个。

#### 2.3.6 收款/核销领域（Sprint 4E-2 注册，先注册后开发）

> 来源：Sprint4E2_ReceiptAllocation_Design.md / ADR-0021；**Receipt = 收款事实源，AccountsReceivable = 余额事实源（唯一）**（Payment 不单独建表——CTO 拍板，避免两个重复入账事实）；**创建与核销分离**（拍板①：POST /api/receipts 只记录金额不核销，allocate 显式动作且一次请求原子化）；核销 M:N（Receipt ↔ AR，ReceiptAllocation 中间表）；核销锁 AR（ID ASC + FOR UPDATE）；`allocatedAmount ≤ AR.balanceAmount` 并发下成立（409）；**同 Customer + 同 Currency 才允许 Allocation**（409，第一版禁止跨币种核销）；**Allocation/Receipt Reversal 属 4E-2，CN 属 4E-3 发票调整域不承担收款冲销**（银行退票不是 CN）；**WriteOff 独立事实 + WriteOffAllocation**（不做三件套，Workflow 管审批、AuditLog 管审计；不 PATCH AR.writeOffAmount，APPLIED 才回写）；普通 Receipt 不审批，WriteOff 按 ApprovalPolicy 条件触发 Workflow（审批完成前禁止改 AR.writeOffAmount）；Receipt/WriteOff 编号 DocumentSequence 创建即取号（拍板④）。

| eventType | 触发时机 | 载荷示例 | 实现状态 |
| --- | --- | --- | --- |
| `ReceiptCreated` | 创建收款单（只记录金额，不核销——拍板①） | `{ receiptId, receiptCode, customerId, currency, amount, receiptDate, paymentMethod }` | ✅ 已实现（4E-2，`d076e3a`） |
| `ReceiptUpdated` | 收款单头信息变更（非金额动作类） | `{ receiptId, receiptCode, changedFields, updatedBy, updatedAt }` | ⏳ 注册待实现（无 PATCH 端点，金额/状态受控投影） |
| `ReceiptAllocated` | 核销完成（AR.paidAmount 回写 + Invoice 投影回写） | `{ receiptId, receiptCode, accountsReceivableId, allocatedAmount, paidAmount, balanceAmount }` | ✅ 已实现（4E-2，`c075dde`+`0440cd8`） |
| `ReceiptFullyAllocated` | 全部核销完成（unallocatedAmount = 0） | `{ receiptId, receiptCode, allocatedAmount, unallocatedAmount, fullyAllocatedAt }` | ✅ 已实现（4E-2，`c075dde`） |
| `ReceiptAllocationReversed` | Allocation Reversal（解除核销，回退 AR/Invoice/Receipt 投影；CTO Design Review 新锁定边界） | `{ receiptAllocationId, receiptId, accountsReceivableId, reversedAmount, paidAmount, balanceAmount, reversedBy, reversedAt, reason }` | ✅ 已实现（4E-2，`68d697c`+`2353c8f`） |
| `ReceiptVoided` | 作废（仅未核销可 VOID；已核销先 Reversal 再处理，CN 不承担收款冲销） | `{ receiptId, receiptCode, voidedBy, voidedAt, reason }` | ✅ 已实现（4E-2，`68d697c`） |
| `WriteOffCreated` | 创建写销单（DRAFT） | `{ writeOffId, writeOffCode, accountsReceivableId, amount, reason, writeOffDate }` | ✅ 已实现（4E-2，`35bde4e`+`4a89268`） |
| `WriteOffSubmitted` | 提交审批（有策略时触发 Workflow） | `{ writeOffId, workflowInstanceId, submittedBy, submittedAt }` | ✅ 已实现（4E-2，`4a89268`） |
| `WriteOffApproved` | 审批通过（Workflow 回调） | `{ writeOffId, workflowInstanceId, approvedBy, approvedAt }` | ✅ 已实现（4E-2，`aabedf2` workflow actions） |
| `WriteOffRejected` | 审批驳回（→ DRAFT 重提） | `{ writeOffId, workflowInstanceId, rejectedBy, rejectedAt, reason }` | ✅ 已实现（4E-2，`aabedf2` workflow actions） |
| `WriteOffApplied` | APPLIED（AR.writeOffAmount 回写 + 投影回写；余额=0 且生命周期结束 → AR CLOSED） | `{ writeOffId, accountsReceivableId, writeOffAmount, balanceAmount, appliedBy, appliedAt }` | ✅ 已实现（4E-2，`224624d`） |

> 注：`AccountsReceivablePartiallyPaid / Paid / WrittenOff / Closed`（v1.9 已注册）与 `InvoicePartiallyPaid / InvoicePaid`（4D 已注册）在 4E-2 实现时联动发布，不重复注册。

#### 2.3.7 发票调整领域（Sprint 4E-3 注册，先注册后开发）

> 来源：Sprint4E3_CreditDebitNote_Design.md / ADR-0022；**CN/DN = Invoice Adjustment 事实源**；**不修改原 Invoice 金额事实**（invoiceTotal/subtotal/taxAmount/行快照一律不动）；**不承担 Receipt/Allocation Reversal**（收款冲销仍属 4E-2）；**AR.adjustedAmount 是聚合结果，不允许 PATCH**（唯一入口：InvoiceAdjustment Apply 事务）；**Credit Note 负向调整 AR、Debit Note 正向调整 AR**；所有 adjustment 必须能追溯到 `sourceInvoiceId / sourceInvoiceLineId`；**已有付款允许 CN，按当前 AR.balance 与 adjustedAmount 规则处理，不回滚 Receipt**；已支付完再开 CN 形成的负余额（可退/可抵）在设计阶段明确（第一版负 AR 余额投影，CustomerCredit 延后）；核心模型 CreditDebitNote + CreditDebitNoteLine + InvoiceAdjustment（事实中间层）。

| eventType | 触发时机 | 载荷示例 | 实现状态 |
| --- | --- | --- | --- |
| `CreditDebitNoteCreated` | 创建调整单（DRAFT；CN-/DN-2026-xxxx 创建即取号） | `{ noteId, noteCode, noteType, sourceInvoiceId, customerId, currency, adjustmentTotal, reason }` | ⏳ 注册待实现（Sprint 4E-3） |
| `CreditDebitNoteSubmitted` | 提交审批（命中策略触发 Workflow） | `{ noteId, workflowInstanceId, submittedBy, submittedAt }` | ⏳ 注册待实现（Sprint 4E-3） |
| `CreditDebitNoteApproved` | 审批通过（Workflow 回调，投影回写） | `{ noteId, workflowInstanceId, approvedBy, approvedAt }` | ⏳ 注册待实现（Sprint 4E-3） |
| `CreditDebitNoteRejected` | 审批驳回（→ DRAFT 重提） | `{ noteId, workflowInstanceId, rejectedBy, rejectedAt, reason }` | ⏳ 注册待实现（Sprint 4E-3） |
| `InvoiceAdjustmentApplied` | **Apply 完成（AR.adjustedAmount 聚合回写；APPROVED ≠ APPLIED）** | `{ adjustmentId, noteId, noteCode, invoiceId, invoiceLineId, accountsReceivableId, adjustmentType, amount, adjustedAmount, balanceAmount, appliedBy, appliedAt }` | ⏳ 注册待实现（Sprint 4E-3） |

> 注：**Apply 成功时同时发布 `InvoiceAdjustmentApplied` + `AccountsReceivableAdjusted`**（后者 v1.9 已注册，复用不重复定义——CTO 98/100 拍板）；`InvoicePartiallyPaid/Paid`（4D 注册）与 4E-2 已实现事件不重复注册。

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
| 2026-08-08 | v1.12 | Sprint 4E-3 注册发票调整领域事件 5 个（CreditDebitNoteCreated/Submitted/Approved/Rejected + InvoiceAdjustmentApplied，统一载荷含 noteId/noteCode/noteType/sourceInvoiceId/invoiceId/accountsReceivableId/adjustmentType/amount/adjustedAmount；**CN/DN = Invoice Adjustment 事实源**；不修改原 Invoice 金额事实；不承担 Receipt/Allocation Reversal；AR.adjustedAmount 聚合结果禁 PATCH（唯一入口 InvoiceAdjustment Apply）；CN 负向/DN 正向调整 AR；全部调整可溯源 sourceInvoiceId/sourceInvoiceLineId；已有付款允许 CN 不回滚 Receipt；负余额（可退/可抵）第一版负 AR 投影、CustomerCredit 延后；见 2.3.7，ADR-0022）；AccountsReceivableAdjusted（v1.9 已注册）4E-3 实现时联动发布 |
| 2026-08-08 | v1.11 | Sprint 4E-2 收款/核销/写销事件全部实现（ReceiptCreated/ReceiptAllocated/ReceiptFullyAllocated/ReceiptAllocationReversed/ReceiptVoided + WriteOffCreated/WriteOffSubmitted/WriteOffApproved/WriteOffRejected/WriteOffApplied 共 10 个 ✅，ReceiptUpdated 无 PATCH 端点保留注册；统一载荷含 receiptId/writeOffId/customerId/currency/amount/accountsReceivableIds 基境字段）；实现提交链：Receipt Create `d076e3a` / Allocation `c075dde`+`0440cd8` / Reversal-Void `68d697c`+`2353c8f` / WriteOff 三件套 `35bde4e`+`3b44ed0` / Create-Submit `4a89268`+`68fbe53` / Apply `224624d` / Workflow actions `aabedf2`（businessType=write-off 终态回写）；AR PartiallyPaid/Paid/WrittenOff/Closed 与 Invoice 投影事件联动发布（AuditLog 留痕，事件总线落地前）；PR #17 Ready for Final Review |
| 2026-08-08 | v1.9 | Sprint 4E-1 注册 AR 事件 8 个（Created/Updated/PartiallyPaid/Paid/Overdue/Adjusted/WrittenOff/**Closed**，统一载荷含 accountsReceivableId；Invoice=单据事实源，AR=余额事实源；余额唯一口径 original+adjusted-paid-writeOff；Overdue 惰性判定；Closed 为 CTO Review 97/100 追加；见 2.3.5）；InvoicePartiallyPaid/InvoicePaid 仍为 4E 待实现 |
| 2026-08-07 | v1.7 | Sprint 4D 注册 Invoice 事件 5 个（Created/Issued/Cancelled + PartiallyPaid/Paid，统一载荷，CTO 启动令：先注册后开发；见 2.3.4）；Invoice 为财务事实源（Delivery 物流事实源 → Invoice 财务事实源），唯一来源 Delivery，不重新定价（直接复制价格快照）；Payment 属 Sprint 4E，PartiallyPaid/Paid 先注册后实现 |
| 2026-08-07 | v1.6 | Sprint 4C 实现状态标注：Delivery 8 事件（Created/Updated/Ready/Dispatched/Confirmed/Cancelled + SalesOrderPartiallyDelivered/SalesOrderDelivered）全部 ✅ 已发布（Phase 3 CRUD/Lines + Phase 4 lifecycle/aggregation）；2.3.2 SalesOrderDelivered 同步标注 |
| 2026-08-07 | v1.5 | Sprint 4C 注册 Delivery 事件 8 个（Created/Updated/Ready/Dispatched/Confirmed/Cancelled + SalesOrderPartiallyDelivered/SalesOrderDelivered，统一载荷，CTO 决策：先注册后开发；见 2.3.3）；Delivery 为交付事实源，SalesOrder 聚合投影事件联动发布 |
| 2026-08-07 | v1.4 | Sprint 4B 注册 SalesOrder 事件 7 个（Created/Updated/Confirmed/Cancelled/DeliveryStarted/Delivered/Completed，统一载荷，CTO 决策：先注册后开发；见 2.3.2）；SalesOrderCreated 占位升级为统一载荷 |
| 2026-08-07 | v1.3 | Sprint 4A 实现状态标注：11 个 Quotation 事件中已发布 7 个（Created/Updated/Submitted/Approved/Rejected/Accepted/Cancelled），4 个注册待实现（RevisionCreated/Sent/Expired/Converted，见 2.3.1 表格）；事件总线落地前以 AuditLog 留痕 |
| 2026-08-07 | v1.2 | Sprint 4A 注册完整 Quotation 事件 11 个（Created/Updated/RevisionCreated/Submitted/Approved/Rejected/Sent/Expired/Accepted/Converted/Cancelled，统一载荷，CTO 决策：先注册后开发） |
| 2026-08-06 | v1.1 | 追加 Item Master 事件（ItemCreated/ItemUpdated/ItemObsoleted/ItemPriceChanged/ItemRevisionReleased，CTO #2075） |
| 2026-08-05 | v1.0 | 初始注册（项目/工作流/业务单据/主数据事件） |
