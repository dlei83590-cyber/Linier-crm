# Contract Card — 销售发票

- 模块：`sales-invoices`（销售管理 · 销售发票）
- 判定：**可开发**（Backend FINAL + Frontend Missing）
- 归属 Wave：F2-5
- 能力（Registry）：list / detail / create / edit / factActions（workflow 无）

## API（事实来源：apps/web/src/app/api 实际路由）

| 能力    | 端点                                                   | 方法  | 说明                      |
| ------- | ------------------------------------------------------ | ----- | ------------------------- |
| List    | `/api/invoices`                                        | GET   | 分页/筛选                 |
| Detail  | `/api/invoices/{id}`                                   | GET   | —                         |
| Create  | `/api/invoices`                                        | POST  | —                         |
| Edit    | `/api/invoices/{id}`                                   | PATCH | CAS version               |
| Actions | `/api/invoices/{id}/issue`                             | POST  | 开票（事实动作，AR 形成） |
| Actions | `/api/invoices/{id}/cancel`                            | POST  | 取消                      |
| Sub     | `/api/invoices/{id}/lines`、`/revisions`、`/snapshots` | GET   | 行/版本/快照              |

## Permission

- `invoice:view` / `:create` / `:edit`（动作级权限已 seed）

## Status Machine

- DRAFT → ISSUED（形成 AR）→ 收款核销；终态 CANCELLED（以 OpenAPI 为准）

## Selectors

- Delivery（`/api/deliveries`，开票来源）、Customer、Item

## Error Codes

- 409：version 冲突 / 状态不允许动作
- 400：行校验错误

## Current UI

- 占位页（PlaceholderPage「尚未开放」）

## Gap

- List/Detail/Create/Edit/issue/cancel 全部缺失 → F2-5 分阶段开放
