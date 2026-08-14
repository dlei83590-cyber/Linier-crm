# Contract Card — 应收账款

- 模块：`accounts-receivable`（销售管理 · 应收账款）
- 判定：**可开发（只读）**（Backend FINAL + Frontend Missing）
- 归属 Wave：F2-5
- Backend Contract：list / detail / ~create / ~edit / ~workflow / ~factActions（事实基线：apps/web/src/app/api 实际路由）
- Current Frontend：~list / ~detail / ~create / ~edit / ~workflow / ~factActions（事实基线：apps/web/src/app/(dashboard) 实际页面；Tier 2/3 HARD HOLD）

## API（事实来源：apps/web/src/app/api 实际路由）

| 能力   | 端点                                                     | 方法 | 说明             |
| ------ | -------------------------------------------------------- | ---- | ---------------- |
| List   | `/api/accounts-receivables`                              | GET  | 分页/筛选        |
| Detail | `/api/accounts-receivables/{id}`                         | GET  | —                |
| Aging  | `/api/accounts-receivables/aging`                        | GET  | 账龄分析（只读） |
| Sub    | `/api/accounts-receivables/{id}/revisions`、`/snapshots` | GET  | 版本/快照        |

> ⚠️ 只读模型：AR 事实由发票/收款核销驱动，前端禁止自行计算 AR 余额。

## Permission

- `accounts-receivable:view`（只读）

## Status Machine

- 无前端可操作状态机（余额/账龄由后端投影）

## Selectors

- Customer、Invoice（`/api/invoices`）、Receipt（`/api/receipts`）

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

- List/Detail/Aging 只读页缺失 → F2-5 实现（只读，无 Create/Edit/动作）
