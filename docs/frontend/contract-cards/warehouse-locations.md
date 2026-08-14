# Contract Card — 库位

- 模块：`warehouse-locations`（基础资料 · 库位）
- 判定：**可开发（list only）**（Backend FINAL + Frontend Missing）
- 归属 Wave：F2-2 Wave 1
- 能力（Registry）：list（detail / create / edit 无 —— 后端尚无对应路由）

## API（事实来源：apps/web/src/app/api 实际路由）

| 能力 | 端点                       | 方法 | 说明                                   |
| ---- | -------------------------- | ---- | -------------------------------------- |
| List | `/api/warehouse-locations` | GET  | 分页/筛选（warehouseId/code/isActive） |

> ⚠️ 后端仅 GET 列表 FINAL；无 `/api/warehouse-locations/{id}` 与 POST/PATCH 路由。
> Create/Edit 需后端契约先行（本 Wave 不新增后端 API）。

## Permission

- `warehouse-location:view`（列表读取）

## Status Machine

- 无状态机（`isActive` 启用/停用）

## Selectors

- 依赖 Warehouse（组合 FK）；作为单据库位引用源

## Error Codes

- —（只读列表，无业务错误码）

## Current UI

- 占位页（PlaceholderPage「尚未开放」）

## Gap

- 列表页缺失 → F2-2 实现 List（EntityListWorkspace）
- **关联体验**：库位应作为 Warehouse Detail 的子资源呈现（不孤立成数据页）；
  Detail 与 Create/Edit 需后端契约先行，**HOLD**（Backend Contract Missing）
