# Contract Card — 项目机会

- 模块：`project-opportunities`（客户与项目 · 项目机会）
- 判定：**可开发**（Backend FINAL + Frontend Missing）
- 归属 Wave：F2-4
- 能力（Registry）：list / detail / create / edit / factActions（workflow 无）

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

## Current UI

- 占位页（PlaceholderPage「尚未开放」）

## Gap

- List/Detail/Create/Edit/convert 全部缺失 → F2-4 实现
