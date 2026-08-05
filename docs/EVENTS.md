# EVENTS 领域事件注册表（Domain Events）

- 版本：v1.0
- 日期：2026-08-05
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
| `ProjectStageChanged` | 项目阶段变更 | `{ projectId, fromStage, toStage }` |
| `ProjectMilestoneCompleted` | 里程碑完成 | `{ projectId, milestoneId, name }` |
| `ProjectClosed` | 项目结项 | `{ projectId, closedAt, reason }` |

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
| `QuotationSubmitted` | 报价单提交审批 | `{ quotationId, code, customerId, amount }` |
| `QuotationApproved` | 报价单审批通过 | `{ quotationId, code, amount }` |
| `SalesOrderCreated` | 销售订单创建 | `{ orderId, code, customerId, amount }` |
| `InvoiceCreated` | 发票创建 | `{ invoiceId, code, customerId, amount }` |
| `InvoicePaid` | 收款核销 | `{ invoiceId, paymentId, amount }` |
| `PurchaseCompleted` | 采购完成（GRN 收料） | `{ poId, grnId, supplierId }` |
| `ExpenseApproved` | 费用报销审批通过 | `{ expenseId, amount, approverId }` |

### 2.4 主数据

| eventType | 触发时机 | 载荷示例 |
| --- | --- | --- |
| `CustomerCreated` | 客户建档（3C-1） | `{ customerId, code, name }` |
| `SupplierCreated` | 供应商建档（3C-2） | `{ supplierId, code, name }` |
| `ItemCreated` | 物料建档（3C-3） | `{ itemId, code, name, itemType }` |
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
| 2026-08-05 | v1.0 | 初始注册（项目/工作流/业务单据/主数据事件） |
