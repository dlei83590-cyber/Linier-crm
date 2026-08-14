# Contract Card — 贷项/借项通知单

- 模块：`credit-debit-notes`（销售管理 · 贷项/借项通知单）
- 判定：**可开发**（Backend FINAL + Frontend Missing）
- 归属 Wave：F2-5
- 能力（Registry）：list / detail / create / edit / workflow / factActions

## API（事实来源：apps/web/src/app/api 实际路由）

| 能力    | 端点                                  | 方法  | 说明                  |
| ------- | ------------------------------------- | ----- | --------------------- |
| List    | `/api/credit-debit-notes`             | GET   | 分页/筛选             |
| Detail  | `/api/credit-debit-notes/{id}`        | GET   | —                     |
| Create  | `/api/credit-debit-notes`             | POST  | —                     |
| Edit    | `/api/credit-debit-notes/{id}`        | PATCH | CAS version           |
| Actions | `/api/credit-debit-notes/{id}/submit` | POST  | 提交（workflow）      |
| Actions | `/api/credit-debit-notes/{id}/apply`  | POST  | 应用到 AR（事实动作） |

## Permission

- `credit-debit-note:view` / `:create` / `:edit`（动作级权限已 seed）

> ⚠️ 本权限对应**销售侧** AR CN/DN；供应商侧 CN/DN（supplier-cn-dn）为 5C-2 HOLD，禁止复用。

## Status Machine

- DRAFT → SUBMITTED → APPLIED（冲减 AR）；终态 CANCELLED（以 OpenAPI 为准）

## Selectors

- Invoice（`/api/invoices`）、Customer

## Error Codes

- 409：状态不允许 apply / version 冲突

## Current UI

- 占位页（PlaceholderPage「尚未开放」）

## Gap

- List/Detail/Create/Edit/submit/apply 全部缺失 → F2-5 分阶段开放
