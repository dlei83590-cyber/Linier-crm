# Contract Card — 销售订单

- 模块：`sales-orders`（销售管理 · 销售订单）
- 判定：**可开发**（Backend FINAL + Frontend Missing）
- 归属 Wave：F2-5
- Backend Contract：list / detail / create / edit / ~workflow / factActions（事实基线：apps/web/src/app/api 实际路由）
- Current Frontend：~list / ~detail / ~create / ~edit / ~workflow / ~factActions（事实基线：apps/web/src/app/(dashboard) 实际页面；Tier 2/3 HARD HOLD）

## API（事实来源：apps/web/src/app/api 实际路由）

| 能力    | 端点                                                                      | 方法  | 说明              |
| ------- | ------------------------------------------------------------------------- | ----- | ----------------- |
| List    | `/api/sales-orders`                                                       | GET   | 分页/筛选         |
| Detail  | `/api/sales-orders/{id}`                                                  | GET   | —                 |
| Create  | `/api/sales-orders`                                                       | POST  | —                 |
| Edit    | `/api/sales-orders/{id}`                                                  | PATCH | CAS version       |
| Actions | `/api/sales-orders/{id}/confirm`                                          | POST  | 确认（事实动作）  |
| Actions | `/api/sales-orders/{id}/cancel`                                           | POST  | 取消              |
| Sub     | `/api/sales-orders/{id}/lines`、`/deliveries`、`/revisions`、`/snapshots` | GET   | 行/送货/版本/快照 |

## Permission

- `sales-order:view` / `:create` / `:edit`（动作级权限已 seed）

## Status Machine

- DRAFT → CONFIRMED →（送货链）→ 完成；终态 CANCELLED
- 以 OpenAPI / 后端为准，前端只做映射表

## Selectors

- Customer、Item、UOM、Quotation（convert 来源）

## Error Codes

- 409：version 冲突 / 状态不允许动作

## Frontend Current State（ui 层事实，2026-08-14）

| 能力              | 状态                           |
| ----------------- | ------------------------------ |
| List              | ⏸️ 未开放（占位页/入口未开放） |
| Detail            | ⏸️ 未开放（占位页/入口未开放） |
| Create            | ⏸️ new 页面未入 main           |
| Edit              | ⏸️ edit 页面未入 main          |
| Submit / Workflow | HOLD（Tier 2 HARD HOLD）       |
| Fact Actions      | HOLD（Tier 3 HARD HOLD）       |

## Current UI

- 占位页（PlaceholderPage「尚未开放」）

## Gap

- List/Detail/Create/Edit/confirm/cancel 全部缺失 → F2-5 分阶段开放
