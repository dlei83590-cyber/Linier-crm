# Contract Card — 采购申请

- 模块：`purchase-requisitions`（采购管理 · 采购申请）
- 判定：**迁移**（Backend FINAL + Frontend Existing）
- 归属 Wave：F2-3
- Backend Contract：list / detail / create / edit / workflow / factActions（事实基线：apps/web/src/app/api 实际路由）
- Current Frontend：list / detail / create / edit / ~workflow / ~factActions（事实基线：apps/web/src/app/(dashboard) 实际页面；Tier 2/3 HARD HOLD）

## API（事实来源：apps/web/src/app/api 实际路由）

| 能力    | 端点                                      | 方法  | 说明                    |
| ------- | ----------------------------------------- | ----- | ----------------------- |
| List    | `/api/purchase-requisitions`              | GET   | 分页/筛选               |
| Detail  | `/api/purchase-requisitions/{id}`         | GET   | —                       |
| Create  | `/api/purchase-requisitions`              | POST  | 创建即取号              |
| Edit    | `/api/purchase-requisitions/{id}`         | PATCH | CAS version（仅 DRAFT） |
| Actions | `/api/purchase-requisitions/{id}/submit`  | POST  | 提交（workflow）        |
| Actions | `/api/purchase-requisitions/{id}/convert` | POST  | 转采购订单（事实动作）  |
| Actions | `/api/purchase-requisitions/{id}/unconvert` | POST | 回退（取消转单）       |
| Delete  | `/api/purchase-requisitions/{id}`         | DELETE | 软删（状态 + 引用双门禁，见下） |

## Permission

- `purchase-requisition:view` / `:create` / `:edit` / `:delete`（动作级权限已 seed）

## Status Machine

- DRAFT → SUBMITTED（审批）→ APPROVED → CONVERTED；终态 REJECTED / CANCELLED
- 前端只做映射表（State_Action_Matrix），不发明规则

## Delete Contract（列表删除门禁，用户指令 2026-11-16）

- 服务端 `DELETE /api/purchase-requisitions/:id`：状态必须 ∈ DRAFT / SUBMITTED / CANCELLED / **APPROVED**；
  CONVERTED / REJECTED 等一律 409 `PURCHASE_REQUISITION_INVALID_STATE`。
- **引用防御**：存在未删除采购订单（`PurchaseOrder.requisitionId = :id`）时禁止删除，409 返回引用出处
  （实体 + 条数 + PO 编号 samples + releaseHint「先回退/删除对应采购订单」）。
- 列表行删除按钮的显隐**只消费后端只读投影** `_count.purchaseOrders`（有效引用数）+ 上述状态集：
  未关联其它动作（`purchaseOrders = 0`）→ 可删除；已引用 → 删除禁用并说明原因；
  CONVERTED 只提供「回退」，删除须先回退。前端不做额外请求、不自造状态判定。
- 删除同时软删 header / lines / revisions 并回收单号（`recycleDocumentSequence`）+ 写审计 `purchase-requisition.delete`。

## Selectors

- Item（`/api/items`）、Supplier、UOM（`/api/unit-of-measures`）、Department/User（P1）

## Error Codes

- 409：version 冲突 / 状态不允许动作

## Frontend Current State（ui 层事实，2026-08-14）

| 能力              | 状态                     |
| ----------------- | ------------------------ |
| List              | ✅（列表页已在 main）    |
| Detail            | ✅（详情页已在 main）    |
| Create            | ✅（new 页面已在 main）  |
| Edit              | ✅（edit 页面已在 main） |
| Submit / Workflow | HOLD（Tier 2 HARD HOLD） |
| Fact Actions      | HOLD（Tier 3 HARD HOLD） |

## Current UI

- 成熟列表页 + 详情页（真实 API 消费，非占位）

## Gap

- 接入统一 Workspace（EntityListWorkspace / EntityDetailWorkspace / EntityFormWorkspace / StatusBadge / ErrorPanel / Selector）
- 保留现有业务逻辑，不推倒重写；Create/Edit 从旧 PR #38 选择性吸收业务逻辑
