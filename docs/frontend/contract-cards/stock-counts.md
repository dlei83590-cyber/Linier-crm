# Contract Card — 库存盘点

- 模块：`stock-counts`（库存管理 · 库存盘点）
- 判定：**迁移**（Backend FINAL + Frontend Existing）
- 归属 Wave：F2-3
- 能力（Registry）：list / detail / create / edit / factActions（workflow 无）

## API（事实来源：apps/web/src/app/api 实际路由）

| 能力    | 端点                              | 方法  | 说明                 |
| ------- | --------------------------------- | ----- | -------------------- |
| List    | `/api/stock-counts`               | GET   | 分页/筛选            |
| Detail  | `/api/stock-counts/{id}`          | GET   | —                    |
| Create  | `/api/stock-counts`               | POST  | —                    |
| Edit    | `/api/stock-counts/{id}`          | PATCH | CAS version          |
| Actions | `/api/stock-counts/{id}/complete` | POST  | 完成（差异生成调整） |
| Actions | `/api/stock-counts/{id}/cancel`   | POST  | 取消                 |
| Sub     | `/api/stock-counts/{id}/lines`    | GET   | 盘点行               |

## Permission

- `stock-count:view` / `:create` / `:edit`（动作级权限已 seed）

## Status Machine

- DRAFT → COUNTING → COMPLETED → ADJUSTED；终态 CANCELLED（以 OpenAPI 为准）

## Selectors

- Warehouse（`/api/warehouses`）、Location（`/api/warehouse-locations`）、Item、UOM

## Error Codes

- 409：状态不允许 complete / version 冲突

## Current UI

- 成熟列表页 + 详情页（真实 API 消费，非占位）

## Gap

- 接入统一 Workspace（EntityListWorkspace / EntityDetailWorkspace / EntityFormWorkspace / StatusBadge / ErrorPanel / ReferenceSelector / LineEditor）
- 保留现有业务逻辑；Create/Edit 从旧 PR #38 选择性吸收
