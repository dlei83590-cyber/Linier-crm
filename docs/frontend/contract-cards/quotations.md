# Contract Card — 报价单

- 模块：`quotations`（销售管理 · 报价单）
- 判定：**可开发**（Backend FINAL + Frontend Missing）
- 归属 Wave：F2-5
- 能力（Registry）：list / detail / create / edit / workflow / factActions

## API（事实来源：apps/web/src/app/api 实际路由）

| 能力    | 端点                                                     | 方法  | 说明                    |
| ------- | -------------------------------------------------------- | ----- | ----------------------- |
| List    | `/api/quotations`                                        | GET   | 分页/筛选               |
| Detail  | `/api/quotations/{id}`                                   | GET   | —                       |
| Create  | `/api/quotations`                                        | POST  | —                       |
| Edit    | `/api/quotations/{id}`                                   | PATCH | CAS version（仅 DRAFT） |
| Actions | `/api/quotations/{id}/submit`                            | POST  | 提交（workflow）        |
| Actions | `/api/quotations/{id}/accept`                            | POST  | 客户接受（事实动作）    |
| Actions | `/api/quotations/{id}/convert`                           | POST  | 转销售订单（事实动作）  |
| Actions | `/api/quotations/{id}/cancel`                            | POST  | 取消                    |
| Sub     | `/api/quotations/{id}/lines`、`/revisions`、`/snapshots` | GET   | 行/版本/快照            |

## Permission

- `quotation:view` / `:create` / `:edit`（动作级权限已 seed）

## Status Machine

- DRAFT → SUBMITTED（审批）→ APPROVED → CONVERTED（转 SO）；终态 CANCELLED
- 前端只做映射表（State_Action_Matrix），不发明规则

## Selectors

- Customer（`/api/customers`）、Item（`/api/items`）、UOM（`/api/unit-of-measures`）

## Error Codes

- 409：version 冲突 / 状态不允许动作
- 400：校验错误（行数据）

## Current UI

- 占位页（PlaceholderPage「尚未开放」）

## Gap

- List/Detail/Create/Edit/Workflow/Fact Actions 全部缺失 → F2-5 按
  List/Detail → Create/Edit → Workflow → Fact Actions 分阶段开放
