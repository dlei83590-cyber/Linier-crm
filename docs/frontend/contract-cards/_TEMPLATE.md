# Contract Card — {模块显示名}

- 模块：`{module id}`（{一级域} · {模块名}）
- 判定：**{可开发 | 迁移 | HOLD}**（{Backend FINAL + Frontend Missing/Existing | Backend Contract Missing}）
- 归属 Wave：{F2-x / 未排期}
- Backend Contract：{list / detail / create / edit / workflow / factActions 按实际后端路由填}（事实基线：apps/web/src/app/api）
- Current Frontend：{ui 层按实际页面填；Tier 2/3 一律 HOLD}（事实基线：apps/web/src/app/(dashboard)）

## API（事实来源：apps/web/src/app/api 实际路由）

| 能力    | 端点                | 方法  | 说明        |
| ------- | ------------------- | ----- | ----------- |
| List    | `/api/...`          | GET   | 分页/筛选   |
| Detail  | `/api/.../{id}`     | GET   | —           |
| Create  | `/api/...`          | POST  | —           |
| Edit    | `/api/.../{id}`     | PATCH | CAS version |
| Actions | `/api/.../{id}/...` | POST  | 动作说明    |

## Permission

- 列表/操作权限码：`...`

## Status Machine

- 状态流转（以 OpenAPI / 后端为准，前端只做映射表，不发明规则）

## Selectors

- 引用选择器依赖（如 Supplier / Item / UOM / Warehouse / Location）

## Error Codes

- 关键业务错误码（以 docs/ERROR_CODES.md 为准）

## Current UI

- {占位页（"尚未开放"） | 成熟页面（描述）}

## Gap

- 待实现/待迁移内容清单
