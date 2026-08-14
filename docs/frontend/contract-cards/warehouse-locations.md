# Contract Card — 库位

- 模块：`warehouse-locations`（基础资料 · 库位）
- 判定：**Ready（list only，F2-2 Wave 1 已交付）**（Backend FINAL + Frontend Existing）
- 归属 Wave：F2-2 Wave 1
- Backend Contract：list / ~detail / ~create / ~edit / ~workflow / ~factActions（事实基线：apps/web/src/app/api 实际路由）
- Current Frontend：list / ~detail / ~create / ~edit / ~workflow / ~factActions（事实基线：apps/web/src/app/(dashboard) 实际页面；Tier 2/3 HARD HOLD）

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

- 真实列表页（EntityListWorkspace，warehouseId/code/isActive 筛选；支持 ?warehouseId= 父上下文进入）

- 占位页（PlaceholderPage「尚未开放」）

## Gap

- - Detail/Create/Edit 仍 **HOLD**（后端无 /{id} 与 POST/PATCH 路由，待后端契约扩展）

- 列表页缺失 → F2-2 实现 List（EntityListWorkspace）
- **关联体验**：库位应作为 Warehouse Detail 的子资源呈现（不孤立成数据页）；
  Detail 与 Create/Edit 需后端契约先行，**HOLD**（Backend Contract Missing）
