# Contract Card — 项目管理

- 模块：`projects`（客户与项目 · 项目管理）
- 判定：**可开发**（Backend FINAL + Frontend Missing）
- 归属 Wave：F2-4
- Backend Contract：list / detail / create / edit / ~workflow / factActions（事实基线：apps/web/src/app/api 实际路由）
- Current Frontend：~list / ~detail / ~create / ~edit / ~workflow / ~factActions（事实基线：apps/web/src/app/(dashboard) 实际页面；Tier 2/3 HARD HOLD）

## API（事实来源：apps/web/src/app/api 实际路由）

| 能力    | 端点                                                     | 方法   | 说明                           |
| ------- | -------------------------------------------------------- | ------ | ------------------------------ |
| List    | `/api/projects`                                          | GET    | 分页/筛选                      |
| Detail  | `/api/projects/{id}`                                     | GET    | —                              |
| Create  | `/api/projects`                                          | POST   | —                              |
| Edit    | `/api/projects/{id}`                                     | PATCH  | CAS version                    |
| Delete  | `/api/projects/{id}`                                     | DELETE | —                              |
| Actions | `/api/projects/{id}/transition`、`/close`、`/acceptance` | POST   | 阶段流转/关闭/验收（事实动作） |

## Permission

- `project:view` / `:create` / `:edit`（动作级权限已 seed）

## Status Machine

- 项目阶段状态机（以 OpenAPI 为准；transition 为唯一流转入口）

## Selectors

- Customer（`/api/customers`）
- 项目机会（`/api/project-opportunities`，convert 来源）

## Error Codes

- 409：version 冲突 / 非法 transition
- 422：校验失败

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

- 占位页（PlaceholderPage「尚未开放」）；子资源（走访/风险/里程碑/任务/预算）无独立入口

## Gap

- **统一 Project Detail Workspace + Tabs**（Overview/Stakeholders/Products/Milestones/Tasks/Budget/Progress/Visits/Risks/Attachments/Acceptance/Closure）
- 子资源不再平铺 Sidebar 导航 → F2-4 实现
