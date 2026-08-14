# Contract Card — 操作日志

- 模块：`audit-logs`（系统管理 · 操作日志）
- 判定：**可开发（未排期）**（Backend FINAL + Frontend Missing）
- 归属 Wave：未排期
- Backend Contract：list / detail / ~create / ~edit / ~workflow / ~factActions（事实基线：apps/web/src/app/api 实际路由）
- Current Frontend：~list / ~detail / ~create / ~edit / ~workflow / ~factActions（事实基线：apps/web/src/app/(dashboard) 实际页面；Tier 2/3 HARD HOLD）

## API（事实来源：apps/web/src/app/api 实际路由）

| 能力   | 端点                   | 方法 | 说明                               |
| ------ | ---------------------- | ---- | ---------------------------------- |
| List   | `/api/audit-logs`      | GET  | 分页/筛选（模块/动作/操作人/时间） |
| Detail | `/api/audit-logs/{id}` | GET  | —                                  |

## Permission

- `audit:view`（列表读取）

## Status Machine

- 无状态机（只读审计数据）

## Selectors

- 模块/动作筛选（字典值）

## Error Codes

- 404：不存在；403：权限不足

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

- List/Detail 只读页缺失；未排入当前 Wave（F2-2 ~ F2-6 优先业务域）
