# Contract Card — 库存调整

- 模块：`inventory-adjustments`（库存管理 · 库存调整）
- 判定：**迁移**（Backend FINAL + Frontend Existing）
- 归属 Wave：F2-3
- 能力（Registry）：list / detail / create / edit / workflow / factActions

## API（事实来源：apps/web/src/app/api 实际路由）

| 能力    | 端点                                     | 方法  | 说明                 |
| ------- | ---------------------------------------- | ----- | -------------------- |
| List    | `/api/inventory-adjustments`             | GET   | 分页/筛选            |
| Detail  | `/api/inventory-adjustments/{id}`        | GET   | —                    |
| Create  | `/api/inventory-adjustments`             | POST  | —                    |
| Edit    | `/api/inventory-adjustments/{id}`        | PATCH | CAS version          |
| Actions | `/api/inventory-adjustments/{id}/submit` | POST  | 提交（workflow）     |
| Actions | `/api/inventory-adjustments/{id}/apply`  | POST  | 应用（库存事实动作） |
| Actions | `/api/inventory-adjustments/{id}/cancel` | POST  | 取消                 |

## Permission

- `inventory-adjustment:view` / `:create` / `:edit`（动作级权限已 seed）

## Status Machine

- DRAFT → SUBMITTED → APPLIED（库存已调整）；终态 CANCELLED（以 OpenAPI 为准）

## Selectors

- Warehouse（`/api/warehouses`）、Location（`/api/warehouse-locations`）、Item、UOM

## Error Codes

- 409：状态不允许 apply / version 冲突

## Current UI

- 成熟列表页 + 详情页（真实 API 消费，非占位）

## Gap

- 接入统一 Workspace（EntityListWorkspace / EntityDetailWorkspace / EntityFormWorkspace / StatusBadge / ErrorPanel / ReferenceSelector / LineEditor）
- 保留现有业务逻辑；Create/Edit 从旧 PR #38 选择性吸收
