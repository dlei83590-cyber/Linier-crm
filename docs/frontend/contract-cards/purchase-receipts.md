# Contract Card — 到货收货

- 模块：`purchase-receipts`（采购管理 · 到货收货）
- 判定：**迁移**（Backend FINAL + Frontend Existing）
- 归属 Wave：F2-3
- 能力（Registry）：list / detail / create / edit / factActions（workflow 无）

## API（事实来源：apps/web/src/app/api 实际路由）

| 能力    | 端点                                  | 方法  | 说明                           |
| ------- | ------------------------------------- | ----- | ------------------------------ |
| List    | `/api/purchase-receipts`              | GET   | 分页/筛选                      |
| Detail  | `/api/purchase-receipts/{id}`         | GET   | —                              |
| Create  | `/api/purchase-receipts`              | POST  | —                              |
| Edit    | `/api/purchase-receipts/{id}`         | PATCH | CAS version（仅 DRAFT）        |
| Actions | `/api/purchase-receipts/{id}/receive` | POST  | 收货（CONFIRMED PO 来源 Gate） |
| Actions | `/api/purchase-receipts/{id}/cancel`  | POST  | 取消                           |

## Permission

- `purchase-receipt:view` / `:create` / `:edit`（动作级权限已 seed）

## Status Machine

- DRAFT → RECEIVED（收货事实已定）；终态 CANCELLED
- 前端只做映射表（State_Action_Matrix），不发明规则

## Selectors

- PO（`/api/purchase-orders`）、Item、Warehouse（`/api/warehouses`）、UOM

## Error Codes

- 409：状态不允许 receive / version 冲突

## Current UI

- 成熟列表页 + 详情页（真实 API 消费，非占位）

## Gap

- 接入统一 Workspace（EntityListWorkspace / EntityDetailWorkspace / EntityFormWorkspace / StatusBadge / ErrorPanel / ReferenceSelector / LineEditor）
- 保留现有业务逻辑；Create/Edit 从旧 PR #38 选择性吸收
