# Sprint 4 预备：Quote Workflow（报价审批流程，仅设计不写代码）

> 状态：Design（Sprint 4 Sales 提前准备）
> 关联：Sprint4_Quote_Domain.md / Sprint4_Quote_ERD.md / Sprint4_Quote_API.md
> 平台：Workflow/Approval（Sprint 3A 已交付，`QUOTATION_APPROVAL` 工作流种子已存在）

## 1. 审批流程设计

```
DRAFT ──submit──> SUBMITTED ──审批──> APPROVED ──convert──> CONVERTED
                       │                    │
                       └──reject──> REJECTED（可编辑重提）
```

### 1.1 提交（Submit）
- 校验：status=DRAFT、至少 1 行、客户有效、未过期
- 行为：
  1. 生成单据编号（DocumentSequence：`QT-YYYY-`）
  2. 创建 **Workflow Instance**（definition=QUOTATION_APPROVAL，entityType=quotation，entityId=quotation.id）
  3. 状态 → SUBMITTED
  4. 发布 **QuotationSubmitted** 事件（EVENTS.md payload：quotationId/code/customerId/total/currency/submittedBy/submittedAt）

### 1.2 审批步骤（复用 Sprint 3A Workflow 定义）

QUOTATION_APPROVAL 工作流（Sprint 3A seed 已建，定义示例）：

| Step | 类型 | 审批人 | 规则 |
| --- | --- | --- | --- |
| 1 | Approver Group | DIRECTORS（董事） | 金额 ≤ 50,000 单签通过 |
| 2 | Approver Group | FINANCE（财务） | 金额 > 50,000 需财务会签（COUNTERSIGN） |
| 3 | Final | DIRECTORS | 总金额 > 200,000 需董事终审 |

- 条件（WorkflowCondition）：基于 `quotation.total` 判断分支（Sprint 3A Condition 引擎）
- 每步动作通过 `QuotationApproval` 记录留痕（stepName/approverId/action/comment/actedAt）

### 1.3 审批动作（复用 Workflow Instance actions）

| 动作 | 说明 | 结果 |
| --- | --- | --- |
| APPROVE | 通过当前步骤 | 全部通过 → 状态 APPROVED |
| REJECT | 驳回 | 状态 REJECTED，可编辑重提 |
| COUNTERSIGN | 会签（需 N 人，未配置人数保守全签） | 累计满足后通过 |

- API 复用：`POST /api/workflows/instances/:id/actions`（Sprint 3A 已交付）
- 报价模块 `QuotationApproval` 作为留痕视图（workflowInstanceId 关联）

### 1.4 审批通过后（事件驱动，不模块间直接调用）

| 事件 | 监听方 | 动作 |
| --- | --- | --- |
| QuotationSubmitted | Notification | 通知审批人（notification-templates 复用） |
| QuotationSubmitted | BI | 报价漏斗统计（dashboard-kpi 更新源） |
| QuotationApproved（新增事件，Sprint 4 补充） | Notification | 通知销售员 |
| QuotationApproved | Webhook | 推送外部系统（可选） |

## 2. 状态与事件对照

| 状态 | 触发 | 事件 |
| --- | --- | --- |
| DRAFT | create | — |
| SUBMITTED | submit | QuotationSubmitted |
| APPROVED | 审批全部通过 | QuotationApproved（Sprint 4 补充定义） |
| REJECTED | 任一步驳回 | QuotationRejected（Sprint 4 补充定义） |
| CONVERTED | convert 转订单 | QuotationConverted（Sprint 4 补充定义） |
| CANCELLED | cancel | — |
| EXPIRED | 定时任务（validUntil 过） | — |

## 3. 验收要点（Sprint 4 开发时）

1. 审批流不写在报价模块内，全部走 Workflow/Approval 平台（架构冻结）
2. 报价模块只维护状态机 + QuotationApproval 留痕 + 事件发布
3. 提交/审批幂等（Idempotency-Key，API_GUIDELINES）
4. 所有状态变更写 AuditLog（requestMeta 完整审计）

## 4. Approval Policy（CTO #2138：Policy 选择流程，Workflow 执行）

- 报价提交时：按 `total` 金额匹配 ApprovalPolicy（minAmount ≤ total < maxAmount）。
- 匹配结果决定工作流实例：approverLevel（主管/经理/总经理）+ workflowDefinitionCode。
- 金额变更 → 重新匹配 Policy，历史审批仍按原快照（QuotationSnapshot）追溯。
- Policy 示例：<5000 主管 / 5000~50000 经理 / >50000 总经理（可配置）。
