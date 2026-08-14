# Contract Card — 仓库

- 模块：`warehouses`（基础资料 · 仓库）
- 判定：**可开发（list only）**（Backend FINAL + Frontend Missing）
- 归属 Wave：F2-2 Wave 1
- Backend Contract：list / ~detail / ~create / ~edit / ~workflow / ~factActions（事实基线：apps/web/src/app/api 实际路由）
- Current Frontend：~list / ~detail / ~create / ~edit / ~workflow / ~factActions（事实基线：apps/web/src/app/(dashboard) 实际页面；Tier 2/3 HARD HOLD）

## API（事实来源：apps/web/src/app/api 实际路由）

| 能力 | 端点              | 方法 | 说明                                 |
| ---- | ----------------- | ---- | ------------------------------------ |
| List | `/api/warehouses` | GET  | 分页/筛选（code/name/type/isActive） |

> ⚠️ 后端仅 GET 列表 FINAL；无 `/api/warehouses/{id}` 与 POST/PATCH 路由。
> Create/Edit 需后端契约先行（本 Wave 不新增后端 API）。

## Permission

- `warehouse:view`（列表读取）

## Status Machine

- 无状态机（`isActive` 启用/停用）

## Selectors

- 作为单据（Receipt/WHR/Transfer/Adjustment 等）的仓库引用源

## Error Codes

- —（只读列表，无业务错误码）

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

- 列表页缺失 → F2-2 实现 List（EntityListWorkspace）
- Warehouse Detail → Locations 关联体验：Detail 需后端 `/{id}` 路由，**HOLD**（Backend Contract Missing）
