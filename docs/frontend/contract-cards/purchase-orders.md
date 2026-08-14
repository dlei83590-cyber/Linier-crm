# Contract Card — 采购订单

- 模块：`purchase-orders`（采购管理 · 采购订单）
- 判定：**迁移**（Backend FINAL + Frontend Existing）
- 归属 Wave：F2-3
- Backend Contract：list / detail / create / edit / workflow / factActions（事实基线：apps/web/src/app/api 实际路由）
- Current Frontend：list / detail / ~create / ~edit / ~workflow / ~factActions（事实基线：apps/web/src/app/(dashboard) 实际页面；Tier 2/3 HARD HOLD）

## API（事实来源：apps/web/src/app/api 实际路由）

| 能力    | 端点                                | 方法  | 说明                             |
| ------- | ----------------------------------- | ----- | -------------------------------- |
| List    | `/api/purchase-orders`              | GET   | 分页/筛选                        |
| Detail  | `/api/purchase-orders/{id}`         | GET   | —                                |
| Create  | `/api/purchase-orders`              | POST  | Direct / Convert 双入口          |
| Edit    | `/api/purchase-orders/{id}`         | PATCH | CAS version（仅 DRAFT）          |
| Actions | `/api/purchase-orders/{id}/submit`  | POST  | 提交（workflow）                 |
| Actions | `/api/purchase-orders/{id}/confirm` | POST  | 确认（**APPROVED ≠ CONFIRMED**） |
| Actions | `/api/purchase-orders/{id}/cancel`  | POST  | 取消（DRAFT/APPROVED）           |

## Permission

- `purchase-order:view` / `:create` / `:edit`（动作级权限已 seed）

## Status Machine

- DRAFT → SUBMITTED → APPROVED → CONFIRMED → PARTIALLY_RECEIVED → RECEIVED；终态 CANCELLED
- 前端只做映射表（State_Action_Matrix），不发明规则

## Selectors

- Supplier、Item、UOM（`/api/unit-of-measures`）、Warehouse（`/api/warehouses`）、Requisition（convert 来源）

## Error Codes

- 409：version 冲突 / 状态不允许动作

## Frontend Current State（ui 层事实，2026-08-14）

| 能力              | 状态                     |
| ----------------- | ------------------------ |
| List              | ✅（列表页已在 main）    |
| Detail            | ✅（详情页已在 main）    |
| Create            | ⏸️ new 页面未入 main     |
| Edit              | ⏸️ edit 页面未入 main    |
| Submit / Workflow | HOLD（Tier 2 HARD HOLD） |
| Fact Actions      | HOLD（Tier 3 HARD HOLD） |

## Current UI

- 成熟列表页 + 详情页（真实 API 消费，非占位）

## Gap

- 接入统一 Workspace（EntityListWorkspace / EntityDetailWorkspace / EntityFormWorkspace / StatusBadge / ErrorPanel / ReferenceSelector / LineEditor）
- 保留现有业务逻辑；Create/Edit 从旧 PR #38 选择性吸收
