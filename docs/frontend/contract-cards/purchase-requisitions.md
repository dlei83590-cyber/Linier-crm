# Contract Card — 采购申请

- 模块：`purchase-requisitions`（采购管理 · 采购申请）
- 判定：**迁移**（Backend FINAL + Frontend Existing）
- 归属 Wave：F2-3
- 能力（Registry）：list / detail / create / edit / workflow / factActions

## API（事实来源：apps/web/src/app/api 实际路由）

| 能力    | 端点                                      | 方法  | 说明                    |
| ------- | ----------------------------------------- | ----- | ----------------------- |
| List    | `/api/purchase-requisitions`              | GET   | 分页/筛选               |
| Detail  | `/api/purchase-requisitions/{id}`         | GET   | —                       |
| Create  | `/api/purchase-requisitions`              | POST  | 创建即取号              |
| Edit    | `/api/purchase-requisitions/{id}`         | PATCH | CAS version（仅 DRAFT） |
| Actions | `/api/purchase-requisitions/{id}/submit`  | POST  | 提交（workflow）        |
| Actions | `/api/purchase-requisitions/{id}/convert` | POST  | 转采购订单（事实动作）  |

## Permission

- `purchase-requisition:view` / `:create` / `:edit`（动作级权限已 seed）

## Status Machine

- DRAFT → SUBMITTED（审批）→ APPROVED → CONVERTED；终态 REJECTED / CANCELLED
- 前端只做映射表（State_Action_Matrix），不发明规则

## Selectors

- Item（`/api/items`）、Supplier、UOM（`/api/unit-of-measures`）、Department/User（P1）

## Error Codes

- 409：version 冲突 / 状态不允许动作

## Current UI

- 成熟列表页 + 详情页（真实 API 消费，非占位）

## Gap

- 接入统一 Workspace（EntityListWorkspace / EntityDetailWorkspace / EntityFormWorkspace / StatusBadge / ErrorPanel / Selector）
- 保留现有业务逻辑，不推倒重写；Create/Edit 从旧 PR #38 选择性吸收业务逻辑
