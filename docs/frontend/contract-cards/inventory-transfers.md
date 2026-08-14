# Contract Card — 库存调拨

- 模块：`inventory-transfers`（库存管理 · 库存调拨）
- 判定：**迁移**（Backend FINAL + Frontend Existing）
- 归属 Wave：F2-3
- 能力（Registry）：list / detail / create / edit / workflow / factActions

## API（事实来源：apps/web/src/app/api 实际路由）

| 能力    | 端点                                    | 方法  | 说明                     |
| ------- | --------------------------------------- | ----- | ------------------------ |
| List    | `/api/inventory-transfers`              | GET   | 分页/筛选                |
| Detail  | `/api/inventory-transfers/{id}`         | GET   | —                        |
| Create  | `/api/inventory-transfers`              | POST  | —                        |
| Edit    | `/api/inventory-transfers/{id}`         | PATCH | CAS version              |
| Actions | `/api/inventory-transfers/{id}/submit`  | POST  | 提交（workflow）         |
| Actions | `/api/inventory-transfers/{id}/execute` | POST  | 执行（库存移动事实动作） |
| Actions | `/api/inventory-transfers/{id}/cancel`  | POST  | 取消                     |

## Permission

- `inventory-transfer:view` / `:create` / `:edit`（动作级权限已 seed）

## Status Machine

- DRAFT → SUBMITTED → EXECUTED（库存移动）；终态 CANCELLED（以 OpenAPI 为准）

## Selectors

- Warehouse（`/api/warehouses`）、Location（`/api/warehouse-locations`）、Item、UOM

## Error Codes

- 409：状态不允许 execute / version 冲突

## Current UI

- 成熟列表页 + 详情页（真实 API 消费，非占位）

## Gap

- 接入统一 Workspace（EntityListWorkspace / EntityDetailWorkspace / EntityFormWorkspace / StatusBadge / ErrorPanel / ReferenceSelector / DependentSelector / LineEditor）
- 保留现有业务逻辑；Create/Edit 从旧 PR #38 选择性吸收
