# Contract Card — 收款核销

- 模块：`receipt-allocation`（销售管理 · 收款核销）
- 判定：**可开发**（Backend FINAL + Frontend Missing）
- 归属 Wave：F2-5
- Backend Contract：list / detail / create / ~edit / ~workflow / factActions（事实基线：apps/web/src/app/api 实际路由）
- Current Frontend：~list / ~detail / ~create / ~edit / ~workflow / ~factActions（事实基线：apps/web/src/app/(dashboard) 实际页面；Tier 2/3 HARD HOLD）

## API（事实来源：apps/web/src/app/api 实际路由）

| 能力    | 端点                                                                 | 方法 | 说明                |
| ------- | -------------------------------------------------------------------- | ---- | ------------------- |
| List    | `/api/receipts`                                                      | GET  | 分页/筛选           |
| Detail  | `/api/receipts/{id}`                                                 | GET  | —                   |
| Create  | `/api/receipts`                                                      | POST | 收款登记            |
| Actions | `/api/receipts/{id}/allocate`                                        | POST | 核销 AR（事实动作） |
| Actions | `/api/receipts/{id}/void`                                            | POST | 作废                |
| Sub     | `/api/receipt-allocations`、`/receipts/{id}/revisions`、`/snapshots` | GET  | 核销记录/版本/快照  |

> ⚠️ 无 PATCH 路由：收款创建后不可编辑（仅核销/作废）。

## Permission

- `receipt:view` / `:create`（动作级权限已 seed）

## Status Machine

- 登记 → 核销中 → 已核销；终态 VOID（以 OpenAPI 为准）

## Selectors

- Customer、Invoice（AR 未结项来源）

## Error Codes

- 409：核销冲突 / 金额不匹配
- 400：校验错误

## Frontend Current State（ui 层事实，F2-6B 批 2 交付后）

| 能力              | 状态                                             |
| ----------------- | ------------------------------------------------ |
| List              | ✅ `/sales/receipts`（分页 + status 过滤）        |
| Detail            | ✅ `/sales/receipts/[id]`（摘要 + 核销记录）      |
| Create            | ✅ `/sales/receipts/new`（收款登记）              |
| Edit              | ➖ 无 PATCH 路由（收款创建后不可编辑，设计如此）  |
| Submit / Workflow | ➖ 收款不审批（无 workflow）                      |
| Fact Actions      | ✅ allocate / void / allocation reverse（详情页） |

## Current UI

- 列表页 + 新建页 + 详情页（核销选择对话框 + 作废确认 + 核销冲销）。

## Gap

- 无（List/Detail/Create/allocate/void/reverse 已接线，消费 FINAL 契约）。
