# Contract Card — 贷项/借项通知单

- 模块：`credit-debit-notes`（销售管理 · 贷项/借项通知单）
- 判定：**可开发**（Backend FINAL + Frontend Missing）
- 归属 Wave：F2-5
- Backend Contract：list / create / workflow / factActions（事实基线：apps/web/src/app/api 实际路由；**无 GET [id] 详情、无 PATCH**）
- Current Frontend：list / create / workflow(submit) / factActions(apply)（事实基线：apps/web/src/app/(dashboard) 实际页面）

## API（事实来源：apps/web/src/app/api 实际路由）

| 能力    | 端点                                  | 方法 | 说明                  |
| ------- | ------------------------------------- | ---- | --------------------- |
| List    | `/api/credit-debit-notes`             | GET  | 分页/筛选（含 lines） |
| Create  | `/api/credit-debit-notes`             | POST | 单票制（sourceInvoiceId） |
| Actions | `/api/credit-debit-notes/{id}/submit` | POST | 提交（workflow）      |
| Actions | `/api/credit-debit-notes/{id}/apply`  | POST | 应用到 AR（事实动作） |

> ⚠️ 无 `GET /api/credit-debit-notes/{id}` 详情端点、无 `PATCH`；submit/apply 状态机动作内联在列表页完成（无需详情页）。

## Permission

- `credit-debit-note:view` / `:create` / `:edit`（动作级权限已 seed）

> ⚠️ 本权限对应**销售侧** AR CN/DN；供应商侧 CN/DN（supplier-cn-dn）为 5C-2 HOLD，禁止复用。

## Status Machine

- DRAFT → SUBMITTED → APPLIED（冲减/调整 AR）；APPROVED ≠ APPLIED（以 OpenAPI 为准）

## Selectors

- Invoice（`/api/invoices?status=ISSUED`，仅 ISSUED 可作源）

## Error Codes

- 409：CN_DN_SOURCE_INVOICE_INVALID / CN_DN_QUANTITY_EXCEEDED / CN_DN_INVALID_STATE / CN_DN_APPROVAL_REQUIRED / CN_DN_ALREADY_APPLIED / CN_DN_WORKFLOW_FAILED

## Frontend Current State（ui 层事实，F2-6B 批 2 交付后）

| 能力              | 状态                                                        |
| ----------------- | ----------------------------------------------------------- |
| List              | ✅ `/sales/credit-debit-notes`（分页 + status/noteType 过滤） |
| Detail            | ➖ 无详情 GET 端点（明细经列表内联展开展示）                 |
| Create            | ✅ `/sales/credit-debit-notes/new`（选 ISSUED 源发票 + 行）  |
| Edit              | ➖ 无 PATCH 路由（创建后不可编辑）                            |
| Submit / Workflow | ✅ 列表内联 submit（DRAFT → SUBMITTED）                      |
| Fact Actions      | ✅ 列表内联 apply（SUBMITTED → APPLIED，二次确认）           |

## Current UI

- 列表页（内联明细展开 + submit/apply 动作）+ 新建页。

## Gap

- 无（List/Create/submit/apply 已接线，消费 FINAL 契约）。
