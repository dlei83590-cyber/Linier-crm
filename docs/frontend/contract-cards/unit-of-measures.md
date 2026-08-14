# Contract Card — 计量单位

- 模块：`unit-of-measures`（基础资料 · 计量单位）
- 判定：**可开发（list only）**（Backend FINAL + Frontend Missing）
- 归属 Wave：F2-2 Wave 1
- 能力（Registry）：list（detail / create / edit 无 —— 后端尚无对应路由）

## API（事实来源：apps/web/src/app/api 实际路由）

| 能力 | 端点                    | 方法 | 说明                            |
| ---- | ----------------------- | ---- | ------------------------------- |
| List | `/api/unit-of-measures` | GET  | 分页/筛选（code/name/isActive） |

> ⚠️ 后端仅 GET 列表 FINAL；无 `/api/unit-of-measures/{id}` 与 POST/PATCH 路由。
> Create/Edit 需后端契约先行（本 Wave 不新增后端 API）。

## Permission

- `unit-of-measure:view`（列表读取）

## Status Machine

- 无状态机（`isActive` 启用/停用）

## Selectors

- 作为其它单据（PO/Receipt/WHR 等）的 UOM 引用源

## Error Codes

- —（只读列表，无业务错误码）

## Current UI

- 占位页（PlaceholderPage「尚未开放」）

## Gap

- 列表页缺失 → F2-2 实现 List（EntityListWorkspace）
- Create/Edit：**HOLD**（Backend Contract Missing，待后端 read/write 扩展）
