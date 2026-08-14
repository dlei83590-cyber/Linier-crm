# Contract Card — 项目机会

- 模块：`project-opportunities`（客户与项目 · 项目机会）
- 判定：**已开放（CRUD Ready）**（Backend FINAL + Frontend List/Detail/Create/Edit 已交付）
- 归属 Wave：F2-4（F2-4A1 List/Detail + F2-4A2 Create/Edit 完成；Tier 2/3 待后续）
- Backend Contract：list / detail / create / edit / ~workflow / factActions（事实基线：apps/web/src/app/api 实际路由）
- Current Frontend：list ✅ / detail ✅ / create ✅ / edit ✅ / workflow HOLD / factActions HOLD（事实基线：apps/web/src/app/(dashboard) 实际页面；Tier 2/3 HARD HOLD；Convert 唯一入口保持 HOLD）

## API（事实来源：apps/web/src/app/api 实际路由）

| 能力    | 端点                                      | 方法   | 说明               |
| ------- | ----------------------------------------- | ------ | ------------------ |
| List    | `/api/project-opportunities`              | GET    | 分页/筛选          |
| Detail  | `/api/project-opportunities/{id}`         | GET    | —                  |
| Create  | `/api/project-opportunities`              | POST   | —                  |
| Edit    | `/api/project-opportunities/{id}`         | PATCH  | CAS version        |
| Delete  | `/api/project-opportunities/{id}`         | DELETE | —                  |
| Actions | `/api/project-opportunities/{id}/convert` | POST   | 转项目（事实动作） |

## Permission

- `project-opportunity:view` / `:create` / `:edit`（动作级权限已 seed）

## Status Machine

- 机会阶段流转（以 OpenAPI 为准，前端只做映射表）

## Selectors

- Customer（`/api/customers`，GET FINAL）
- Item / UOM（如产品线字段需要）

## Error Codes

- 409：version 冲突 / 状态不允许 convert

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

- List/Detail/Create/Edit/convert 全部缺失 → F2-4 实现
