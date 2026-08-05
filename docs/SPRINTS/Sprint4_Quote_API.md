# Sprint 4 预备：Quote API（报价 API 设计，仅设计不写代码）

> 状态：Design（Sprint 4 Sales 提前准备）
> 关联：Sprint4_Quote_Domain.md / Sprint4_Quote_ERD.md / Sprint4_Quote_Workflow.md
> 规范：API_GUIDELINES.md（分页/过滤/错误码/Headers/Idempotency）、ERROR_CODES.md、EVENTS.md

## 1. 端点清单

### 1.1 Quotation 主档（权限码 quotation:*）

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | /api/quotations | quotation:view | 分页 + 过滤（code/customerId/status/dateFrom/dateTo） |
| POST | /api/quotations | quotation:create | 创建草稿（Header + Lines 同事务提交） |
| GET | /api/quotations/:id | quotation:view | 详情（含 lines/revisions/approvals + customer + attachments） |
| PATCH | /api/quotations/:id | quotation:edit | 更新（乐观锁 version；仅 DRAFT/REJECTED 可改） |
| DELETE | /api/quotations/:id | quotation:delete | 软删除（仅 DRAFT；级联 lines/revisions/approvals） |
| POST | /api/quotations/:id/submit | quotation:submit | 提交审批 → 状态 SUBMITTED → 发布 QuotationSubmitted 事件 |
| POST | /api/quotations/:id/convert | quotation:convert | 转销售订单（状态 CONVERTED，Sprint 4 后期） |
| POST | /api/quotations/:id/cancel | quotation:cancel | 取消（状态 CANCELLED） |

### 1.2 Quotation 行（quotation-line:*）

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | /api/quotations/:id/lines | quotation-line:view | 行列表 |
| POST | /api/quotations/:id/lines | quotation-line:create | 新增行（自动重算合计） |
| PATCH | /api/quotations/:id/lines/:lineId | quotation-line:edit | 更新行（乐观锁；重算合计） |
| DELETE | /api/quotations/:id/lines/:lineId | quotation-line:delete | 软删行（lineStatus=REMOVED，保留历史） |

### 1.3 Quotation 修订（quotation-revision:*）

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | /api/quotations/:id/revisions | quotation-revision:view | 修订历史列表（revisionNo desc） |
| GET | /api/quotations/:id/revisions/:revisionId | quotation-revision:view | 修订详情（含 snapshot） |

### 1.4 Quotation 审批（quotation-approval:*）

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | /api/quotations/:id/approvals | quotation-approval:view | 审批记录列表 |
| POST | /api/quotations/:id/approvals | quotation-approval:create | 审批动作（APPROVE/REJECT/COUNTERSIGN，对接 Workflow Instance actions） |

> 审批动作也可直接复用 Sprint 3A `/api/workflows/instances/:id/actions`（QuotationApproval 作为留痕视图，workflowInstanceId 关联）。

## 2. 关键请求/响应示例

### POST /api/quotations（创建，Header + Lines 事务）

```json
{
  "customerId": "cus_xxx",
  "opportunityId": "opp_xxx",
  "validUntil": "2026-08-31T00:00:00Z",
  "currency": "CNY",
  "remark": "含税报价",
  "lines": [
    {
      "itemId": "item_xxx",
      "itemCode": "LG-100",
      "itemName": "线性导轨 LG-100",
      "spec": "H25",
      "uom": "PCS",
      "qty": 10,
      "unitPrice": 1250.00,
      "discountRate": 5
    }
  ]
}
```

响应 `201`：`{success:true, data:{id, code:"QT-2026-0001", status:"DRAFT", subtotal, taxAmount, total, version:1}}`

### POST /api/quotations/:id/submit

```json
{ "workflowDefinitionCode": "QUOTATION_APPROVAL" }
```

- 校验：status=DRAFT、存在 lines、客户有效
- 行为：status→SUBMITTED，创建 Workflow Instance，发布 `QuotationSubmitted`（EVENTS.md payload：quotationId/code/customerId/total/currency/submittedBy/submittedAt）

## 3. 权限模块（待建，Sprint 4）

- quotation / quotation-line / quotation-revision / quotation-approval（4 模块 × 10 动作，MANAGER 全量）
- PERMISSION_MODULES 追加 4 项

## 4. 错误码（ERROR_CODES 追加建议）

| code | 场景 |
| --- | --- |
| QUOTATION_001 | 报价单不存在 |
| QUOTATION_002 | 仅草稿/驳回状态可编辑 |
| QUOTATION_003 | 提交时无行明细 |
| QUOTATION_004 | 报价已过期不可提交 |
| QUOTATION_005 | 已转换订单不可再操作 |
| QUOTATION_006 | 行物料不存在或已停用（3C-3 后启用） |

## 5. 附件（File Center 承接）

- `FileAttachment.businessType=quotation`、`businessId=quotation.id`
- 前端通过既有 `/api/attachments?businessType=quotation&businessId=:id` 查询/上传，报价模块不建附件表。
