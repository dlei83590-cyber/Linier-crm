# Contract Card — 供应商发票

- 模块：`supplier-invoices`（采购财务 · 供应商发票）
- 判定：**可开发**（Backend FINAL + Frontend Missing）
- 归属 Wave：F2-6
- Backend Contract：list / detail / create / edit / workflow / factActions（事实基线：apps/web/src/app/api 实际路由）
- Current Frontend：~list / ~detail / ~create / ~edit / ~workflow / ~factActions（事实基线：apps/web/src/app/(dashboard) 实际页面；Tier 2/3 HARD HOLD）

## API（事实来源：apps/web/src/app/api 实际路由）

| 能力    | 端点                                 | 方法  | 说明                                 |
| ------- | ------------------------------------ | ----- | ------------------------------------ |
| List    | `/api/supplier-invoices`             | GET   | 分页/筛选                            |
| Detail  | `/api/supplier-invoices/{id}`        | GET   | —                                    |
| Create  | `/api/supplier-invoices`             | POST  | —                                    |
| Edit    | `/api/supplier-invoices/{id}`        | PATCH | CAS version                          |
| Actions | `/api/supplier-invoices/{id}/submit` | POST  | 提交（workflow）                     |
| Actions | `/api/supplier-invoices/{id}/match`  | POST  | 匹配（Match Run，事实动作）          |
| Actions | `/api/supplier-invoices/{id}/post`   | POST  | **过账（形成 GRIR / AP Liability）** |

## Permission

- `supplier-invoice:view` / `:create` / `:edit`（动作级权限已 seed）

## Status Machine

- DRAFT → SUBMITTED（审批）→ MATCHED → POSTED（GRIR / AP Liability）；终态 CANCELLED
- UI 生命周期：List → Create/Edit → Detail → Match → Approval → POST → GRIR/AP 展示

## Selectors

- Supplier（`/api/suppliers`）、Purchase Receipt / WHR（匹配来源）、Item、Tax Profile

## Error Codes

- 409：匹配冲突 / 金额不匹配 / 状态不允许 post
- 400：校验错误

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

- List/Detail/Create/Edit/Match/Approval/POST/GRIR-AP 展示全部缺失 → F2-6 实现
- **Match 不做独立 Sidebar 页面**：全部置于 Supplier Invoice Detail Workspace（Invoice / Source Receipt / Match Runs / Current Match Snapshot / Variance / Approval / GRIR / AP Liability）
- Supplier CN/DN、Payment Allocation 继续 **HOLD**（5C-2 批准前）
