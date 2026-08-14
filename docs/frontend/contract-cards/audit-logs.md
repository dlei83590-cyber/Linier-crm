# Contract Card — 操作日志

- 模块：`audit-logs`（系统管理 · 操作日志）
- 判定：**可开发（未排期）**（Backend FINAL + Frontend Missing）
- 归属 Wave：未排期
- 能力（Registry）：list / detail（create / edit / workflow / factActions 无）

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

## Current UI

- 占位页（PlaceholderPage「尚未开放」）

## Gap

- List/Detail 只读页缺失；未排入当前 Wave（F2-2 ~ F2-6 优先业务域）
