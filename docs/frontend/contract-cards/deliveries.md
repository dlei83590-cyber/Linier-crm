# Contract Card — 送货单

- 模块：`deliveries`（销售管理 · 送货单）
- 判定：**可开发**（Backend FINAL + Frontend Missing）
- 归属 Wave：F2-5
- 能力（Registry）：list / detail / create / edit / factActions（workflow 无）

## API（事实来源：apps/web/src/app/api 实际路由）

| 能力    | 端点                                    | 方法  | 说明                 |
| ------- | --------------------------------------- | ----- | -------------------- |
| List    | `/api/deliveries`                       | GET   | 分页/筛选            |
| Detail  | `/api/deliveries/{id}`                  | GET   | —                    |
| Create  | `/api/deliveries`                       | POST  | —                    |
| Edit    | `/api/deliveries/{id}`                  | PATCH | CAS version          |
| Actions | `/api/deliveries/{id}/ready`            | POST  | 备货完成（事实动作） |
| Actions | `/api/deliveries/{id}/dispatch`         | POST  | 发货（事实动作）     |
| Actions | `/api/deliveries/{id}/confirm-delivery` | POST  | 确认送达             |
| Actions | `/api/deliveries/{id}/invoice`          | POST  | 开票（事实动作）     |
| Actions | `/api/deliveries/{id}/cancel`           | POST  | 取消                 |
| Sub     | `/api/deliveries/{id}/lines`            | GET   | 行明细               |

## Permission

- `delivery:view` / `:create` / `:edit`（动作级权限已 seed）

## Status Machine

- 备货 → 发货 → 送达 → 开票链；终态 CANCELLED（以 OpenAPI 为准）

## Selectors

- Sales Order（`/api/sales-orders`）、Customer、Warehouse、Item

## Error Codes

- 409：version 冲突 / 状态不允许动作

## Current UI

- 占位页（PlaceholderPage「尚未开放」）

## Gap

- List/Detail/Create/Edit/动作链 全部缺失 → F2-5 分阶段开放
