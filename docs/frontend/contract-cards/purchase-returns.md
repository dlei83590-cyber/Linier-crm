# Contract Card — 采购退货

- 模块：`purchase-returns`（采购管理 · 采购退货）
- 判定：**迁移**（Backend FINAL + Frontend Existing）
- 归属 Wave：F2-3
- Backend Contract：list / detail / create / edit / ~workflow / factActions（事实基线：apps/web/src/app/api 实际路由）
- Current Frontend：list / detail / create / edit / ~workflow / ~factActions（事实基线：apps/web/src/app/(dashboard) 实际页面；Tier 2/3 HARD HOLD）

## API（事实来源：apps/web/src/app/api 实际路由）

| 能力    | 端点                                | 方法  | 说明                                  |
| ------- | ----------------------------------- | ----- | ------------------------------------- |
| List    | `/api/purchase-returns`             | GET   | 分页/筛选                             |
| Detail  | `/api/purchase-returns/{id}`        | GET   | —                                     |
| Create  | `/api/purchase-returns`             | POST  | 来源可退余额 Gate                     |
| Edit    | `/api/purchase-returns/{id}`        | PATCH | CAS version（仅 DRAFT）               |
| Actions | `/api/purchase-returns/{id}/return` | POST  | 退货（REPLACE_REQUIRED 重开 PO 履约） |

## Permission

- `purchase-return:view` / `:create` / `:edit`（动作级权限已 seed）

## Status Machine

- DRAFT → RETURNED；终态 CANCELLED
- 前端只做映射表（State_Action_Matrix），不发明规则

## Selectors

- Receipt / WHR（来源）、Item、Warehouse、Location

## Error Codes

- 409：可退余额不足 / version 冲突

## Frontend Current State（ui 层事实，2026-08-14）

| 能力              | 状态                     |
| ----------------- | ------------------------ |
| List              | ✅（列表页已在 main）    |
| Detail            | ✅（详情页已在 main）    |
| Create            | ✅（new 页面已在 main）  |
| Edit              | ✅（edit 页面已在 main） |
| Submit / Workflow | HOLD（Tier 2 HARD HOLD） |
| Fact Actions      | HOLD（Tier 3 HARD HOLD） |

## Current UI

- 成熟列表页 + 详情页（真实 API 消费，非占位）

## Gap

- 接入统一 Workspace（EntityListWorkspace / EntityDetailWorkspace / EntityFormWorkspace / StatusBadge / ErrorPanel / ReferenceSelector / LineEditor）
- 保留现有业务逻辑；Create/Edit 从旧 PR #38 选择性吸收
