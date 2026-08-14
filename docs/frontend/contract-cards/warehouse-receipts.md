# Contract Card — 仓库收货

- 模块：`warehouse-receipts`（采购管理 · 仓库收货）
- 判定：**迁移**（Backend FINAL + Frontend Existing）
- 归属 Wave：F2-3
- 能力（Registry）：list / detail / create / edit / factActions（workflow 无）

## API（事实来源：apps/web/src/app/api 实际路由）

| 能力    | 端点                                | 方法  | 说明                                     |
| ------- | ----------------------------------- | ----- | ---------------------------------------- |
| List    | `/api/warehouse-receipts`           | GET   | 分页/筛选                                |
| Detail  | `/api/warehouse-receipts/{id}`      | GET   | —                                        |
| Create  | `/api/warehouse-receipts`           | POST  | —                                        |
| Edit    | `/api/warehouse-receipts/{id}`      | PATCH | CAS version（仅 DRAFT）                  |
| Actions | `/api/warehouse-receipts/{id}/post` | POST  | **过账（触发 6A InventoryMovement IN）** |

## Permission

- `warehouse-receipt:view` / `:create` / `:edit`（动作级权限已 seed）

## Status Machine

- DRAFT → POSTED（库存已入账，终态证据 postedAt/postedById）；终态 CANCELLED
- **Created ≠ Posted**：post 为唯一入账事实动作

## Selectors

- Receipt（`/api/purchase-receipts`）、Inspection（`/api/inspections`）、Warehouse（`/api/warehouses`）、Location（`/api/warehouse-locations`）、Item

## Error Codes

- 409：状态不允许 post / version 冲突

## Current UI

- 成熟列表页 + 详情页（真实 API 消费，非占位）

## Gap

- 接入统一 Workspace（EntityListWorkspace / EntityDetailWorkspace / EntityFormWorkspace / StatusBadge / ErrorPanel / ReferenceSelector / LineEditor）
- 保留现有业务逻辑；Create/Edit 从旧 PR #38 选择性吸收
